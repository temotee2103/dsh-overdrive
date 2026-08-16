# dsh-overdrive

> 让 DeepSeek Harness 变成"超越 Hermes / OpenClaw"的多平台聊天智能体。

## 当前进度（M1 完成）

- ✅ Remote Session Driver 协议（HTTP + WS + token 认证）
- ✅ Mock DSH（模拟轨迹 / 审批流 / 子任务）
- ✅ Gateway 骨架 + CLI 适配器（全链路端到端通过）
- ✅ gateway-core 插件雏形（协议服务端，真实桥接待 M0 报告落地）

## 文档

- 设计：`docs/superpowers/specs/2026-08-16-dsh-overdrive-design.md`
- DSH 接口调研：`docs/interface-report.md`
- 实施计划：`docs/superpowers/plans/2026-08-16-dsh-overdrive-m0-m1.md`

## 本地验证

```bash
npm install
npm run build
npx vitest run
npm run e2e
```
