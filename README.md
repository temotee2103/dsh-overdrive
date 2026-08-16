# dsh-overdrive

> 让 DeepSeek Harness 变成"超越 Hermes / OpenClaw"的多平台聊天智能体。

## 当前进度（M2 完成）

- ✅ Remote Session Driver 协议（HTTP + WS + token 认证）
- ✅ gateway-core 真实桥接：会话 upsert/注入（`ctx.agents` + `followup`）
- ✅ 输出与轨迹：`session/event` 订阅 → `message.delta/complete` + `trajectory.step`（派生）
- ✅ 审批：`approval/request` answerer → 协议按钮 → allowed-once/rejected/cancelled
- ✅ 子任务表面（`ctx.subagents`）；cron 调度器在 M4
- ✅ **真机冒烟**：`dsh --profile web --patch ./cordis.smoke.yml` 加载验证通过（插件加载 + health + 消息管道回流）
- ✅ **M2b：国际平台适配器**（WhatsApp 扫码 / Telegram / Discord / Slack），多适配器并发（`GATEWAY_ADAPTERS`）
- 📋 平台手工验收清单：`docs/smoke-platforms.md`

## 文档

- 设计：`docs/superpowers/specs/2026-08-16-dsh-overdrive-design.md`
- DSH 接口调研：`docs/interface-report.md`
- 实施计划：`docs/superpowers/plans/2026-08-16-dsh-overdrive-m0-m1.md`、`...-m2-bridge.md`

## 本地验证

```bash
npm install
npm run build
npx vitest run
npm run e2e
```

## 真机冒烟（需要 Node ≥ 22.15，推荐系统 Node）

```bash
npm i -D @deepseek-ai/dsh
npm run build
$env:DSH_OVERDRIVE_TOKEN='smoke-token'
npx dsh --profile web --patch ./cordis.smoke.yml --port 3081
# 另开终端：
Invoke-RestMethod -Uri 'http://127.0.0.1:3192/v1/health' -Headers @{ authorization = 'Bearer smoke-token' }
```
