# Quick Start / 快速开始

> Goal: from zero to chatting in under 3 minutes / 目标：3 分钟内从零到能聊天。

## Option A — Docker, one command / 方案 A：Docker 一条命令（推荐）

**Prereqs:** Docker + Docker Compose. **要求：** 已装 Docker。

```bash
git clone https://github.com/temotee2103/dsh-overdrive && cd dsh-overdrive
cp deploy/.env.example .env        # 编辑 .env：填 DEEPSEEK_API_KEY + TELEGRAM_BOT_TOKEN（可选）
docker compose -f deploy/docker-compose.yml up -d --build
# Console / 控制台: http://localhost:3190/   DSH Web UI: http://localhost:3080/
```

Then message your bot → run `/help`. / 然后给 bot 发消息，输入 `/help` 开始。

> The image is built locally on first run (takes a few minutes). / 首次运行会在本地构建镜像，需几分钟。

## Option B — install into an existing DSH / 方案 B：装进你已有的 DSH（一条命令）

Already running DSH? Just add the plugin and the gateway / 已有 DSH？装插件 + 起 gateway 即可：

```bash
# 1. 安装插件（DSH 官方插件安装方式）
dsh plugin --profile web add @dsh-overdrive/gateway-core

# 2. 起 gateway（指向你的 DSH）
npx @dsh-overdrive/gateway
# 或全局安装后直接运行
npm i -g @dsh-overdrive/gateway
GATEWAY_ADAPTERS=telegram TELEGRAM_BOT_TOKEN=<token> dsh-overdrive-gateway
```

The plugin auto-uses the model configured in your DSH Web UI. / 插件自动使用你在 DSH Web UI 里配置的模型。

## Option C — from source / 方案 C：源码运行（开发）

```bash
npm install && npm run build
GATEWAY_ADAPTERS=telegram TELEGRAM_BOT_TOKEN=<token> node packages/gateway/dist/index.js
```

## Platform setup / 平台接入

| Platform | What you need / 你需要什么 |
|---|---|
| **Telegram** | Bot token from @BotFather (~3 min) / @BotFather 创建 bot 拿 token |
| **WhatsApp** | Nothing — scan the QR shown on first start / 无需配置，首次启动扫码 |
| **Discord** | Bot token / Developer Portal 创建 bot |
| **Slack** | Socket Mode tokens / App 开启 Socket Mode |
| **飞书 Feishu** | App ID + Secret / 开放平台创建应用 |
| **钉钉 DingTalk** | Client ID + Secret / 创建企业内部应用 |
| **企业微信 WeCom** | Corp ID + Secret + Agent ID + token + AES key |

## Commands / 聊天命令

| Command | What it does / 作用 |
|---|---|
| `/help` | List commands / 命令列表 |
| `/trace` | Replay the last turn's trajectory / 最近一轮轨迹摘要 |
| `/task <prompt>` | Spawn a subagent / 派子任务 |
| `/cron <min hour dom mon dow> <prompt>` | Schedule a recurring job / 定时任务 |
| `/agents` | Subagent status / 子任务状态 |
| `/new` | Reset the conversation / 重置会话 |

## Troubleshooting / 排障

- **Model not responding / 没有回复**：在 DSH Web UI（3080）确认模型已配置；插件会自动使用默认模型路由。
- **WhatsApp QR timeout / 二维码超时**：重启 gateway 重新出码，或用 WhatsApp「设置 → 已连接设备」保持会话。
- **Want zero public URL? / 免公网**：Telegram（长轮询）/ Slack（Socket）/ 钉钉（Stream）/ 飞书（长连接）都不需要公网地址。
