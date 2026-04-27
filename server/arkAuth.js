import { Service } from "@volcengine/openapi";
import { appConfig } from "./config.js";

let cachedKey = "";
let cachedExpSec = 0;

function arkApiKey() {
  return appConfig.ark.apiKey;
}

function accessKeyId() {
  return appConfig.ark.accessKeyId;
}

function secretKey() {
  return appConfig.ark.secretAccessKey;
}

function endpointId() {
  return appConfig.ark.endpointId;
}

/**
 * 是否“看起来”已配置大模型（同步，用于启动会话时判断是否演示模式）
 */
export function hasLlmCredentialHint() {
  const direct = arkApiKey();
  if (direct.length > 8) return true;
  const ak = accessKeyId();
  const sk = secretKey();
  const ep = endpointId();
  return Boolean(ak && sk && ep.length > 3);
}

/**
 * 实际用于 Chat Completions 的 Bearer Token
 */
export async function resolveBearerApiKey() {
  const direct = arkApiKey();
  if (direct.length > 8) return direct;

  const ak = accessKeyId();
  const sk = secretKey();
  const ep = endpointId();
  if (!ak || !sk || !ep) return "";

  const now = Math.floor(Date.now() / 1000);
  if (cachedKey && cachedExpSec > now + 120) return cachedKey;

  const service = new Service({
    host: "ark.cn-beijing.volcengineapi.com",
    region: "cn-beijing",
    serviceName: "ark",
    defaultVersion: "2024-01-01",
    accessKeyId: ak,
    secretKey: sk,
  });

  const getApiKey = service.createJSONAPI("GetApiKey", { Version: "2024-01-01" });
  const body = await getApiKey({
    DurationSeconds: 86400,
    ResourceType: "endpoint",
    ResourceIds: [ep],
  });

  const key = body?.Result?.ApiKey;
  if (!key || typeof key !== "string") {
    throw new Error(
      `GetApiKey 未返回 ApiKey。请确认 AK/SK 有权限、ARK_ENDPOINT_ID 为控制台「推理接入点」ID（ep- 开头）。响应片段：${JSON.stringify(body).slice(0, 400)}`
    );
  }

  cachedKey = key;
  cachedExpSec = now + 86000;
  return key;
}

export function resolveChatModel() {
  const m = appConfig.ark.model;
  if (m) return m;
  const ep = endpointId();
  if (ep) return ep;
  return "";
}

/** HR 话术教练独立调用（未设置则与 ARK_MODEL 相同） */
export function resolveCoachModel() {
  const c = appConfig.ark.coachModel;
  if (c) return c;
  return resolveChatModel();
}
