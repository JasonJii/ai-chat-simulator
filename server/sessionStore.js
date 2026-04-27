import { randomUUID } from "crypto";
import { getCharacter } from "./characters.js";
import { buildSystemPrompt, canonicalAssistantTurn, parseStateLine, stripStateLine } from "./prompts.js";
import { completeChat, completeChatStream, isLlmConfigured } from "./doubao.js";
import { demoEmployeeReply } from "./demoReplies.js";
import { VisibleStreamFilter } from "./streamFilter.js";
import { appConfig } from "./config.js";

const sessions = new Map();

/** 仅当显式设置 DEMO_MODE=true 时启用规则演示（秒回、非大模型） */
function explicitDemoMode() {
  return appConfig.demoMode;
}

const ERR_NO_LLM =
  "未配置大模型：请在 server/.env 设置 ARK_API_KEY，或设置 ARK_ENDPOINT_ID=ep-xxxx（方舟控制台「推理」接入点，配合 AK/SK 自动换 Key）后重启后端。";

function normalizeCustomContext(raw) {
  return String(raw || "").trim().slice(0, 1200);
}

export function startSession(characterId, customContext = "") {
  const character = getCharacter(characterId);
  if (!character) return null;
  const id = randomUUID();
  const state = { trust: 48, agreement: 22, mood: "警惕", stage: "试探期" };
  const normalizedContext = normalizeCustomContext(customContext);
  sessions.set(id, {
    id,
    characterId,
    character,
    customContext: normalizedContext,
    round: 0,
    state,
    messages: [{ role: "system", content: buildSystemPrompt(character, normalizedContext) }],
  });
  return {
    sessionId: id,
    character,
    opening: "",
    state: { ...state },
    llmReady: isLlmConfigured(),
    explicitDemo: explicitDemoMode(),
    customContext: normalizedContext,
  };
}

export function getSession(sessionId) {
  return sessions.get(sessionId) ?? null;
}

export function applyVoiceTurnMetrics(sessionId, hrText, empText, nextState) {
  const sess = sessions.get(sessionId);
  if (!sess) return null;
  const hr = String(hrText || "").trim();
  const emp = String(empText || "").trim();
  if (!hr || !emp) return null;
  sess.round += 1;
  sess.messages.push({ role: "user", content: hr });
  sess.messages.push({
    role: "assistant",
    content: `${emp}\nSTATE_JSON:${JSON.stringify({
      trust: nextState.trust,
      agreement: nextState.agreement,
      mood: nextState.mood,
      stage: nextState.stage,
      note: "语音回合评估",
    })}`,
  });
  sess.state = {
    trust: nextState.trust,
    agreement: nextState.agreement,
    mood: nextState.mood,
    stage: nextState.stage,
  };
  return { state: { ...sess.state, round: sess.round } };
}

export async function pushHrMessage(sessionId, hrText) {
  const sess = sessions.get(sessionId);
  if (!sess) return { error: "会话不存在" };
  const text = (hrText || "").trim();
  if (!text) return { error: "消息为空" };

  if (!explicitDemoMode() && !isLlmConfigured()) {
    return { error: ERR_NO_LLM };
  }

  sess.round += 1;
  sess.messages.push({ role: "user", content: text });

  if (explicitDemoMode()) {
    const out = demoEmployeeReply(sess.character, text, sess.state);
    sess.messages.push({ role: "assistant", content: out.raw });
    sess.state = {
      trust: out.state.trust,
      agreement: out.state.agreement,
      mood: out.state.mood,
      stage: out.state.stage,
    };
    return {
      reply: out.visible,
      state: { ...sess.state, round: sess.round },
      explicitDemo: true,
      llmReady: isLlmConfigured(),
    };
  }

  const assistantRaw = await completeChat(sess.messages);
  const stored = canonicalAssistantTurn(assistantRaw) ?? assistantRaw;
  sess.messages.push({ role: "assistant", content: stored });

  const parsed = parseStateLine(stored);
  if (parsed) {
    sess.state = {
      trust: parsed.trust,
      agreement: parsed.agreement,
      mood: parsed.mood,
      stage: parsed.stage,
    };
  }

  return {
    reply: stripStateLine(stored),
    state: { ...sess.state, round: sess.round },
    explicitDemo: false,
    llmReady: true,
  };
}

/**
 * SSE：仅大模型。显式 DEMO_MODE 时请用 /messages 非流式。
 */
export async function pushHrMessageStream(sessionId, hrText, write) {
  const sess = sessions.get(sessionId);
  if (!sess) {
    write({ type: "error", message: "会话不存在" });
    return;
  }
  const text = (hrText || "").trim();
  if (!text) {
    write({ type: "error", message: "消息为空" });
    return;
  }

  if (explicitDemoMode()) {
    write({
      type: "error",
      code: "DEMO_NON_STREAM",
      message: "已开启 DEMO_MODE 演示：员工回复走规则引擎，请使用非流式；要大模型流式请设 DEMO_MODE=false 并配置 ARK_API_KEY 或 ARK_ENDPOINT_ID。",
    });
    return;
  }

  if (!isLlmConfigured()) {
    write({ type: "error", code: "NO_LLM", message: ERR_NO_LLM });
    return;
  }

  sess.round += 1;
  sess.messages.push({ role: "user", content: text });

  const filter = new VisibleStreamFilter((piece) => write({ type: "delta", text: piece }));

  let rawText;
  try {
    rawText = await completeChatStream(sess.messages, (c) => filter.push(c));
  } catch (e) {
    sess.round -= 1;
    sess.messages.pop();
    write({ type: "error", message: String(e?.message || e) });
    return;
  }

  const storedStream = canonicalAssistantTurn(rawText) ?? rawText;
  sess.messages.push({ role: "assistant", content: storedStream });
  const parsed = parseStateLine(storedStream);
  if (parsed) {
    sess.state = {
      trust: parsed.trust,
      agreement: parsed.agreement,
      mood: parsed.mood,
      stage: parsed.stage,
    };
  }

  write({
    type: "done",
    reply: stripStateLine(storedStream),
    state: { ...sess.state, round: sess.round },
    llmReady: true,
  });
}
