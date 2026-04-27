import "./env.js";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import crypto from "node:crypto";
import { gunzipSync } from "node:zlib";
import { WebSocketServer, WebSocket } from "ws";
import { SCENARIOS, listCharactersByScenario } from "./characters.js";
import { getCharacter } from "./characters.js";
import { startSession, pushHrMessage, pushHrMessageStream, getSession } from "./sessionStore.js";
import { isLlmConfigured } from "./doubao.js";
import { evaluateHrSession, evaluateVoiceTurnMetrics, suggestHrReply } from "./hrCoach.js";
import { appConfig } from "./config.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const VOLC_WS_URL = appConfig.voice.wsUrl;
const VOLC_RESOURCE_ID = appConfig.voice.resourceId;
const VOLC_APP_KEY = appConfig.voice.appKey;
const VOLC_MODEL = appConfig.voice.model;
const VOLC_SPEAKER = appConfig.voice.speaker;

const EVENTS = {
  StartConnection: 1,
  StartSession: 100,
  FinishSession: 102,
  TaskRequest: 200,
  EndASR: 400,
  ClientInterrupt: 515,
  ChatTextQuery: 501,
  SessionStarted: 150,
  TTSSentenceStart: 350,
  TTSSentenceEnd: 351,
  TTSResponse: 352,
  TTSEnded: 359,
  ASRInfo: 450,
  ASREnded: 459,
  ASRResponse: 451,
  ChatResponse: 550,
};

function makeHeader(messageType, flags = 0b0100, serialization = 0b0001, compression = 0b0000) {
  const header = Buffer.alloc(4);
  header[0] = (0b0001 << 4) | 0b0001;
  header[1] = (messageType << 4) | flags;
  header[2] = (serialization << 4) | compression;
  header[3] = 0x00;
  return header;
}

function encodeEventPacket({ event, sessionId, payloadObj, messageType = 0b0001 }) {
  const payloadRaw = Buffer.from(JSON.stringify(payloadObj ?? {}), "utf-8");
  const optionalParts = [Buffer.alloc(4)];
  optionalParts[0].writeInt32BE(event, 0);
  if (sessionId) {
    const sessionBuffer = Buffer.from(sessionId, "utf-8");
    const sessionLen = Buffer.alloc(4);
    sessionLen.writeInt32BE(sessionBuffer.length, 0);
    optionalParts.push(sessionLen, sessionBuffer);
  }
  const payloadLen = Buffer.alloc(4);
  payloadLen.writeInt32BE(payloadRaw.length, 0);
  return Buffer.concat([makeHeader(messageType), ...optionalParts, payloadLen, payloadRaw]);
}

function encodeAudioPacket({ event, sessionId, audioBuffer }) {
  const optionalParts = [Buffer.alloc(4)];
  optionalParts[0].writeInt32BE(event, 0);
  const sessionBuffer = Buffer.from(sessionId, "utf-8");
  const sessionLen = Buffer.alloc(4);
  sessionLen.writeInt32BE(sessionBuffer.length, 0);
  optionalParts.push(sessionLen, sessionBuffer);
  const payloadLen = Buffer.alloc(4);
  payloadLen.writeInt32BE(audioBuffer.length, 0);
  return Buffer.concat([makeHeader(0b0010, 0b0100, 0b0000, 0b0000), ...optionalParts, payloadLen, audioBuffer]);
}

function decodeServerPacket(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (data.length < 8) return { kind: "unknown", raw: data.toString("base64") };
  const messageType = data[1] >> 4;
  const flags = data[1] & 0x0f;
  const serialization = data[2] >> 4;
  const compression = data[2] & 0x0f;
  let offset = 4;
  let event = null;
  if (messageType === 0b1111) offset += 4;
  const sequenceFlag = flags & 0b0011;
  if (sequenceFlag !== 0) offset += 4;
  if ((flags & 0b0100) !== 0) {
    event = data.readInt32BE(offset);
    offset += 4;
  }
  let sessionId = null;
  if (event !== null && event >= 100 && offset + 4 <= data.length) {
    const sessionLen = data.readInt32BE(offset);
    offset += 4;
    if (sessionLen > 0 && offset + sessionLen <= data.length) {
      sessionId = data.slice(offset, offset + sessionLen).toString("utf-8");
      offset += sessionLen;
    }
  }
  if (offset + 4 > data.length) return { kind: "unknown", raw: data.toString("base64") };
  const payloadSize = data.readInt32BE(offset);
  offset += 4;
  if (offset + payloadSize > data.length) return { kind: "unknown", raw: data.toString("base64") };
  let payload = data.slice(offset, offset + payloadSize);
  if (compression === 0b0001) {
    try {
      payload = gunzipSync(payload);
    } catch {
      return { kind: "unknown", event, sessionId, raw: data.toString("base64") };
    }
  }
  if (messageType === 0b1011 || event === EVENTS.TTSResponse) {
    return { kind: "audio", event, sessionId, audio: payload.toString("base64") };
  }
  if (serialization === 0b0001) {
    try {
      return { kind: "json", event, sessionId, payload: JSON.parse(payload.toString("utf-8")) };
    } catch {
      return { kind: "json", event, sessionId, payload: { raw: payload.toString("utf-8") } };
    }
  }
  return { kind: "raw", event, sessionId, payload: payload.toString("base64") };
}

function safeSend(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

app.get("/api/health", (_req, res) => {
  const llm = isLlmConfigured();
  res.json({
    ok: true,
    llm,
    demoFallback: !llm,
    hint: llm
      ? null
      : "当前为演示模式：在 server 目录创建 .env，写入 ARK_API_KEY（方舟「API Key」），并把 ARK_MODEL 设为模型名或推理接入点 ep-xxx；若只有火山 AK/SK，可写 VOLC_ACCESSKEY、VOLC_SECRETKEY、ARK_ENDPOINT_ID（ep- 开头）。修改后需重启后端。",
  });
});

app.get("/api/meta", (_req, res) => {
  res.json({ scenarios: SCENARIOS });
});

app.get("/api/characters", (req, res) => {
  const { scenario } = req.query;
  if (!scenario || typeof scenario !== "string") {
    res.status(400).json({ error: "缺少 scenario" });
    return;
  }
  const list = listCharactersByScenario(scenario).map((c) => ({
    id: c.id,
    scenarioId: c.scenarioId,
    name: c.name,
    jobTitle: c.jobTitle,
    department: c.department,
    tenureMonths: c.tenureMonths,
    location: c.location,
    oneLine: c.situation.slice(0, 72) + (c.situation.length > 72 ? "…" : ""),
  }));
  res.json({ characters: list });
});

app.get("/api/characters/:id", (req, res) => {
  const c = getCharacter(req.params.id);
  if (!c) {
    res.status(404).json({ error: "角色不存在" });
    return;
  }
  res.json({ character: c });
});

app.post("/api/sessions", (req, res) => {
  const { characterId, customContext } = req.body || {};
  if (!characterId) {
    res.status(400).json({ error: "缺少 characterId" });
    return;
  }
  const started = startSession(characterId, customContext);
  if (!started) {
    res.status(400).json({ error: "无效 characterId" });
    return;
  }
  res.json(started);
});

app.post("/api/sessions/:id/messages", async (req, res) => {
  const { id } = req.params;
  const { text } = req.body || {};
  try {
    const out = await pushHrMessage(id, text);
    if (out.error) {
      res.status(400).json(out);
      return;
    }
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/sessions/:id/coach", async (req, res) => {
  const { id } = req.params;
  try {
    const out = await suggestHrReply(id);
    if (out.error) {
      res.status(400).json(out);
      return;
    }
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/sessions/:id/review", async (req, res) => {
  const { id } = req.params;
  try {
    const out = await evaluateHrSession(id);
    if (out.error) {
      res.status(400).json(out);
      return;
    }
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/sessions/:id/voice-metrics", async (req, res) => {
  const { id } = req.params;
  const { hrText, empText } = req.body || {};
  try {
    const out = await evaluateVoiceTurnMetrics(id, hrText, empText);
    if (out.error) {
      res.status(400).json(out);
      return;
    }
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/sessions/:id/messages/stream", async (req, res) => {
  const { id } = req.params;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  try {
    await pushHrMessageStream(id, req.body?.text, send);
  } catch (e) {
    send({ type: "error", message: String(e?.message || e) });
  }
  res.end();
});

app.get("/api/sessions/:id", (req, res) => {
  const s = getSession(req.params.id);
  if (!s) {
    res.status(404).json({ error: "会话不存在" });
    return;
  }
  res.json({
    sessionId: s.id,
    round: s.round,
    state: { ...s.state, round: s.round },
    character: s.character,
  });
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/voice-bridge" });

wss.on("connection", (clientWs) => {
  let upstreamWs = null;
  let activeSessionId = null;
  const connectId = crypto.randomUUID();

  function closeUpstream() {
    if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
      upstreamWs.close();
    }
    upstreamWs = null;
  }

  clientWs.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      safeSend(clientWs, { type: "error", message: "前端消息不是合法 JSON。" });
      return;
    }

    if (msg.type === "start_session") {
      if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
        safeSend(clientWs, { type: "status", message: "会话已存在，直接复用。" });
        return;
      }
      const appId = appConfig.voice.appId;
      const accessToken = appConfig.voice.accessToken;
      if (!appId || !accessToken || !VOLC_APP_KEY) {
        safeSend(clientWs, {
          type: "error",
          message: "语音未配置：请在 server/.env 设置 VOLC_APP_ID、VOLC_ACCESS_TOKEN、VOLC_APP_KEY。",
        });
        return;
      }
      activeSessionId = msg.sessionId || crypto.randomUUID();
      try {
        upstreamWs = new WebSocket(VOLC_WS_URL, {
          headers: {
            "X-Api-App-ID": appId,
            "X-Api-Access-Key": accessToken,
            "X-Api-Resource-Id": VOLC_RESOURCE_ID,
            "X-Api-App-Key": VOLC_APP_KEY,
            "X-Api-Connect-Id": connectId,
          },
        });
      } catch (err) {
        safeSend(clientWs, {
          type: "error",
          message: `语音桥接初始化失败: ${String(err?.message || err)}`,
        });
        upstreamWs = null;
        return;
      }
      upstreamWs.on("open", () => {
        const customCharacterManifest = String(msg.characterManifest || "").trim();
        const selectedSpeaker = String(msg.speaker || "").trim() || VOLC_SPEAKER;
        upstreamWs.send(encodeEventPacket({ event: EVENTS.StartConnection, payloadObj: {} }));
        upstreamWs.send(
          encodeEventPacket({
            event: EVENTS.StartSession,
            sessionId: activeSessionId,
            payloadObj: {
              tts: { speaker: selectedSpeaker },
              asr: {
                audio_info: { format: "pcm", sample_rate: 16000, channel: 1 },
                extra: { enable_custom_vad: true, end_smooth_window_ms: 600 },
              },
              dialog: {
                bot_name: "豆包",
                character_manifest:
                  customCharacterManifest ||
                  "你是语音识别助手。只做简短中文回复，禁止输出与识别无关的内容。",
                extra: { input_mod: "keep_alive", model: VOLC_MODEL },
              },
            },
          }),
        );
        safeSend(clientWs, { type: "status", message: "语音会话已启动。" });
      });

      upstreamWs.on("message", (data) => {
        const parsed = decodeServerPacket(data);
        if (parsed.kind === "audio") {
          safeSend(clientWs, { type: "audio_chunk", audioBase64: parsed.audio });
          return;
        }
        if (parsed.kind === "json") {
          safeSend(clientWs, {
            type: "event",
            event: parsed.event,
            eventName: Object.keys(EVENTS).find((key) => EVENTS[key] === parsed.event) || `event_${parsed.event}`,
            payload: parsed.payload,
          });
          return;
        }
        safeSend(clientWs, { type: "debug", payload: parsed });
      });

      upstreamWs.on("error", (err) => {
        safeSend(clientWs, { type: "error", message: `上游语音连接异常: ${err.message}` });
      });
      upstreamWs.on("close", () => {
        safeSend(clientWs, { type: "status", message: "上游语音连接已关闭。" });
      });
      return;
    }

    if (!upstreamWs || upstreamWs.readyState !== WebSocket.OPEN || !activeSessionId) {
      safeSend(clientWs, { type: "error", message: "语音会话未启动，请先 start_session。" });
      return;
    }

    if (msg.type === "audio_chunk") {
      const audioBase64 = String(msg.audioBase64 || "");
      if (!audioBase64) return;
      upstreamWs.send(
        encodeAudioPacket({
          event: EVENTS.TaskRequest,
          sessionId: activeSessionId,
          audioBuffer: Buffer.from(audioBase64, "base64"),
        }),
      );
      return;
    }

    if (msg.type === "end_asr") {
      upstreamWs.send(encodeEventPacket({ event: EVENTS.EndASR, sessionId: activeSessionId, payloadObj: {} }));
      return;
    }

    if (msg.type === "finish_session") {
      upstreamWs.send(encodeEventPacket({ event: EVENTS.FinishSession, sessionId: activeSessionId, payloadObj: {} }));
      return;
    }
  });

  clientWs.on("close", () => {
    closeUpstream();
  });
});

const PORT = appConfig.port;
httpServer.listen(PORT, () => {
  const llm = isLlmConfigured();
  console.log(`HR 谈判模拟 API: http://localhost:${PORT}`);
  console.log(`语音桥接 WS: ws://localhost:${PORT}/voice-bridge`);
  console.log(llm ? "大模型：已配置（ARK_API_KEY 或 ARK_ENDPOINT_ID+AK/SK）" : "大模型：未就绪 — 请在 server/.env 设置 ARK_API_KEY 或 ARK_ENDPOINT_ID=ep-xxxx 后重启");
});
