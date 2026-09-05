# gateway-core 0.2.0 — 进程内原生版（发布文案草稿）

> 状态：草稿，待真机验证后正式发布（当前 latest 仍为 0.1.9 legacy；0.2.0-beta.0 已发 npm tag `beta`）。

## TL;DR

`@dsh-overdrive/gateway-core` 0.2.0 完成**全面进程内化**：不再需要外部 gateway 进程 / 自研协议 / 端口 / 配对 token。装上插件 + 一个 Telegram bot token，直接在 DSH 里聊 —— 与生态（@loserfox/telegram）同形态。

## What's new

- **In-process native bridge**：平台 driver 在 DSH 进程内直接驱动 `ctx.agents` 会话（`ctx.agents.create/resume` + `session/event`），无 ProtocolServer、无外部进程。
- **Telegram driver**（首个原生平台）：Bot API 长轮询（零新增依赖）、文本收发、HTML+分片、typing、allowlist、**图片入站**（photo→可下载 URL→模型看图）、**审批**（approval→聊天内「批准/拒绝」文字回复，超时取消）、**`/remind`** 一次性提醒、`/new` `/clear` `/help`。
- **schemastery `Config`**：配置 schema 导出（DSH 设置面可见）；token 缺省回落 `DSH_TELEGRAM_TOKEN`。
- **永不阻塞 DSH 启动**：未配置任何 token 时禁用态加载（仅告警）。
- Legacy 外部 gateway 模式（`DSH_OVERDRIVE_TOKEN` + `npx dsh-overdrive-gateway`）保留并标注 deprecated，随其余平台迁入后退役。

## Install

```bash
dsh plugin --profile web add @dsh-overdrive/gateway-core   # 正式版后
export DSH_TELEGRAM_TOKEN=<bot token>                      # @BotFather
dsh web                                                    # 重启后直接给 bot 发消息
```

## Notes

- 模型自动使用 DSH Web UI 中配置的默认模型（agentDefaultModel）。
- 其余平台（飞书/企微/Discord/Slack/WhatsApp）仍在迁入中；期间可用 legacy gateway。
- 测试：gateway-core 79+ / 全套 269 绿（原生路径：入站/复用/出站序列/前缀隔离/审批批准-拒绝-超时/图片/remind）。
