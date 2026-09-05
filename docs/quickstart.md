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

## Option B — install into an existing DSH / 方案 B：装进你已有的 DSH（推荐，进程内原生）

No external gateway process needed: the plugin runs the chat bridge **inside DSH**.
无需外部 gateway 进程：插件直接在 DSH 进程内跑聊天桥接（v0.2.0 起）。

```bash
# 1. 安装插件（DSH 官方插件安装方式）
dsh plugin --profile web add @dsh-overdrive/gateway-core

# 2. 配置平台 token（任一，缺省回落同名环境变量）
# 2a. Telegram：@BotFather 创建 bot
setx DSH_TELEGRAM_TOKEN <bot token>          # Windows
export DSH_TELEGRAM_TOKEN=<bot token>        # macOS / Linux
# 也可在 profile 的 cordis.patch.yml 覆盖 config.telegramToken

# 3. 重启 dsh web，然后给你的 bot 发消息即可（无需任何外部进程/端口）
dsh web
```

The plugin auto-uses the model configured in your DSH Web UI; `/help`、`/new`、
`/remind 30s <提示>`（原生）可用，审批请求会以文字「批准/拒绝」在聊天中回复。
未配置 token 时插件以禁用态加载（仅告警），不会影响 DSH 其它功能。

> **旧外部 gateway 模式（legacy，仍可用但不推荐）**：`DSH_OVERDRIVE_TOKEN`
> + `npx dsh-overdrive-gateway` 方式保留；后续版本将逐步退役外部 gateway。

## Option C — from source / 方案 C：源码运行（开发）

```bash
npm install && npm run build
GATEWAY_ADAPTERS=telegram TELEGRAM_BOT_TOKEN=<token> node packages/gateway/dist/index.js
```

## Platform setup / 平台接入

| Platform | What you need / 你需要什么 |
|---|---|
| **Telegram** | Bot token from @BotFather —— **原生进程内支持**（推荐，v0.2.0） |
| **WhatsApp** | Nothing — scan the QR shown on first start / 无需配置，首次启动扫码（legacy gateway） |
| **Discord** | Bot token / Developer Portal 创建 bot（legacy gateway） |
| **Slack** | Socket Mode tokens / App 开启 Socket Mode（legacy gateway） |
| **飞书 Feishu** | App ID + Secret / 开放平台创建应用（legacy gateway） |
| **钉钉 DingTalk** | Client ID + Secret / 创建企业内部应用（legacy gateway） |
| **企业微信 WeCom** | Corp ID + Secret + Agent ID + token + AES key（legacy gateway） |

> legacy gateway = 仍需外部 `@dsh-overdrive/gateway` 进程；平台正在逐个迁入进程内原生。

## Commands / 聊天命令

| Command | What it does / 作用 |
|---|---|
| `/help` | List commands / 命令列表 |
| `/trace` | Replay the last turn's trajectory / 最近一轮轨迹摘要 |
| `/task <prompt>` | Spawn a subagent / 派子任务 |
| `/cron <min hour dom mon dow> <prompt>` | Schedule a recurring job / 定时任务 |
| `/agents` | Subagent status / 子任务状态 |
| `/new` | Reset the conversation / 重置会话 |
| `/remind <N><s\|m\|h> <提示>` | One-shot reminder（原生） / 一次性提醒 |

> `/trace`、`/task`、`/cron`、`/agents` 目前由 legacy gateway 提供；原生模式逐步补齐。

## Troubleshooting / 排障

- **Model not responding / 没有回复**：在 DSH Web UI（3080）确认模型已配置；插件会自动使用默认模型路由。
- **WhatsApp QR timeout / 二维码超时**：重启 gateway 重新出码，或用 WhatsApp「设置 → 已连接设备」保持会话。
- **Want zero public URL? / 免公网**：Telegram（长轮询）/ Slack（Socket）/ 钉钉（Stream）/ 飞书（长连接）都不需要公网地址。
