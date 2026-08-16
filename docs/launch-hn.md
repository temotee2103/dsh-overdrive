# Show HN — dsh-overdrive

> English-first post for Hacker News. Copy-paste ready. Title options below.

## Title options

1. **Show HN: dsh-overdrive – the OpenClaw of DeepSeek Harness (chat from WhatsApp/Telegram/Discord/Feishu/DingTalk)**
2. **Show HN: I built a chat agent you can see thinking – OpenClaw-style gateway for DeepSeek Harness**
3. **Show HN: dsh-overdrive – turn DeepSeek Harness into a multi-platform chat agent with traceable thoughts**

## Body

Hi HN!

I built [dsh-overdrive](https://github.com/temotee2103/dsh-overdrive) — an OpenClaw-style gateway that turns [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) (DSH) into a chat agent you can talk to from **WhatsApp, Telegram, Discord, Slack, Feishu (飞书), DingTalk (钉钉), and WeCom (企业微信)**.

**Why not just OpenClaw?**
Hermes/OpenClaw give you a terminal agent behind 20+ chat channels — but it's a black box. DSH's append-only session log is the thing they can't copy. dsh-overdrive makes it chat-native:

- 🧠 **`/trace`** replays every reasoning step and tool call as a summary card, right in the chat
- 🤖 **`/task`** spawns subagents; **`/cron 0 9 * * * …`** schedules recurring jobs on a built-in scheduler
- 🔒 **Dangerous operations always wait for your tap** — native approve/reject buttons in Telegram/Discord/Slack/WhatsApp
- 🚀 **One command to deploy** — `docker compose up -d`, scan a QR, done. No public URL needed for most platforms

**How it's built:**
- `@dsh-overdrive/gateway-core` — a DSH plugin exposing a Remote Session Driver protocol (trajectory/approval/multi-agent live in the plugin, decoupled from chat SDKs)
- `@dsh-overdrive/gateway` — standalone multi-platform gateway (adapters are thin; the "soul" survives plugin-API churn)
- 128+ unit tests, full-stack mock E2E, GitHub Actions CI green, verified against real DSH + DeepSeek on Telegram

```bash
npm i @dsh-overdrive/gateway-core        # as a dsh plugin
docker compose -f deploy/docker-compose.yml up -d   # full stack
```

First message to your bot? Run `/help` in the chat.

Repo: https://github.com/temotee2103/dsh-overdrive · Bilingual README · Animated demo in the README (no video needed to see it work)

Happy to answer questions about the plugin API, the approval bridge, or the cron scheduler. Feedback welcome!

## Comments strategy

- Reply to "how is this different from X": point to `/trace` + session-log traceability + approval bridge.
- Reply to "why not use official DSH web": mobile/IM-first usage, approvals on the go.
- Keep the tone: "small focused tool, not a platform".
