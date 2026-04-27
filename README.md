# 配置接入说明

## 项目功能

这是一个「HR 谈判模拟」训练项目，支持文本与语音两种演练方式，帮助用户练习与员工沟通、协商与复盘能力。

- 员工角色扮演：根据不同场景和角色档案，模拟员工在谈判中的真实反馈。
- 实时语音对练：支持麦克风输入、ASR 识别、TTS 回放和自动断句提交，形成接近实战的一问一答。
- 文本流式对话：支持 HR 发言后的流式员工回复，实时展示对话进展。
- HR 教练能力：可生成“下一句推荐话术”，辅助用户当场推进谈判。
- 会话复盘评估：基于完整对话输出整体评价与改进建议。
- 状态仪表盘：按回合更新信任度、共识度、情绪、阶段等指标，便于观察策略效果。
- 自定义背景注入：支持在开局补充业务背景、预算边界、上下文信息。

## 技术结构（简要）

- 前端（`client`）：React + Vite，负责对话界面、语音采集播放、状态展示。
- 后端（`server`）：Node.js + Express + WebSocket，负责会话编排、模型调用、语音桥接。
- 推理模型：火山方舟（Ark）用于文本对话、教练建议与评估。
- 语音模型：OpenSpeech 实时语音对话用于 ASR/TTS 与语音对练链路。

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

