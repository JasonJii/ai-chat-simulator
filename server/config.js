import "./env.js";

function readEnv(name, fallback = "") {
  const v = process.env[name];
  if (v === undefined || v === null) return fallback;
  return String(v).trim();
}

function readBool(name, fallback = false) {
  const raw = readEnv(name, "");
  if (!raw) return fallback;
  const v = raw.toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export const appConfig = {
  port: Number(readEnv("PORT", "8787")) || 8787,
  demoMode: readBool("DEMO_MODE", false),

  ark: {
    baseUrl: readEnv("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3"),
    apiKey: readEnv("ARK_API_KEY", ""),
    model: readEnv("ARK_MODEL", ""),
    coachModel: readEnv("ARK_COACH_MODEL", ""),
    endpointId: readEnv("ARK_ENDPOINT_ID", ""),
    useResponses: readBool("ARK_USE_RESPONSES", true),
    thinking: (readEnv("ARK_THINKING", "disabled") || "disabled").toLowerCase(),
    accessKeyId: readEnv("VOLC_ACCESS_KEY_ID", "") || readEnv("VOLC_ACCESSKEY", ""),
    secretAccessKey: readEnv("VOLC_SECRET_ACCESS_KEY", "") || readEnv("VOLC_SECRETKEY", ""),
  },

  voice: {
    wsUrl: readEnv("VOLC_WS_URL", "wss://openspeech.bytedance.com/api/v3/realtime/dialogue"),
    appId: readEnv("VOLC_APP_ID", ""),
    accessToken: readEnv("VOLC_ACCESS_TOKEN", ""),
    appKey: readEnv("VOLC_APP_KEY", ""),
    resourceId: readEnv("VOLC_RESOURCE_ID", "volc.speech.dialog"),
    model: readEnv("VOLC_MODEL", "2.2.0.0"),
    speaker: readEnv("VOLC_SPEAKER", "zh_female_vv_jupiter_bigtts"),
  },
};

