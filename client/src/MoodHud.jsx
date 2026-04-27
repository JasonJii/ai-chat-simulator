import { useId } from "react";

/** 情绪 → 头像变体 + 仪表盘刻度（与后端返回的中文词兼容） */

export function resolveMoodVariant(mood) {
  const s = String(mood || "");
  if (/怒|抵触|对抗|激动|发火/.test(s)) return "hostile";
  if (/委屈|难过|伤心/.test(s)) return "upset";
  if (/疲惫|累|倦|失眠|崩溃/.test(s)) return "weary";
  if (/松动|缓和|合作|平静|冷静|放松/.test(s)) return "soft";
  if (/警惕|戒备|防备/.test(s)) return "tense";
  if (/观望|犹豫/.test(s)) return "neutral";
  return "tense";
}

export function moodToGaugeValue(mood) {
  const s = String(mood || "");
  if (/怒|抵触|对抗/.test(s)) return 12;
  if (/委屈|难过/.test(s)) return 28;
  if (/疲惫|累|倦/.test(s)) return 36;
  if (/松动|缓和|合作/.test(s)) return 86;
  if (/平静|冷静|放松/.test(s)) return 72;
  if (/观望|犹豫/.test(s)) return 54;
  if (/警惕|戒备/.test(s)) return 40;
  return 48;
}

export function stageToGaugeValue(stage) {
  const s = String(stage || "");
  if (/试探/.test(s)) return 18;
  if (/对峙/.test(s)) return 42;
  if (/缓和/.test(s)) return 68;
  if (/收尾/.test(s)) return 90;
  return 38;
}

function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

/** 半圆仪表：0=左端（低压），100=右端（高压）；情绪/阶段通用 */
export function SemiGauge({ label, value, caption, accent = "var(--accent)" }) {
  const gradId = useId().replace(/:/g, "");
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const cx = 100;
  const cy = 88;
  const r = 72;
  const start = 180;
  const end = 0;
  const needleDeg = start - (v / 100) * (start - end);
  const n = polar(cx, cy, r - 8, needleDeg);

  const arcBg = `M ${polar(cx, cy, r, start).x} ${polar(cx, cy, r, start).y} A ${r} ${r} 0 0 1 ${polar(cx, cy, r, end).x} ${polar(cx, cy, r, end).y}`;
  const tickLow = polar(cx, cy, r + 4, 165);
  const tickMid = polar(cx, cy, r + 4, 90);
  const tickHi = polar(cx, cy, r + 4, 15);

  return (
    <div className="semi-gauge">
      <div className="semi-gauge-label">{label}</div>
      <svg className="semi-gauge-svg" viewBox="0 0 200 100" aria-hidden>
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(251,113,133,0.85)" />
            <stop offset="45%" stopColor="rgba(251,191,36,0.75)" />
            <stop offset="100%" stopColor="rgba(52,211,153,0.85)" />
          </linearGradient>
        </defs>
        <path d={arcBg} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="12" strokeLinecap="round" />
        <path d={arcBg} fill="none" stroke={`url(#${gradId})`} strokeWidth="6" strokeLinecap="round" opacity={0.95} />
        <circle cx={tickLow.x} cy={tickLow.y} r="2" fill="rgba(255,255,255,0.35)" />
        <circle cx={tickMid.x} cy={tickMid.y} r="2" fill="rgba(255,255,255,0.35)" />
        <circle cx={tickHi.x} cy={tickHi.y} r="2" fill="rgba(255,255,255,0.35)" />
        <line x1={cx} y1={cy} x2={n.x} y2={n.y} stroke={accent} strokeWidth="3" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="6" fill="var(--card)" stroke={accent} strokeWidth="2" />
      </svg>
      <div className="semi-gauge-caption">
        <strong>{caption}</strong>
        <span className="semi-gauge-num">{v}</span>
      </div>
    </div>
  );
}

function FaceHostile() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M28 38 L36 32 M52 32 L60 38" />
      <circle cx="34" cy="48" r="3.5" fill="currentColor" stroke="none" />
      <circle cx="54" cy="48" r="3.5" fill="currentColor" stroke="none" />
      <path d="M36 62 Q44 56 52 62" />
    </g>
  );
}

function FaceUpset() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M30 34 Q34 30 38 34 M50 34 Q54 30 58 34" />
      <ellipse cx="36" cy="48" rx="3" ry="4" fill="currentColor" stroke="none" />
      <ellipse cx="52" cy="48" rx="3" ry="4" fill="currentColor" stroke="none" />
      <path d="M38 62 Q44 58 50 62" />
    </g>
  );
}

function FaceWeary() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M32 40 L40 40 M48 40 L56 40" />
      <path d="M34 50 Q38 46 42 50 M46 50 Q50 46 54 50" />
      <path d="M38 64 Q44 60 50 64" />
    </g>
  );
}

function FaceTense() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="36" cy="46" r="4" fill="currentColor" stroke="none" />
      <circle cx="52" cy="46" r="4" fill="currentColor" stroke="none" />
      <path d="M32 32 L40 36 M48 36 L56 32" />
      <path d="M38 60 H50" />
    </g>
  );
}

function FaceNeutral() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="36" cy="46" r="3.5" fill="currentColor" stroke="none" />
      <circle cx="52" cy="46" r="3.5" fill="currentColor" stroke="none" />
      <path d="M38 60 H50" />
    </g>
  );
}

function FaceSoft() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M32 36 Q36 40 40 36 M48 36 Q52 40 56 36" />
      <circle cx="36" cy="48" r="3" fill="currentColor" stroke="none" />
      <circle cx="52" cy="48" r="3" fill="currentColor" stroke="none" />
      <path d="M36 58 Q44 66 52 58" />
    </g>
  );
}

const FACES = {
  hostile: FaceHostile,
  upset: FaceUpset,
  weary: FaceWeary,
  tense: FaceTense,
  neutral: FaceNeutral,
  soft: FaceSoft,
};

const VARIANT_STYLE = {
  hostile: { ring: "rgba(251,113,133,0.45)", glow: "rgba(251,113,133,0.25)", color: "#fecdd3" },
  upset: { ring: "rgba(167,139,250,0.5)", glow: "rgba(167,139,250,0.2)", color: "#ddd6fe" },
  weary: { ring: "rgba(148,163,184,0.45)", glow: "rgba(148,163,184,0.18)", color: "#cbd5e1" },
  tense: { ring: "rgba(251,191,36,0.45)", glow: "rgba(251,191,36,0.2)", color: "#fde68a" },
  neutral: { ring: "rgba(110,231,255,0.4)", glow: "rgba(110,231,255,0.15)", color: "#a5f3fc" },
  soft: { ring: "rgba(52,211,153,0.45)", glow: "rgba(52,211,153,0.22)", color: "#a7f3d0" },
};

export function MoodAvatar({ mood, name }) {
  const variant = resolveMoodVariant(mood);
  const Face = FACES[variant] || FaceTense;
  const st = VARIANT_STYLE[variant] || VARIANT_STYLE.tense;

  return (
    <div className="mood-avatar-wrap">
      <div
        className="mood-avatar-ring"
        style={{
          borderColor: st.ring,
          boxShadow: `0 0 28px ${st.glow}`,
        }}
      >
        <svg className="mood-avatar-svg" viewBox="0 0 88 88" style={{ color: st.color }}>
          <circle cx="44" cy="44" r="40" fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
          <Face />
        </svg>
      </div>
      <div className="mood-avatar-meta">
        <span className="mood-avatar-name">{name}</span>
        <span className="mood-avatar-mood">{mood || "—"}</span>
      </div>
    </div>
  );
}

export function DashboardRow({ mood, stage, name, round }) {
  const moodV = moodToGaugeValue(mood);
  const stageV = stageToGaugeValue(stage);

  return (
    <div className="dashboard-row">
      <MoodAvatar mood={mood} name={name} />
      <div className="dashboard-gauges">
        <SemiGauge label="情绪指数" value={moodV} caption={mood || "—"} accent="rgba(251,191,36,0.95)" />
        <SemiGauge label="谈判阶段" value={stageV} caption={stage || "—"} accent="rgba(110,231,255,0.95)" />
      </div>
      <div className="dashboard-round">
        <span className="dashboard-round-label">回合</span>
        <span className="dashboard-round-num">{round}</span>
      </div>
    </div>
  );
}
