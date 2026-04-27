import { hasLlmCredentialHint, resolveBearerApiKey, resolveChatModel, resolveCoachModel } from "./arkAuth.js";
import { appConfig } from "./config.js";

const BASE = appConfig.ark.baseUrl;

export function isLlmConfigured() {
  return hasLlmCredentialHint();
}

function useResponsesApi() {
  return appConfig.ark.useResponses;
}

/** 方舟深度思考：默认关闭，减少冗长与「解题」式输出。ARK_THINKING=enabled|auto 可改 */
function thinkingBody() {
  const raw = appConfig.ark.thinking;
  if (raw === "enabled" || raw === "1" || raw === "true") return { thinking: { type: "enabled" } };
  if (raw === "auto") return { thinking: { type: "auto" } };
  return { thinking: { type: "disabled" } };
}

async function authHeadersAndModel() {
  const API_KEY = await resolveBearerApiKey();
  const MODEL = resolveChatModel();
  if (!API_KEY) {
    throw new Error("未配置大模型密钥：请在 server/.env 设置 ARK_API_KEY，或设置 VOLC_ACCESSKEY+VOLC_SECRETKEY+ARK_ENDPOINT_ID");
  }
  if (!MODEL) {
    throw new Error("未配置模型：请在 server/.env 设置 ARK_MODEL，或设置 ARK_ENDPOINT_ID=ep-xxxx");
  }
  return { API_KEY, MODEL };
}

/**
 * 非流式补全（供角色扮演与教练等复用）
 * @param {number} temperature
 */
async function chatCompletionNonStream(messages, model, temperature) {
  const API_KEY = await resolveBearerApiKey();
  if (!API_KEY) {
    throw new Error("未配置大模型密钥：请在 server/.env 设置 ARK_API_KEY，或设置 VOLC_ACCESSKEY+VOLC_SECRETKEY+ARK_ENDPOINT_ID");
  }
  const root = BASE.replace(/\/$/, "");

  if (useResponsesApi()) {
    const res = await fetch(`${root}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: messagesToResponsesInput(messages),
        temperature,
        ...thinkingBody(),
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`方舟 Responses API 错误 ${res.status}: ${text.slice(0, 500)}`);
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("方舟 Responses API 返回非 JSON");
    }
    return extractResponsesText(data);
  }

  const res = await fetch(`${root}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature,
      messages,
      ...thinkingBody(),
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`方舟 Chat API 错误 ${res.status}: ${text.slice(0, 500)}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("方舟 API 返回非 JSON");
  }
  const out = data?.choices?.[0]?.message?.content;
  if (typeof out !== "string") {
    throw new Error("方舟 API 未返回文本内容");
  }
  return out;
}

/** Chat 协议的 messages → Responses 的 input（纯文本多轮） */
function messagesToResponsesInput(messages) {
  return messages.map((m) => ({
    role: m.role,
    content: [{ type: "input_text", text: m.content }],
  }));
}

function extractResponsesText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  if (typeof data?.text === "string") return data.text;

  const out = data?.output;
  if (Array.isArray(out)) {
    let acc = "";
    for (const item of out) {
      if (item?.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content) {
          if ((c?.type === "output_text" || c?.type === "text") && typeof c.text === "string") acc += c.text;
        }
      }
      if (typeof item?.text === "string") acc += item.text;
      if (Array.isArray(item?.content)) {
        for (const c of item.content) {
          if (typeof c?.text === "string") acc += c.text;
        }
      }
    }
    if (acc.trim()) return acc;
  }

  const msg = data?.choices?.[0]?.message?.content;
  if (typeof msg === "string") return msg;

  throw new Error(`无法解析 Responses 返回文本，片段：${JSON.stringify(data).slice(0, 480)}`);
}

function extractResponsesStreamDelta(json) {
  const a = json?.choices?.[0]?.delta?.content;
  if (typeof a === "string" && a.length) return a;
  if (typeof json?.delta === "string" && json.delta.length) return json.delta;
  if (typeof json?.text === "string" && json.text.length) return json.text;
  const t = json?.type;
  if (t && String(t).includes("output_text")) {
    const d = json.delta;
    if (typeof d === "string") return d;
    if (typeof d?.text === "string") return d.text;
  }
  if (Array.isArray(json?.output)) {
    for (const item of json.output) {
      if (Array.isArray(item?.content)) {
        for (const c of item.content) {
          if (typeof c?.text === "string") return c.text;
        }
      }
    }
  }
  return "";
}

/**
 * @param {{ role: string, content: string }[]} messages
 * @returns {Promise<string>}
 */
export async function completeChat(messages) {
  const { MODEL } = await authHeadersAndModel();
  return chatCompletionNonStream(messages, MODEL, 0.65);
}

/**
 * 教练专用补全：与 completeChat 共用同一接口；传入的 messages 须自成一体，
 * 不要与会话中员工扮演用的多轮 history 合并（由调用方保证）。
 */
export async function completeCoachChat(messages) {
  const model = resolveCoachModel();
  if (!model) {
    throw new Error("未配置教练模型：请在 server/.env 设置 ARK_COACH_MODEL 或 ARK_MODEL");
  }
  return chatCompletionNonStream(messages, model, 0.55);
}

/**
 * 流式；Responses 与 Chat 的 SSE 块结构不同，做兼容解析
 * @param {(chunk: string) => void} onDelta
 * @returns {Promise<string>}
 */
export async function completeChatStream(messages, onDelta) {
  const { API_KEY, MODEL } = await authHeadersAndModel();
  const root = BASE.replace(/\/$/, "");
  const url = useResponsesApi() ? `${root}/responses` : `${root}/chat/completions`;

  const body = useResponsesApi()
    ? {
        model: MODEL,
        temperature: 0.65,
        stream: true,
        input: messagesToResponsesInput(messages),
        ...thinkingBody(),
      }
    : {
        model: MODEL,
        temperature: 0.65,
        stream: true,
        messages,
        ...thinkingBody(),
      };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    const label = useResponsesApi() ? "Responses" : "Chat";
    throw new Error(`方舟 ${label} 流式错误 ${res.status}: ${text.slice(0, 500)}`);
  }

  if (!res.body) {
    throw new Error("方舟 API 无响应体");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const lines = block.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        let json;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        let delta = "";
        if (useResponsesApi()) {
          delta = extractResponsesStreamDelta(json);
        } else {
          const d = json?.choices?.[0]?.delta?.content;
          if (typeof d === "string") delta = d;
        }
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      }
    }
  }

  if (!full.trim()) {
    throw new Error("方舟流式未返回文本（可尝试切换 ARK_USE_RESPONSES 或检查模型名）");
  }
  return full;
}
