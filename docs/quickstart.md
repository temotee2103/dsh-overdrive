# Quick Start / 快速开始

## One-command deploy / 一条命令部署

```bash
git clone https://github.com/temotee2103/dsh-overdrive && cd dsh-overdrive
cp deploy/.env.example .env   # 配置 DEEPSEEK_API_KEY 与平台凭据（若有）
docker compose -f deploy/docker-compose.yml up -d
# 控制台：http://<host>:3190/   DSH Web UI：http://<host>:3080/
```

> `deploy/.env.example` 尚未创建时，直接以环境变量传入 compose：
> `DSH_OVERDRIVE_TOKEN=xxx DEEPSEEK_API_KEY=xxx GATEWAY_ADAPTERS=telegram docker compose -f deploy/docker-compose.yml up -d`

## Local dev / 本地开发

```bash
npm install
npm run build
npx vitest run
npm run e2e
```

## Chat from Telegram / 用 Telegram 开聊

1. `GATEWAY_ADAPTERS=telegram TELEGRAM_BOT_TOKEN=<token> node packages/gateway/dist/index.js`
2. 给自己的 bot 发消息；`/help` 查看命令（`/trace` `/task` `/cron` `/new`）
3. 与 DSH 一起用（真机）：先起 dsh + 插件，再起 gateway 指向 `DSH_BASE_URL`

## Chat from WhatsApp / 用 WhatsApp 开聊

```bash
GATEWAY_ADAPTERS=whatsapp WHATSAPP_DATA_DIR=data/whatsapp node packages/gateway/dist/index.js
# 终端出现二维码 → WhatsApp「设置 → 已连接设备 → 扫码」
```

## Commands / 聊天命令

| 命令 | 作用 |
|---|---|
| `/help` | 命令列表 |
| `/trace` | 最近一轮轨迹摘要 |
| `/task <需求>` | 派子任务 |
| `/cron <分 时 日 月 周> <需求>` | 定时任务 |
| `/agents` | 子任务状态（简化回执） |
| `/new` | 重置会话 |
