# Demo Script / 演示剧本（dsh-overdrive）

> Audience / 目标观众：developers. Runtime / 时长：约 3 分钟。Recording / 录屏建议：4K 60fps。
> Each beat includes EN narration + 中文画外音 — pick one or record both / 每段都有英文与中文台词，可任选或双语录制。

## 0. Prep / 准备（5 min，不在镜头内）

1. VPS or local Docker: `docker compose -f deploy/docker-compose.yml up -d`
2. `.env`: `DEEPSEEK_API_KEY`、`GATEWAY_ADAPTERS=telegram,whatsapp`、`TELEGRAM_BOT_TOKEN`
3. Open `http://<host>:3190/` — console shows DSH ok, telegram connected
4. WhatsApp already paired (auth persisted)

**中文**：VPS 或本机 Docker 一条命令起服务；配好模型 key 与平台凭据；控制台确认 DSH ok；WhatsApp 已扫码配对。

## 1. Opening / 开场（10s）

> "We put DeepSeek Harness inside your chat apps — scan a QR on WhatsApp, and it becomes your personal agent."
>
> **中文**："我们把 DeepSeek Harness 装进了聊天软件——WhatsApp 扫个码，它就是你的私人 agent。"

## 2. Plain chat / 普通对话（30s）

- Telegram: "帮我分析这个仓库的架构"（paste README link）
- Show: 🧠/🛠️ trajectory lines → final answer
- **EN**："You see every step — tool calls, reasoning. Fully traceable."
- **中文**："每一步都看得到——工具调用、思考，全程可追踪。"

## 3. Trajectory / 轨迹（20s）

- Send `/trace` → show the trajectory summary card
- **EN**："Not a black box — every step can be replayed."
- **中文**："这不是黑盒——每一步都能回放。"

## 4. Subagent / 子任务（20s）

- Send `/task 写 3 个营销 slogan`
- Show the receipt + result
- **EN**："You can hand it parallel work."
- **中文**："你可以派它并行干活。"

## 5. Cron / 定时任务（20s）

- Send `/cron 0 9 * * * 每天早上给我一条行业新闻摘要`
- Show the registration receipt; optionally tighten the minute for a live trigger
- **EN**："It works on its own and reports back."
- **中文**："它会自己干活，到点汇报。"

## 6. Approval / 审批（20s）

- Send something that **really triggers a tool call**: `帮我用 bash 看看当前目录`
- DSH sandbox requests approval → Telegram shows【✅ 同意 / 🚫 拒绝】inline buttons → tap "Reject"
- **EN**："Dangerous operations always wait for your tap."
- **中文**："危险操作永远要你点头。"
- **Real-machine note / 真机经验（2026-08-16）**："dangerous" is NOT a trigger word on real DSH — approval fires only when the agent calls a tool that needs approval (bash/fs etc.). Don't include the word "发" in the prompt. / 真实 DSH 里 "dangerous" 不是触发词——审批只在 agent 真实调用需批准的工具时触发；指令里别带"发"字。

## 7. Wrap-up / 收尾（10s）

> "One command to deploy, scan to connect, every step traceable — dsh-overdrive. Link below."
>
> **中文**："一条命令部署、扫码即用、全程可追踪——dsh-overdrive。链接在下方。"

## Assets / 素材

- Console screenshot / 控制台截图、WhatsApp native buttons / WhatsApp 原生按钮截图、trajectory card / 轨迹摘要截图
- Terminal recording (asciinema) of VPS deploy / VPS 部署的终端录像

## Failure checklist / 常见翻车点

- WhatsApp QR timeout：pair ahead and keep the session / 提前配对并保持登录态
- Model not configured：set the API key in DSH Web UI (3080) first / 提前在 DSH Web UI 配好模型
- Approval buttons missing：confirm gateway & plugin build ≥ M4 / 确认 gateway 与插件构建不低于 M4
