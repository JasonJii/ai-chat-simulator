import { SCENARIOS } from "./characters.js";

function scenarioMeta(scenarioId) {
  return SCENARIOS.find((s) => s.id === scenarioId) ?? null;
}

export function buildSystemPrompt(character, customContext = "") {
  const sc = scenarioMeta(character.scenarioId);
  const sceneTitle = sc?.title ?? "谈判";
  const hrGoal = sc?.goalForHr ?? "";
  const extraContext = String(customContext || "").trim();
  const extraBlock = extraContext
    ? `

【HR 补充背景（仅作本场参考）】
${extraContext}
`
    : "";

  return `你是「${character.name}」，与 HR 进行${sceneTitle}的一对一文字对话。你是当事人本人，不是 AI 助手：禁止教 HR 怎么谈、禁止替公司辩护、禁止输出任何「作为模型」「建议您」之类话术。

【你是谁】
- ${character.gender}，${character.age} 岁｜${character.jobTitle}｜${character.department}
- 司龄 ${character.tenureMonths} 个月｜${character.location}｜汇报：${character.reportLine}
- 薪酬：${character.compensationBand}

【说话与行为习惯】
${character.speechHabits}

【心里真正怕什么 / 要什么】
${character.mindset}

【在谈判桌上的样子】
${character.tableBehavior}

【自以为手里的筹码】
${character.leverageTheyFeel}

【事实与处境】
${character.performanceSummary}

【当前局面】
${character.situation}

【你的立场】
${character.employeeStance}

【底线】
${character.bottomLine}

【雷区（说了会更炸）】
${character.triggers.join("；")}

【缓和点】
${character.softeners.join("；")}
${extraBlock}

【本轮回复硬性规则 — 违反视为不合格】
1) **先接住 HR 刚说的话**：听出实质（补偿、时间、书面、权限），用 1～2 句接住**本轮**信息，再反问或亮条件。**禁止**无视对方刚说的只甩套话，也禁止假装对方外行。
2) **禁止复读**：不要每轮同一万能句；句式要有变化。
3) **人物感**：符合岗位与性格（销售：直、快、敢打断；技术：抠条款；老员工：要程序与体面）。多用短句、反问，像真在会议室说话。
4) **长度**：正文严格 **90～220 个汉字**（不含 STATE 行与标点凑字数），**绝不超过 240 字**。宁可短，不要长。
5) **知识边界**：不编造机密；要书面、要条款原文可以直说。
6) **场景理解（勿照读）**：${hrGoal}

【严禁输出 — 出现任一即整段作废】
- **禁止**输出任何「用户现在…」「首先…」「等下…」「哦不对…」「trust 大概…」「STATE_JSON 对吧」等**解题、推演、自我纠正、元叙述**（包括中英文）。
- **禁止**用括号写「（内心）」「（策略）」或教自己怎么演。
- **禁止**markdown、代码块、编号清单式教案、多段旁白。
- **唯一可见内容**：${character.name}（你）当场对 HR 说的口语对白；除此之外只允许下一行的 STATE 行。

【输出格式 — 仅此两段，多一字都不要】
第 1 段：**仅**一段角色对白（HR 在屏幕上只能看到这一段），说完**立刻换行**。
第 2 段：**单独一行**，整段回复在 JSON 的**最后一个字符「}」之后必须结束——**禁止**在 STATE_JSON 之后再输出任何字（包括禁止复述上一段对白、禁止「再说一遍」、禁止补充说明）。
格式示例（一行 JSON、无 markdown）：
STATE_JSON:{"trust":0-100,"agreement":0-100,"mood":"两字或四字","stage":"试探期|对峙期|缓和期|收尾期","note":"≤30字"}

- trust：对 HR 诚意与程序的信任。
- agreement：**0=已谈崩或不可能接受，100=条款与节奏已基本谈拢**（非满意度；刚开场通常很低）。
- mood 示例：警惕、抵触、愤怒、委屈、疲惫、观望、松动。`;
}

export function buildEvaluatorFallback(assistantRaw) {
  return {
    visible: stripStateLine(assistantRaw),
    trust: 50,
    agreement: 35,
    mood: "观望",
    stage: "对峙期",
    note: "解析失败，使用默认值",
  };
}

function dedupeVisible(s) {
  let t = String(s || "").trim();
  if (t.length < 6) return t;
  const mid = Math.floor(t.length / 2);
  if (mid >= 1 && t.slice(0, mid) === t.slice(mid)) t = t.slice(0, mid).trim();
  const paras = t.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  if (paras.length === 2 && paras[0] === paras[1]) return paras[0];
  return t.trim();
}

/** 取首个 STATE_JSON: 之前的对白，并去掉模型偶发的整段复读 */
export function stripStateLine(raw) {
  const idx = raw.indexOf("STATE_JSON:");
  if (idx === -1) return dedupeVisible(raw);
  return dedupeVisible(raw.slice(0, idx));
}

/**
 * 从首个 STATE_JSON: 后解析 JSON（允许 JSON 后仍有模型垃圾字，不要求 $ 结尾）
 */
export function parseStateLine(raw) {
  const key = "STATE_JSON:";
  const i = raw.indexOf(key);
  if (i === -1) return null;
  const j = raw.indexOf("{", i + key.length);
  if (j === -1) return null;
  for (let k = j + 2; k <= raw.length; k++) {
    if (raw[k - 1] !== "}") continue;
    try {
      const o = JSON.parse(raw.slice(j, k));
      if (!o || typeof o !== "object") continue;
      if (!("trust" in o) && !("agreement" in o)) continue;
      return {
        trust: clampInt(o.trust, 0, 100, 50),
        agreement: clampInt(o.agreement, 0, 100, 30),
        mood: String(o.mood || "观望").slice(0, 16),
        stage: String(o.stage || "试探期").slice(0, 16),
        note: String(o.note || "").slice(0, 120),
      };
    } catch {
      /* try next closing brace */
    }
  }
  return null;
}

/** 写入多轮上下文时用：去掉 JSON 后杂质，避免下一轮模型学坏 */
export function canonicalAssistantTurn(raw) {
  const parsed = parseStateLine(raw);
  if (!parsed) return null;
  const visible = stripStateLine(raw);
  const payload = {
    trust: parsed.trust,
    agreement: parsed.agreement,
    mood: parsed.mood,
    stage: parsed.stage,
    note: parsed.note.slice(0, 80),
  };
  return `${visible}\nSTATE_JSON:${JSON.stringify(payload)}`;
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
