/**
 * HR 话术教练：与「员工扮演」共用同一方舟 API / 同一密钥即可。
 * 每次推荐都是**新的**两条 messages（教练 system + 汇总后的单条 user），
 * **绝不**把 session 里给员工模型用的多轮 messages 拼进请求，因此不会串同一条对话上下文。
 */
import { SCENARIOS } from "./characters.js";
import { applyVoiceTurnMetrics, getSession } from "./sessionStore.js";
import { stripStateLine } from "./prompts.js";
import { completeCoachChat, isLlmConfigured } from "./doubao.js";

function scenarioTitle(scenarioId) {
  return SCENARIOS.find((s) => s.id === scenarioId)?.title ?? "谈判";
}

function buildTranscript(sess) {
  const lines = [];
  for (const m of sess.messages) {
    if (m.role === "system") continue;
    if (m.role === "user") lines.push(`【HR】${m.content}`);
    if (m.role === "assistant") lines.push(`【员工】${stripStateLine(m.content)}`);
  }
  return lines.join("\n");
}

function characterBrief(c) {
  return [
    `姓名：${c.name}｜${c.gender}｜${c.age} 岁｜${c.jobTitle}｜${c.department}`,
    `司龄：${c.tenureMonths} 个月｜${c.location}｜汇报：${c.reportLine}`,
    `薪酬：${c.compensationBand}`,
    `当前局面：${c.situation}`,
    `员工立场：${c.employeeStance}`,
    `底线：${c.bottomLine}`,
    `雷区：${c.triggers.join("；")}`,
    `表达习惯：${c.speechHabits}`,
    `绩效/事实摘要：${c.performanceSummary}`,
  ].join("\n");
}

function customContextBrief(sess) {
  const t = String(sess?.customContext || "").trim();
  if (!t) return "";
  return `\n【HR 补充背景】\n${t}`;
}

function sanitizeCoachReply(raw) {
  let s = String(raw || "").trim();
  s = s.replace(/^```(?:text|markdown)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
  s = s.replace(/^(建议|HR|人力资源|参考话术)[：:]\s*/i, "");
  return s.trim();
}

const COACH_SYSTEM = `你是资深劳动关系与沟通教练，正在旁观摩一场「HR 与员工」的一对一谈判演练。你的任务：只帮扮演 HR 的用户起草**下一句**现场可以说出来的话。

硬性要求：
- 只输出一段连续口语正文，不要分段标题，不要 markdown，不要 STATE_JSON，不要替员工代言。
- 语气专业、稳重、合规导向；先接住对方情绪或关切（如需要），再澄清程序或方案，避免空泛画饼。
- 长度约 120～280 字；不要罗列超过两个问号；不要「作为 AI」式元话语。`;

const REVIEW_SYSTEM = `你是资深 HR 沟通教练。请基于完整对话，对 HR 的沟通水平做整体评价并给出可执行复盘建议。

输出要求（严格遵守）：
1) 只输出纯文本，不要 markdown、不要代码块、不要多余寒暄。
2) 按以下结构输出：
【整体评价】
- 沟通水平：初级/中级/高级（三选一）
- 一句话结论：不超过 40 字

【优势】
1. ...
2. ...

【主要问题】
1. ...
2. ...
3. ...

【复盘提升建议】
1. 下次开场怎么说（给一条可直接说的话）
2. 遇到阻力时怎么追问（给一条可直接说的话）
3. 如何收尾推进（给一条可直接说的话）

3) 内容务必贴合这场对话，不要空泛模板。`;

const METRIC_SYSTEM = `你是谈判评估器。请根据本轮 HR 发言和员工回复，输出员工状态指标 JSON。
只允许输出 JSON，不要任何额外文字。
字段要求：
- trust: 0-100 整数（员工对HR信任）
- agreement: 0-100 整数（与HR达成共识程度）
- mood: 中文短词（如 警惕/抵触/缓和/合作/愤怒/疲惫/冷静）
- stage: 中文短词（试探期/对峙期/缓和期/收尾期）
- note: 12字以内简短说明

评估原则（必须遵守）：
1) 采用“渐进变化”，单回合 trust/agreement 变化幅度通常不超过 12 分。
2) 如果 HR 给出具体可执行项（金额、时间、书面承诺、流程节点），trust/agreement 应上升。
3) 如果 HR 回避问题、压迫表态、否认关切，trust/agreement 应下降。
4) 员工情绪出现强烈负向词时，mood 不能给到“合作/缓和”。
5) stage 与 agreement/mood 保持一致：低共识多为试探/对峙，高共识才进入缓和/收尾。`;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalizeStage(agreement, mood, stage) {
  const s = String(stage || "").trim();
  if (agreement >= 82 && /缓和|合作|冷静|平静/.test(mood)) return "收尾期";
  if (agreement >= 62 && !/抵触|愤怒|对抗/.test(mood)) return "缓和期";
  if (agreement <= 45 && /抵触|愤怒|对抗|激动/.test(mood)) return "对峙期";
  if (/试探|对峙|缓和|收尾/.test(s)) return s;
  return agreement >= 58 ? "缓和期" : "试探期";
}

function normalizeMetricsWithState(prevState, nextMetrics) {
  const prevTrust = Number(prevState?.trust) || 48;
  const prevAgreement = Number(prevState?.agreement) || 22;
  const rawTrust = clamp(Math.round(Number(nextMetrics?.trust) || prevTrust), 0, 100);
  const rawAgreement = clamp(Math.round(Number(nextMetrics?.agreement) || prevAgreement), 0, 100);
  const trust = clamp(rawTrust, prevTrust - 12, prevTrust + 12);
  const agreement = clamp(rawAgreement, prevAgreement - 12, prevAgreement + 12);
  const mood = String(nextMetrics?.mood || "观望").trim() || "观望";
  const stage = normalizeStage(agreement, mood, nextMetrics?.stage);
  const note = String(nextMetrics?.note || "").trim().slice(0, 12);
  return { trust, agreement, mood, stage, note };
}

function parseMetricJson(raw) {
  const text = String(raw || "").trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  const candidate = match[0];

  const tryParse = (input) => {
    try {
      const parsed = JSON.parse(input);
      const trust = Math.max(0, Math.min(100, Number(parsed.trust) || 0));
      const agreement = Math.max(0, Math.min(100, Number(parsed.agreement) || 0));
      const mood = String(parsed.mood || "").trim();
      const stage = String(parsed.stage || "").trim();
      const note = String(parsed.note || "").trim();
      if (!mood || !stage) return null;
      return { trust, agreement, mood, stage, note };
    } catch {
      return null;
    }
  };

  const direct = tryParse(candidate);
  if (direct) return direct;

  // 容错：修复常见的类 JSON 输出（单引号、未加引号的 key、尾随逗号）
  const repaired = candidate
    .replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":')
    .replace(/:\s*'([^']*)'/g, ': "$1"')
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]");
  const repairedParsed = tryParse(repaired);
  if (repairedParsed) return repairedParsed;

  return null;
}

function inferMood(text) {
  const s = String(text || "");
  if (/怒|抵触|对抗|激动|发火|不满|绕弯子/.test(s)) return "抵触";
  if (/委屈|难过|伤心|压力|房贷|孩子|社保/.test(s)) return "警惕";
  if (/可以|愿意|配合|接受|理解|谢谢/.test(s)) return "缓和";
  return "观望";
}

function inferStage(agreement, mood) {
  if (agreement >= 80) return "收尾期";
  if (agreement >= 58) return "缓和期";
  if (/抵触|愤怒/.test(mood)) return "对峙期";
  return "试探期";
}

function fallbackMetricsFromText(state, hrText, empText) {
  const hr = String(hrText || "");
  const emp = String(empText || "");
  let trust = Number(state?.trust) || 48;
  let agreement = Number(state?.agreement) || 22;
  const mood = inferMood(emp);

  if (/写在纸面|方案|补偿|社保|时间|明确|申请|书面|节点|预算|金额/.test(hr)) {
    trust += 4;
    agreement += 5;
  }
  if (/以后再说|没办法|公司规定|你先接受|必须接受|没得谈|不可能/.test(hr)) {
    trust -= 6;
    agreement -= 5;
  }
  if (/不行|不能|没用|绕弯子|不接受/.test(emp)) {
    trust -= 4;
    agreement -= 4;
  }
  if (/可以|那就|接受|谢谢/.test(emp)) {
    trust += 3;
    agreement += 4;
  }

  return normalizeMetricsWithState(state, {
    trust,
    agreement,
    mood,
    stage: inferStage(agreement, mood),
    note: "规则兜底评估",
  });
}

/**
 * @param {string} sessionId
 * @returns {Promise<{ suggestion?: string, error?: string }>}
 */
export async function suggestHrReply(sessionId) {
  if (!isLlmConfigured()) {
    return { error: "未配置大模型，无法生成推荐。请配置 ARK_API_KEY 或 ARK_ENDPOINT_ID 后重启。" };
  }

  const sess = getSession(sessionId);
  if (!sess) return { error: "会话不存在" };

  const c = sess.character;
  const scene = scenarioTitle(c.scenarioId);
  const state = sess.state;
  const transcript = buildTranscript(sess);

  const userPayload = [
    `场景：${scene}`,
    `当前演练状态（供参考）：信任≈${state.trust}，共识≈${state.agreement}，情绪：${state.mood}，阶段：${state.stage}`,
    "",
    "【员工背景与事实】",
    characterBrief(c),
    "",
    "【截至目前的对话】",
    transcript || "（尚无 HR 发言，仅员工开场）",
    customContextBrief(sess),
    "",
    "请给出 HR **下一句**回应建议（仅一段可直接复制发送的正文）。",
  ].join("\n");

  const raw = await completeCoachChat([
    { role: "system", content: COACH_SYSTEM },
    { role: "user", content: userPayload },
  ]);

  const suggestion = sanitizeCoachReply(raw);
  if (!suggestion) return { error: "教练模型未返回有效文本" };
  return { suggestion };
}

/**
 * @param {string} sessionId
 * @returns {Promise<{ review?: string, error?: string }>}
 */
export async function evaluateHrSession(sessionId) {
  if (!isLlmConfigured()) {
    return { error: "未配置大模型，无法生成整体评价。请配置 ARK_API_KEY 或 ARK_ENDPOINT_ID 后重启。" };
  }

  const sess = getSession(sessionId);
  if (!sess) return { error: "会话不存在" };

  const c = sess.character;
  const scene = scenarioTitle(c.scenarioId);
  const state = sess.state;
  const transcript = buildTranscript(sess);

  const userPayload = [
    `场景：${scene}`,
    `当前演练状态（供参考）：信任≈${state.trust}，共识≈${state.agreement}，情绪：${state.mood}，阶段：${state.stage}`,
    "",
    "【员工背景与事实】",
    characterBrief(c),
    "",
    "【截至目前的完整对话】",
    transcript || "（尚无 HR 发言，仅员工开场）",
    customContextBrief(sess),
    "",
    "请输出 HR 的整体沟通评价与复盘建议。",
  ].join("\n");

  const raw = await completeCoachChat([
    { role: "system", content: REVIEW_SYSTEM },
    { role: "user", content: userPayload },
  ]);

  const review = sanitizeCoachReply(raw);
  if (!review) return { error: "教练模型未返回有效评价" };
  return { review };
}

export async function evaluateVoiceTurnMetrics(sessionId, hrText, empText) {
  if (!isLlmConfigured()) {
    return { error: "未配置大模型，无法评估仪表盘指标。" };
  }
  const sess = getSession(sessionId);
  if (!sess) return { error: "会话不存在" };
  const hr = String(hrText || "").trim();
  const emp = String(empText || "").trim();
  if (!hr || !emp) return { error: "缺少本轮对话文本" };

  const userPayload = [
    `场景：${scenarioTitle(sess.character.scenarioId)}`,
    `当前状态：trust=${sess.state.trust}, agreement=${sess.state.agreement}, mood=${sess.state.mood}, stage=${sess.state.stage}`,
    `HR本轮：${hr}`,
    `员工本轮：${emp}`,
    "请输出新的状态 JSON。",
  ].join("\n");

  const raw = await completeCoachChat([
    { role: "system", content: METRIC_SYSTEM },
    { role: "user", content: userPayload },
  ]);
  const modelMetrics = parseMetricJson(raw);
  const metrics = modelMetrics
    ? normalizeMetricsWithState(sess.state, modelMetrics)
    : fallbackMetricsFromText(sess.state, hr, emp);
  const saved = applyVoiceTurnMetrics(sessionId, hr, emp, metrics);
  if (!saved) return { error: "写入会话状态失败" };
  return { state: saved.state, note: metrics.note };
}
