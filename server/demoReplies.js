import { parseStateLine, stripStateLine } from "./prompts.js";

const soft = ["理解", "抱歉", "谢谢", "我们可以", "书面", "时间", "安排", "尊重", "具体", "方案", "补偿", "保障"];
const hard = ["必须", "今天", "签字", "不胜任", "违纪", "垫底", "你这种", "威胁", "按规定"];

export function demoEmployeeReply(character, hrText, prevState) {
  const t = (hrText || "").trim();
  let deltaTrust = 0;
  let deltaAgree = 2;
  for (const w of soft) if (t.includes(w)) deltaTrust += 3;
  for (const w of hard) if (t.includes(w)) deltaTrust -= 6;
  if (t.length < 8) deltaTrust -= 4;

  const trust = clamp(prevState.trust + deltaTrust + (Math.random() * 6 - 3), 5, 95);
  const agreement = clamp(prevState.agreement + deltaAgree + (trust > 55 ? 4 : -2), 5, 95);

  const mood =
    trust < 35 ? "抵触" : trust < 55 ? "警惕" : agreement > 70 ? "松动" : "观望";
  const stage =
    agreement > 80 ? "收尾期" : trust < 40 ? "对峙期" : agreement > 45 ? "缓和期" : "试探期";

  const lines = [
    `我是${character.name}。你刚才那句我听见了——但我要先把我的关切对齐：程序、依据、时间表，缺一不可。`,
    `我不想吵，但也不想被糊弄。${character.bottomLine.slice(0, 36)}…这是我特别在意的。`,
    `可以，先把今天谁能拍板、书面什么时候给说清楚，我再往下接。`,
  ];
  const body = pick(lines, hash(t + character.id));

  const raw = `${body}\nSTATE_JSON:${JSON.stringify({
    trust,
    agreement,
    mood,
    stage,
    note: "演示模式：规则估算状态",
  })}`;

  const parsed = parseStateLine(raw) || {
    trust: 50,
    agreement: 35,
    mood: "观望",
    stage: "试探期",
    note: "",
  };

  return {
    raw,
    visible: stripStateLine(raw),
    state: parsed,
    demo: true,
  };
}

function pick(arr, h) {
  return arr[Math.abs(h) % arr.length];
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, Math.round(n)));
}
