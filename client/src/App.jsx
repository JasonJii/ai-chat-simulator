import { useEffect, useMemo, useRef, useState } from "react";
import {
  getMeta,
  listCharacters,
  getCharacter,
  startSession,
  sendHrMessage,
  sendHrMessageStream,
  requestCoachSuggestion,
  requestSessionReview,
  requestVoiceMetrics,
} from "./api.js";
import { DashboardRow } from "./MoodHud.jsx";

const VOICE_BRIDGE_WS_URL = "ws://localhost:8787/voice-bridge";
const TARGET_SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 160;
const DEFAULT_SILENCE_RMS_THRESHOLD = 0.012;
const DEFAULT_SILENCE_HOLD_MS = 700;
const SPEECH_ACTIVE_MS = 180;
const END_ASR_COOLDOWN_MS = 1800;
const HR_FRAGMENT_MIN_CHARS = 8;
const MIN_AUTO_END_SPEECH_MS = 1200;
const MIN_AUTO_END_TEXT_CHARS = 12;
const SPEAKER_OPTIONS = [
  { label: "可爱女声（SC2.0）", value: "saturn_zh_female_keainvsheng_tob" },
  { label: "成熟姐姐（SC2.0）", value: "saturn_zh_female_chengshujiejie_tob" },
  { label: "温柔御姐（SC2.0）", value: "saturn_zh_female_wenrouwenya_tob" },
  { label: "霸道少爷（SC2.0）", value: "saturn_zh_male_badaoshaoye_tob" },
  { label: "成熟总裁（SC2.0）", value: "saturn_zh_male_chengshuzongcai_tob" },
];

function RivalAvatar({ name, gender }) {
  const isFemale = gender === "女";
  return (
    <span className={`rival-avatar portrait ${isFemale ? "female" : "male"}`} aria-hidden>
      <span className="portrait-head" />
      <span className="portrait-body" />
      <span className="portrait-mark">{name.slice(0, 1)}</span>
    </span>
  );
}

function StepScenario({ scenarios, onPick }) {
  return (
    <div className="stage-wrap">
      <div className="stage-hero">
        <div className="stage-hero-title">选择你的训练场景</div>
      </div>
      <div className="quest-grid">
        {scenarios.map((s) => (
          <button key={s.id} className="quest-card" type="button" onClick={() => onPick(s.id)}>
            <span className="quest-badge">场景</span>
            <span className="quest-title">{s.title}</span>
            <span className="quest-sub">{s.subtitle}</span>
            <span className="quest-go">进入 →</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function StepCharacters({ items, onBack, onPick }) {
  return (
    <div className="pick-screen">
      <div className="pick-toolbar">
        <button className="btn btn-game ghost" type="button" onClick={onBack}>
          ← 场景
        </button>
        <span className="pick-label">选择对手</span>
      </div>
      <div className="rival-grid">
        {items.map((c) => (
          <button key={c.id} className="rival-card" type="button" onClick={() => onPick(c.id)}>
            <RivalAvatar name={c.name} gender={c.gender} />
            <span className="rival-name">{c.name}</span>
            <span className="rival-role">{c.jobTitle}</span>
            <span className="rival-meta">
              {c.location} · {c.tenureMonths}M
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function CharacterPreviewModal({
  open,
  scenarioTitle,
  character,
  loading,
  customContext,
  onCustomContextChange,
  onCancel,
  onStart,
}) {
  if (!open || !character) return null;
  return (
    <div className="modal-mask" role="dialog" aria-modal="true">
      <div className="modal-panel">
        <div className="modal-head">
          <div className="modal-title-wrap">
            <div className="modal-kicker">{scenarioTitle || "模拟谈判"}</div>
            <h3 className="modal-title">对手档案 · {character.name}</h3>
          </div>
        </div>

        <div className="modal-body">
          <div className="modal-custom">
            <div className="modal-custom-label">自定义补充背景（可选）</div>
            <textarea
              className="modal-custom-input"
              value={customContext}
              onChange={(e) => onCustomContextChange(e.target.value)}
              placeholder="例如：本次谈判前已发生的内部沟通、业务变化、预算边界、你希望 AI 重点参考的信息。"
              maxLength={1200}
            />
          </div>
          <div className="modal-kv">
            <div className="item">
              <div className="k">基本信息</div>
              <div className="v">
                {character.gender}，{character.age} 岁 · {character.location}
              </div>
            </div>
            <div className="item">
              <div className="k">任职信息</div>
              <div className="v">
                {character.jobTitle} · {character.department} · 司龄 {character.tenureMonths} 个月
              </div>
            </div>
            <div className="item">
              <div className="k">汇报线</div>
              <div className="v">{character.reportLine}</div>
            </div>
            <div className="item">
              <div className="k">薪酬带宽</div>
              <div className="v">{character.compensationBand}</div>
            </div>
            <div className="item">
              <div className="k">人物背景</div>
              <div className="v">{character.basicInfo}</div>
            </div>
            <div className="item">
              <div className="k">当前局面</div>
              <div className="v">{character.situation}</div>
            </div>
            <div className="item">
              <div className="k">绩效/事实</div>
              <div className="v">{character.performanceSummary}</div>
            </div>
            <div className="item">
              <div className="k">表达特点</div>
              <div className="v">{character.speechHabits}</div>
            </div>
            <div className="item">
              <div className="k">谈判桌表现</div>
              <div className="v">{character.tableBehavior}</div>
            </div>
            <div className="item">
              <div className="k">核心顾虑</div>
              <div className="v">{character.mindset}</div>
            </div>
            <div className="item">
              <div className="k">自认筹码</div>
              <div className="v">{character.leverageTheyFeel}</div>
            </div>
            <div className="item">
              <div className="k">员工立场</div>
              <div className="v">{character.employeeStance}</div>
            </div>
            <div className="item">
              <div className="k">底线</div>
              <div className="v">{character.bottomLine}</div>
            </div>
            <div className="item">
              <div className="k">雷区</div>
              <div className="v">{(character.triggers || []).join("；")}</div>
            </div>
            <div className="item">
              <div className="k">缓和点</div>
              <div className="v">{(character.softeners || []).join("；")}</div>
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn btn-game ghost" type="button" onClick={onCancel} disabled={loading}>
            取消
          </button>
          <button className="btn btn-game primary" type="button" onClick={onStart} disabled={loading}>
            {loading ? "准备中…" : "开始谈判"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Meter({ label, value, kind }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="meter">
      <div className="label">
        <span>{label}</span>
        <span>{v}</span>
      </div>
      <div className="bar">
        <div className={`fill ${kind === "agree" ? "agree" : ""}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

function Play({
  scenarioKind,
  scenarioTitle,
  character,
  sessionId,
  opening,
  initialState,
  llmReady,
  explicitDemo,
  onReset,
  onBack,
}) {
  const [trust, setTrust] = useState(initialState.trust);
  const [agreement, setAgreement] = useState(initialState.agreement);
  const [mood, setMood] = useState(initialState.mood);
  const [stage, setStage] = useState(initialState.stage);
  const [round, setRound] = useState(0);
  const [msgs, setMsgs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [coachText, setCoachText] = useState("");
  const [coachBusy, setCoachBusy] = useState(false);
  const [reviewText, setReviewText] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [voiceConnected, setVoiceConnected] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("未连接语音");
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [audioInputs, setAudioInputs] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [speakerPreset, setSpeakerPreset] = useState(SPEAKER_OPTIONS[0].value);
  const [silenceHoldMs, setSilenceHoldMs] = useState(DEFAULT_SILENCE_HOLD_MS);
  const [silenceRmsThreshold, setSilenceRmsThreshold] = useState(DEFAULT_SILENCE_RMS_THRESHOLD);
  const messagesRef = useRef(null);
  const wsRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioRef = useRef(null);
  const ttsSentenceBufferRef = useRef("");
  const lastAssistantTextRef = useRef("");
  const pendingStartRef = useRef(false);
  const audioContextRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const processorRef = useRef(null);
  const pcmQueueRef = useRef([]);
  const silenceMsRef = useRef(0);
  const speechMsRef = useRef(0);
  const utteranceSpeechMsRef = useRef(0);
  const hasSpeechSinceLastEndRef = useRef(false);
  const endAsrPendingRef = useRef(false);
  const waitingModelReplyRef = useRef(false);
  const lastEndAsrAtRef = useRef(0);
  const recognitionResultRef = useRef("");
  const lastHrTurnRef = useRef("");
  const hrFragmentBufferRef = useRef("");
  const voiceSessionReadyRef = useRef(false);
  const isStartingMicRef = useRef(false);

  function appendEmpMessage(text) {
    const content = String(text || "").trim();
    if (!content) return;
    setMsgs((m) => [...m, { role: "emp", text: content }]);
  }

  function appendOrMergeHrMessage(text) {
    const content = String(text || "").trim();
    if (!content) return;
    setMsgs((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === "hr") {
        const merged = `${String(last.text || "").trim()}${content.startsWith("，") || content.startsWith("。") ? "" : " "}${content}`.trim();
        next[next.length - 1] = { ...last, text: merged };
        lastHrTurnRef.current = merged;
      } else {
        next.push({ role: "hr", text: content });
        lastHrTurnRef.current = content;
      }
      return next;
    });
  }

  function playBufferedAudio() {
    if (audioChunksRef.current.length === 0) return;
    const blob = new Blob(audioChunksRef.current, { type: "audio/ogg; codecs=opus" });
    const url = URL.createObjectURL(blob);
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.src = url;
    audioRef.current.play().catch((e) => setErr(`音频播放失败: ${String(e?.message || e)}`));
    audioChunksRef.current = [];
  }

  const intel = useMemo(() => {
    if (agreement >= 82 && trust >= 58) return { type: "ok", text: "情报 · 共识↑ 可压收尾" };
    if (trust <= 28) return { type: "warn", text: "警报 · 信任崩盘风险" };
    if (agreement >= 62 && trust < 45) return { type: "warn", text: "情报 · 表面推进 / 信任缺口" };
    return { type: "neutral", text: "战术 · 先程序后方案" };
  }, [agreement, trust]);

  async function sendTextTurn(rawText) {
    const text = (rawText || "").trim();
    if (!text || busy) return;
    setErr("");
    setBusy(true);
    setMsgs((m) => [...m, { role: "hr", text }]);
    setCurrentTranscript("");

    if (!llmReady && !explicitDemo) {
      setErr("大模型未就绪：请配置 ARK_API_KEY 或 ARK_ENDPOINT_ID=ep-xxxx 后重启后端。");
      setBusy(false);
      return;
    }

    if (explicitDemo) {
      try {
        const out = await sendHrMessage(sessionId, text);
        if (out.error) {
          setErr(out.error);
          setMsgs((m) => m.slice(0, -1));
          setBusy(false);
          return;
        }
        setTrust(out.state.trust);
        setAgreement(out.state.agreement);
        setMood(out.state.mood);
        setStage(out.state.stage);
        setRound(out.state.round);
        setMsgs((m) => [...m, { role: "emp", text: out.reply }]);
      } catch (e) {
        setErr(String(e.message || e));
        setMsgs((m) => m.slice(0, -1));
      } finally {
        setBusy(false);
      }
      return;
    }

    setMsgs((m) => [...m, { role: "emp", text: "", streaming: true }]);

    try {
      await sendHrMessageStream(sessionId, text, {
        onDelta: (d) => {
          setMsgs((m) => {
            const next = [...m];
            const last = next[next.length - 1];
            if (last?.role === "emp" && last.streaming) {
              next[next.length - 1] = { role: "emp", text: last.text + d, streaming: true };
            }
            return next;
          });
        },
        onDone: (out) => {
          setTrust(out.state.trust);
          setAgreement(out.state.agreement);
          setMood(out.state.mood);
          setStage(out.state.stage);
          setRound(out.state.round);
          setMsgs((m) => {
            const next = [...m];
            const last = next[next.length - 1];
            if (last?.role === "emp" && last.streaming) {
              next[next.length - 1] = { role: "emp", text: out.reply };
            }
            return next;
          });
        },
        onError: (msg) => {
          setErr(typeof msg === "string" ? msg : msg?.message || "请求失败");
          setMsgs((m) => {
            const next = [...m];
            if (next[next.length - 1]?.streaming) next.pop();
            return next;
          });
        },
      });
    } catch (e) {
      setErr(String(e?.message || e));
      setMsgs((m) => {
        const next = [...m];
        if (next[next.length - 1]?.streaming) next.pop();
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  function encodeInt16ToBase64(int16Array) {
    const bytes = new Uint8Array(int16Array.buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function flushPcmChunk() {
    if (!voiceSessionReadyRef.current) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    while (pcmQueueRef.current.length >= CHUNK_SAMPLES) {
      const chunk = pcmQueueRef.current.splice(0, CHUNK_SAMPLES);
      const int16 = new Int16Array(chunk.length);
      for (let i = 0; i < chunk.length; i += 1) int16[i] = chunk[i];
      wsRef.current.send(JSON.stringify({ type: "audio_chunk", audioBase64: encodeInt16ToBase64(int16) }));
    }
  }

  function downsampleTo16kInt16(input, sourceSampleRate) {
    if (sourceSampleRate === TARGET_SAMPLE_RATE) {
      return Array.from(input, (v) => {
        const clamped = Math.max(-1, Math.min(1, v));
        return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
      });
    }
    const ratio = sourceSampleRate / TARGET_SAMPLE_RATE;
    const outputLength = Math.floor(input.length / ratio);
    const out = new Array(outputLength);
    for (let i = 0; i < outputLength; i += 1) {
      const idx = Math.floor(i * ratio);
      const clamped = Math.max(-1, Math.min(1, input[idx]));
      out[i] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    }
    return out;
  }

  function sendEndAsr(reason, force = false) {
    if (!voiceSessionReadyRef.current) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (endAsrPendingRef.current || waitingModelReplyRef.current || !hasSpeechSinceLastEndRef.current) return;
    if (!force) {
      const transcriptLen = String(recognitionResultRef.current || "").trim().length;
      if (utteranceSpeechMsRef.current < MIN_AUTO_END_SPEECH_MS && transcriptLen < MIN_AUTO_END_TEXT_CHARS) {
        return;
      }
    }
    const now = Date.now();
    if (now - lastEndAsrAtRef.current < END_ASR_COOLDOWN_MS) return;
    endAsrPendingRef.current = true;
    waitingModelReplyRef.current = true;
    lastEndAsrAtRef.current = now;
    wsRef.current.send(JSON.stringify({ type: "end_asr" }));
    setVoiceStatus(reason);
  }

  async function refreshAudioInputs() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === "audioinput");
      setAudioInputs(inputs);
      if (!selectedDeviceId && inputs[0]) {
        const nonPhone = inputs.find((d) => !/(iphone|phone|手机)/i.test(String(d.label || "")));
        setSelectedDeviceId((nonPhone || inputs[0]).deviceId);
      }
    } catch (e) {
      setErr(`读取麦克风设备失败: ${String(e?.message || e)}`);
    }
  }

  async function startMic() {
    if (recording || isStartingMicRef.current) return;
    isStartingMicRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true,
      });
      mediaStreamRef.current = stream;
      await refreshAudioInputs();
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(512, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        const samples = event.inputBuffer.getChannelData(0);
        const pcm16 = downsampleTo16kInt16(samples, audioContext.sampleRate);
        pcmQueueRef.current.push(...pcm16);
        flushPcmChunk();

        let sum = 0;
        for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
        const rms = Math.sqrt(sum / samples.length);
        const frameMs = (samples.length / audioContext.sampleRate) * 1000;
        if (rms < silenceRmsThreshold) {
          speechMsRef.current = 0;
          silenceMsRef.current += frameMs;
          if (silenceMsRef.current >= silenceHoldMs) {
            sendEndAsr("检测到停顿，准备提交本轮语音");
            silenceMsRef.current = 0;
          }
        } else {
          speechMsRef.current += frameMs;
          utteranceSpeechMsRef.current += frameMs;
          if (speechMsRef.current >= SPEECH_ACTIVE_MS) hasSpeechSinceLastEndRef.current = true;
          silenceMsRef.current = 0;
        }
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
      setRecording(true);
      setVoiceStatus("沟通进行中");
    } catch (e) {
      setErr(`麦克风启动失败: ${String(e?.message || e)}`);
    } finally {
      isStartingMicRef.current = false;
    }
  }

  function stopMic() {
    setRecording(false);
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    pcmQueueRef.current = [];
    silenceMsRef.current = 0;
    speechMsRef.current = 0;
  }

  function connectVoice() {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(VOICE_BRIDGE_WS_URL);
    wsRef.current = ws;
    const voiceCharacterManifest = [
      `你正在扮演员工${character?.name || "员工"}，与HR进行谈判模拟。`,
      `你的岗位是${character?.jobTitle || "未知岗位"}，当前局面：${character?.situation || "待沟通"}。`,
      `核心顾虑：${character?.mindset || "请结合上下文表达顾虑"}。`,
      "只讨论职场谈判相关内容，回复口语化、简洁、具体，每次2-4句。",
    ].join("");
    ws.onopen = () => {
      voiceSessionReadyRef.current = false;
      ws.send(
        JSON.stringify({
          type: "start_session",
          sessionId: crypto.randomUUID(),
          characterManifest: voiceCharacterManifest,
          speaker: speakerPreset,
        }),
      );
      setVoiceConnected(true);
      setVoiceStatus("语音桥接已连接");
    };
    ws.onmessage = async (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.type === "error") {
        setErr(msg.message || "语音桥接异常");
        return;
      }
      if (msg.type === "status") {
        setVoiceStatus(msg.message || "语音桥接状态更新");
        return;
      }
      if (msg.type === "audio_chunk" && msg.audioBase64) {
        const binaryString = atob(msg.audioBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i += 1) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        audioChunksRef.current.push(bytes.buffer.slice(0));
        return;
      }
      if (msg.type !== "event") return;
      if (msg.eventName === "SessionStarted") {
        voiceSessionReadyRef.current = true;
        setVoiceStatus("语音会话已启动");
        if (pendingStartRef.current || !recording) {
          pendingStartRef.current = false;
          void startMic();
        }
        return;
      }
      if (msg.eventName === "ASRResponse") {
        const first = msg.payload?.results?.[0];
        if (first?.text) {
          recognitionResultRef.current = first.text;
          setCurrentTranscript(first.text);
          if (!first.is_interim) setVoiceStatus("识别完成，等待自动提交");
        }
        return;
      }
      if (msg.eventName === "ASREnded") {
        endAsrPendingRef.current = false;
        waitingModelReplyRef.current = false;
        hasSpeechSinceLastEndRef.current = false;
        utteranceSpeechMsRef.current = 0;
        const finalText = (recognitionResultRef.current || "").trim();
        recognitionResultRef.current = "";
        if (finalText) {
          hrFragmentBufferRef.current = `${hrFragmentBufferRef.current}${finalText}`.trim();
          const buffered = hrFragmentBufferRef.current;
          // 自动断句可能把一句话切碎：短分片先缓冲，后续并入同一条 HR 气泡。
          if (buffered.length < HR_FRAGMENT_MIN_CHARS) {
            setVoiceStatus("识别到短语片段，继续收集中");
            return;
          }
          appendOrMergeHrMessage(buffered);
          hrFragmentBufferRef.current = "";
          setVoiceStatus("本轮已提交，等待语音回复");
        }
        return;
      }
      if (msg.eventName === "TTSSentenceStart") {
        const text = String(msg.payload?.text || "");
        if (text) ttsSentenceBufferRef.current += text;
        return;
      }
      if (msg.eventName === "TTSSentenceEnd") {
        const sentenceText = (ttsSentenceBufferRef.current || String(msg.payload?.text || "")).trim();
        if (sentenceText && sentenceText !== lastAssistantTextRef.current) {
          lastAssistantTextRef.current = sentenceText;
          appendEmpMessage(sentenceText);
        }
        ttsSentenceBufferRef.current = "";
        return;
      }
      if (msg.eventName === "TTSEnded") {
        const sentenceText = ttsSentenceBufferRef.current.trim();
        if (sentenceText && sentenceText !== lastAssistantTextRef.current) {
          lastAssistantTextRef.current = sentenceText;
          appendEmpMessage(sentenceText);
        }
        ttsSentenceBufferRef.current = "";
        playBufferedAudio();
        setVoiceStatus("语音回复完成，可继续说话");
        const hrTurn = String(lastHrTurnRef.current || "").trim();
        const empTurn = String(lastAssistantTextRef.current || "").trim();
        if (hrTurn && empTurn) {
          try {
            const metric = await requestVoiceMetrics(sessionId, hrTurn, empTurn);
            if (metric?.state) {
              setTrust(metric.state.trust);
              setAgreement(metric.state.agreement);
              setMood(metric.state.mood);
              setStage(metric.state.stage);
              setRound(metric.state.round);
            }
          } catch (e) {
            setErr(`仪表盘评估失败: ${String(e?.message || e)}`);
          } finally {
            lastHrTurnRef.current = "";
            hrFragmentBufferRef.current = "";
          }
        }
      }
    };
    ws.onclose = () => {
      voiceSessionReadyRef.current = false;
      setVoiceConnected(false);
      setVoiceStatus("语音连接已关闭");
    };
    ws.onerror = () => {
      setErr("语音桥接连接失败，请确认后端已启动。");
    };
  }

  function disconnectVoice() {
    stopMic();
    voiceSessionReadyRef.current = false;
    wsRef.current?.send(JSON.stringify({ type: "finish_session" }));
    wsRef.current?.close();
    wsRef.current = null;
    setVoiceConnected(false);
    audioChunksRef.current = [];
    utteranceSpeechMsRef.current = 0;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }

  async function startCommunication() {
    setErr("");
    pendingStartRef.current = true;
    // 在用户点击手势里优先拉起麦克风，避免首次点击只连上会话不真正开录
    if (!recording) {
      await startMic();
    }
    if (!voiceConnected) {
      connectVoice();
      return;
    }
  }

  function endCommunication() {
    pendingStartRef.current = false;
    disconnectVoice();
    setVoiceStatus("沟通已结束");
  }

  useEffect(() => {
    void refreshAudioInputs();
  }, []);

  useEffect(() => {
    if (!messagesRef.current) return;
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [msgs]);

  useEffect(() => {
    return () => {
      disconnectVoice();
    };
  }, []);

  async function runCoach() {
    if (!llmReady || coachBusy || busy) return;
    setCoachBusy(true);
    setErr("");
    try {
      const out = await requestCoachSuggestion(sessionId);
      if (out.error) {
        setErr(out.error);
        return;
      }
      setCoachText(out.suggestion || "");
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setCoachBusy(false);
    }
  }

  async function runReview() {
    if (!llmReady || reviewBusy || busy) return;
    setReviewBusy(true);
    setErr("");
    try {
      const out = await requestSessionReview(sessionId);
      if (out.error) {
        setErr(out.error);
        return;
      }
      setReviewText(out.review || "");
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setReviewBusy(false);
    }
  }

  return (
    <div className="battle-screen">
      <div className="battle-toolbar">
        <button className="btn btn-game ghost" type="button" onClick={onBack}>
          ← 对手
        </button>
        <button className="btn btn-game ghost" type="button" onClick={onReset}>
          重开
        </button>
        <span className="battle-chapter">{scenarioTitle}</span>
        <span
          className={`battle-link ${explicitDemo ? "is-demo" : ""} ${!llmReady && !explicitDemo ? "is-offline" : ""} ${llmReady && !explicitDemo ? "is-live" : ""}`}
          title={explicitDemo ? "规则演示" : llmReady ? "大模型 · 流式" : "未接大模型"}
        />
      </div>

      {!llmReady && !explicitDemo ? (
        <div className="game-alert">
          当前<strong>不会</strong>调用大模型。请在 <code>server/.env</code> 配置{" "}
          <code>ARK_API_KEY</code> 或 <code>ARK_ENDPOINT_ID=ep-xxxx</code> 后重启服务；仅需规则演练可设{" "}
          <code>DEMO_MODE=true</code>。
        </div>
      ) : null}

      <div className="play-layout">
        <div className="panel panel-hud">
          <div className="panel-title">
            <span className="panel-title-mark" />
            状态终端
          </div>
          <DashboardRow mood={mood} stage={stage} name={character.name} round={round} />

          <Meter label="信任" value={trust} />
          <Meter label="共识" value={agreement} kind="agree" />

          <div className={`intel-line ${intel.type === "ok" ? "intel-ok" : intel.type === "warn" ? "intel-warn" : ""}`}>{intel.text}</div>

          <div className="panel-title panel-title-sub">
            <span className="panel-title-mark" />
            档案
          </div>
          <div className="kv">
            <div className="item">
              <div className="k">基本信息</div>
              <div className="v">
                {character.gender}，{character.age} 岁 · {character.location}
              </div>
            </div>
            <div className="item">
              <div className="k">任职信息</div>
              <div className="v">
                {character.jobTitle} · {character.department} · 司龄 {character.tenureMonths} 个月
              </div>
            </div>
            <div className="item">
              <div className="k">薪酬带宽</div>
              <div className="v">{character.compensationBand}</div>
            </div>
            <div className="item">
              <div className="k">当前局面</div>
              <div className="v">{character.situation}</div>
            </div>
            <div className="item">
              <div className="k">表达特点</div>
              <div className="v">{character.speechHabits}</div>
            </div>
            <div className="item">
              <div className="k">核心顾虑</div>
              <div className="v">{character.mindset}</div>
            </div>
          </div>
        </div>

        <div className="panel panel-comms">
          <div className="panel-title">
            <span className="panel-title-mark is-alt" />
            通讯
          </div>

          <div className="messages" ref={messagesRef}>
            {msgs.map((m, i) => (
              <div key={i} className={`bubble ${m.role === "hr" ? "hr" : "emp"}`}>
                <div className="tag">{m.role === "hr" ? "你 · HR" : `员工 · ${character.name}`}</div>
                <div className="bubble-body">{m.text}</div>
              </div>
            ))}
          </div>

          {err ? <div className="error">{err}</div> : null}

          <div className="coach-panel">
            <div className="coach-toolbar">
              <button
                className="btn btn-game ghost coach-trigger"
                type="button"
                disabled={!llmReady || busy || coachBusy}
                onClick={runCoach}
                title={!llmReady ? "需配置大模型后使用" : "调用教练模型生成建议"}
              >
                {coachBusy ? "教练思考中…" : "推荐话术"}
              </button>
              <button
                className="btn btn-game ghost coach-trigger"
                type="button"
                disabled={!llmReady || busy || reviewBusy}
                onClick={runReview}
                title={!llmReady ? "需配置大模型后使用" : "基于当前会话生成整体评价"}
              >
                {reviewBusy ? "评价生成中…" : "整体评价"}
              </button>
              {!llmReady ? <span className="coach-muted">（大模型未就绪时不可用）</span> : null}
            </div>
            {coachText ? (
              <div className="coach-suggestion">
                <div className="coach-suggestion-body">{coachText}</div>
                <div className="coach-suggestion-actions">
                  <button className="btn btn-game primary" type="button" onClick={() => sendTextTurn(coachText)}>
                    直接发送
                  </button>
                  <button className="btn btn-game ghost" type="button" onClick={() => setCoachText("")}>
                    清除
                  </button>
                </div>
              </div>
            ) : null}
            {reviewText ? (
              <div className="coach-suggestion">
                <div className="coach-suggestion-body" style={{ whiteSpace: "pre-wrap" }}>
                  {reviewText}
                </div>
                <div className="coach-suggestion-actions">
                  <button className="btn btn-game ghost" type="button" onClick={() => setReviewText("")}>
                    清除评价
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="composer">
            <div className="voice-config-grid">
              <label className="voice-config-item">
                <span className="voice-config-label">输入设备</span>
                <select
                  className="voice-select"
                  value={selectedDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                >
                  {audioInputs.map((item, idx) => (
                    <option key={item.deviceId || `mic-${idx}`} value={item.deviceId}>
                      {item.label || `麦克风 ${idx + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="voice-config-item">
                <span className="voice-config-label">声音选择</span>
                <select
                  className="voice-select"
                  value={speakerPreset}
                  onChange={(e) => setSpeakerPreset(e.target.value)}
                  disabled={voiceConnected}
                >
                  {SPEAKER_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="voice-config-grid">
              <label className="voice-config-item">
                <span className="voice-config-label">自动断句停顿时长：{silenceHoldMs} ms</span>
                <input
                  className="voice-range"
                  type="range"
                  min="300"
                  max="1500"
                  step="50"
                  value={silenceHoldMs}
                  onChange={(e) => setSilenceHoldMs(Number(e.target.value))}
                />
              </label>
              <label className="voice-config-item">
                <span className="voice-config-label">静音阈值：{silenceRmsThreshold.toFixed(3)}</span>
                <input
                  className="voice-range"
                  type="range"
                  min="0.005"
                  max="0.05"
                  step="0.001"
                  value={silenceRmsThreshold}
                  onChange={(e) => setSilenceRmsThreshold(Number(e.target.value))}
                />
              </label>
            </div>
            <div className="row">
              <button
                className="btn btn-game primary"
                type="button"
                disabled={busy}
                onClick={startCommunication}
              >
                开始沟通
              </button>
              <button className="btn btn-game ghost" type="button" disabled={!voiceConnected && !recording} onClick={endCommunication}>
                结束沟通
              </button>
            </div>
            <div className="comms-hint">语音状态：{voiceStatus}</div>
            {currentTranscript ? <div className="comms-hint">本轮识别：{currentTranscript}</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [step, setStep] = useState("scenario");
  const [scenarios, setScenarios] = useState([]);
  const [scenarioKind, setScenarioKind] = useState(null);
  const [scenarioTitle, setScenarioTitle] = useState("");
  const [chars, setChars] = useState([]);
  const [character, setCharacter] = useState(null);
  const [session, setSession] = useState(null);
  const [bootErr, setBootErr] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewCharacter, setPreviewCharacter] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [customContext, setCustomContext] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const meta = await getMeta();
        setScenarios(meta.scenarios || []);
      } catch (e) {
        setBootErr("未连接服务");
      }
    })();
  }, []);

  async function onScenario(id) {
    setScenarioKind(id);
    const s = scenarios.find((x) => x.id === id);
    setScenarioTitle(s?.title || "");
    const data = await listCharacters(id);
    setChars(data.characters || []);
    setStep("character");
  }

  async function onCharacter(id) {
    setBootErr("");
    setPreviewBusy(false);
    try {
      const full = await getCharacter(id);
      setPreviewCharacter(full.character || null);
      setPreviewOpen(true);
    } catch (e) {
      setBootErr(String(e?.message || "获取角色失败"));
    }
  }

  async function beginNegotiation() {
    if (!previewCharacter) return;
    setPreviewBusy(true);
    setBootErr("");
    try {
      const sess = await startSession(previewCharacter.id, customContext);
      setCharacter(previewCharacter);
      setSession(sess);
      setPreviewOpen(false);
      setStep("play");
    } catch (e) {
      setBootErr(String(e?.message || "启动会话失败"));
    } finally {
      setPreviewBusy(false);
    }
  }

  function closePreview() {
    if (previewBusy) return;
    setPreviewOpen(false);
    setPreviewCharacter(null);
  }

  async function resetSession() {
    if (!character) return;
    const sess = await startSession(character.id, session?.customContext || customContext);
    setSession(sess);
  }

  return (
    <div className="game-app">
      <header className="game-header">
        <div className="game-logo">
          <span className="game-logo-main">模拟谈判</span>
          <span className="game-logo-sub">NEGOTIATION OPS</span>
        </div>
        {step === "scenario" ? <span className="game-phase">选择场景</span> : null}
        {step === "character" ? <span className="game-phase">选择对手</span> : null}
        {step === "play" ? <span className="game-phase">对局中</span> : null}
      </header>

      <main className="game-main">
        {bootErr ? <div className="game-alert">{bootErr}</div> : null}

        {step === "scenario" ? <StepScenario scenarios={scenarios} onPick={onScenario} /> : null}
        {step === "character" ? (
          <StepCharacters items={chars} onBack={() => setStep("scenario")} onPick={onCharacter} />
        ) : null}
      {step === "play" && session && character ? (
        <Play
          key={session.sessionId}
          scenarioKind={scenarioKind}
          scenarioTitle={scenarioTitle}
          character={character}
          sessionId={session.sessionId}
          opening={session.opening}
          initialState={session.state}
          llmReady={session.llmReady}
          explicitDemo={session.explicitDemo}
          onReset={resetSession}
          onBack={() => {
            setSession(null);
            setCharacter(null);
            setStep("character");
          }}
        />
      ) : null}
      </main>
      <CharacterPreviewModal
        open={previewOpen}
        scenarioTitle={scenarioTitle}
        character={previewCharacter}
        loading={previewBusy}
        customContext={customContext}
        onCustomContextChange={setCustomContext}
        onCancel={closePreview}
        onStart={beginNegotiation}
      />
    </div>
  );
}
