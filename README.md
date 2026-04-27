# 配置接入说明

本项目已经移除所有写死凭证。你需要自己在 `server/.env` 填写密钥后再启动服务。

## 控制台入口（含免费额度）

- 语音模型（OpenSpeech）：[https://console.volcengine.com/speech/service/10017?AppID=7992192743](https://console.volcengine.com/speech/service/10017?AppID=7992192743)
- 推理模型（方舟 API Key）：[https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey)
- 两个页面通常都可以看到试用或免费额度入口，建议先领取再开始联调。

## 1) 复制配置模板

在项目根目录执行：

```bash
cp .env.example server/.env
```

## 2) 配置文本推理模型（方舟）

二选一：

- 方式 A（推荐）：填写 `ARK_API_KEY`
- 方式 B：填写 `VOLC_ACCESSKEY` + `VOLC_SECRETKEY` + `ARK_ENDPOINT_ID`

并填写模型：

- `ARK_MODEL`：主对话模型（例如你的模型 ID 或接入点 ID）
- `ARK_COACH_MODEL`：教练模型，可选，不填则复用 `ARK_MODEL`

## 3) 配置语音能力（OpenSpeech）

必填：

- `VOLC_APP_ID`
- `VOLC_ACCESS_TOKEN`
- `VOLC_APP_KEY`

可选（有默认值）：

- `VOLC_WS_URL`
- `VOLC_RESOURCE_ID`
- `VOLC_MODEL`
- `VOLC_SPEAKER`

## 4) 启动前自检

确保 `server/.env` 中以下字段不为空：

- 文本推理：`ARK_API_KEY` 或 (`VOLC_ACCESSKEY` + `VOLC_SECRETKEY` + `ARK_ENDPOINT_ID`)
- 语音：`VOLC_APP_ID`、`VOLC_ACCESS_TOKEN`、`VOLC_APP_KEY`

## 5) 启动服务

按你原项目方式启动前后端。若后端提示未配置，请检查 `server/.env` 是否被正确加载，并重启后端进程。

