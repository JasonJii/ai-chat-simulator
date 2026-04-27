const BASE = "";

async function jfetch(path, opts) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText || "请求失败");
  return data;
}

export function getMeta() {
  return jfetch("/api/meta");
}

export function listCharacters(scenario) {
  return jfetch(`/api/characters?scenario=${encodeURIComponent(scenario)}`);
}

export function getCharacter(id) {
  return jfetch(`/api/characters/${encodeURIComponent(id)}`);
}

export function startSession(characterId, customContext = "") {
  return jfetch("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ characterId, customContext }),
  });
}

export function sendHrMessage(sessionId, text) {
  return jfetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

/** HR 话术教练：根据档案与对话摘要生成建议（独立单次请求，不继承员工扮演的 messages 上下文） */
export function requestCoachSuggestion(sessionId) {
  return jfetch(`/api/sessions/${encodeURIComponent(sessionId)}/coach`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/** HR 整体评价：基于当前会话全量对话，输出沟通水平与复盘建议 */
export function requestSessionReview(sessionId) {
  return jfetch(`/api/sessions/${encodeURIComponent(sessionId)}/review`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function requestVoiceMetrics(sessionId, hrText, empText) {
  return jfetch(`/api/sessions/${encodeURIComponent(sessionId)}/voice-metrics`, {
    method: "POST",
    body: JSON.stringify({ hrText, empText }),
  });
}

/**
 * 大模型流式回复（SSE）
 * @param {string} sessionId
 * @param {string} text
 * @param {{ onDelta?: (t: string) => void, onDone?: (o: object) => void, onError?: (m: string | object) => void }} cb
 */
export async function sendHrMessageStream(sessionId, text, cb) {
  const res = await fetch(`${BASE}/api/sessions/${encodeURIComponent(sessionId)}/messages/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    cb.onError?.(data.error || res.statusText || "请求失败");
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    cb.onError?.("无响应流");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const lines = chunk.split("\n");
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const payload = t.slice(5).trim();
          let obj;
          try {
            obj = JSON.parse(payload);
          } catch {
            continue;
          }
          if (obj.type === "delta" && typeof obj.text === "string") cb.onDelta?.(obj.text);
          else if (obj.type === "done") cb.onDone?.(obj);
          else if (obj.type === "error") cb.onError?.(obj.message || obj);
        }
      }
    }
  } catch (e) {
    cb.onError?.(String(e?.message || e));
  }
}

export function health() {
  return jfetch("/api/health");
}
