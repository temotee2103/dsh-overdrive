# 中文渠道发布稿（CSDN / 掘金 / 知乎）

> 英文为主、中文为辅：中文平台用中文正文 + 英文标题备选。可直接粘贴发布。

## 标题（三选一）

1. **DSH 界的 OpenClaw：把 DeepSeek Harness 变成"看得见思考过程"的聊天智能体（WhatsApp/Telegram/飞书/钉钉/企业微信）**
2. **超越 Hermes/OpenClaw？我把它做成了 DSH 插件：聊天里每一步思考都能回放，危险操作必须你点头**
3. dsh-overdrive：DeepSeek Harness 多平台网关，一条命令部署、扫码即用、全程可追踪

## 正文

### 一句话

[dsh-overdrive](https://github.com/temotee2103/dsh-overdrive) 把 DeepSeek Harness（DSH）变成聊天软件里"看得见思考过程、可以随时指挥团队"的私人 agent——Hermes/OpenClaw 是黑盒，它抄不走的 session log 我们做成了聊天原生体验。

### 为什么值得看

- 🧠 **`/trace` 轨迹回放**：每一步推理与工具调用在聊天里回放成摘要卡片
- 🤖 **多智能体命令**：`/task` 派子任务、`/cron 0 9 * * * …` 定时任务（自带调度器，不依赖外部服务）
- 🔒 **原生审批按钮**：危险操作暂停，直到你点【同意/拒绝】（Telegram/Discord/Slack/WhatsApp 原生按钮）
- 🚀 **一条命令部署**：`docker compose up -d`，扫码即用，多数平台免公网 URL

### 支持的平台

WhatsApp · Telegram · Discord · Slack · **飞书** · **钉钉** · **企业微信**（+ CLI 开发调试）

### 架构要点

- `@dsh-overdrive/gateway-core`：DSH 插件，暴露 Remote Session Driver 协议——轨迹/审批/多智能体的"灵魂"在插件里，与聊天 SDK 解耦
- `@dsh-overdrive/gateway`：独立多平台网关，适配器很薄，经得起插件 API 变动
- 128+ 单元测试 + 全链路 mock E2E + GitHub Actions CI 全绿；已在真实 DSH + DeepSeek 上完成 Telegram 真机验证

### 快速体验

```bash
npm i @dsh-overdrive/gateway-core        # 作为 dsh 插件
docker compose -f deploy/docker-compose.yml up -d   # 全栈一条命令
# 聊天里输入 /help 查看全部命令
```

### 中文速览（结尾可加）

**DSH 界的 OpenClaw**——把 DeepSeek Harness 变成聊天软件里的私人 agent：WhatsApp 扫码即用、Telegram 5 分钟开聊；`/trace` 回放每一步思考与工具调用；`/task` 派子任务、`/cron` 定时任务；危险操作必须你点【同意/拒绝】；`docker compose up -d` 一条命令部署。

仓库：https://github.com/temotee2103/dsh-overdrive （双语 README + 动画演示）

---

### 发布平台备注

| 平台 | 动作 |
|---|---|
| CSDN | 选择「人工智能」或「开源」标签；文首放动画演示链接 |
| 掘金 | 选「AI」+「开源」标签；标题用 1 号（蹭 OpenClaw 热度） |
| 知乎 | 问题式回答："如何把 DeepSeek Harness 变成多平台聊天机器人？" 首答 |
