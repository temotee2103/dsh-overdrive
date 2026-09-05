# dsh-overdrive 全面进程内化 —— 迁移计划（2026-09-05）

> 状态：已确认方向（全面进程内化）。本文档是设计与分阶段执行依据。
> **进度**：✅ P0（native.ts 接缝，5 测试）→ ✅ P1 代码（telegram driver + 接线 + 8 测试，
> gateway-core 71 / 全套 257 绿；真机 CLI 级验证：scratch profile add/remove 无 loader 崩溃，
> 不碰用户 web profile）→ ⏳ P1 真机聊天气步：需用户 Telegram bot token + 许可装回 web profile →
> P2 其余平台 + schema → 0.2.0 发版刷新收录。
> 对标样本（GitHub 实测）：`@loserfox/telegram`（telegram 原生桥：`name`+`inject=['agents']`
> + schemastery `Config`，bridge 内 `ctx.agents.create/resume` + `followup` + session 事件回投，
> 无外部进程/协议）、`dsh-webbridge`（极薄 insert patch，无配置）、`dsh-mmx-bridge`
> （`dsh.client.platform:web` + settings 卡 + schemastery）。

## 1. 为什么迁移

现状 gateway-core 是"外部 gateway 的 DSH 插座"：
- 在 DSH 进程里另起自研协议 HTTP/WS 服务（`@dsh-overdrive/sdk` ProtocolServer，端口+token 配对），
  等独立的 `@dsh-overdrive/gateway` 进程连接；
- 必须预配 `DSH_OVERDRIVE_TOKEN`（与外部进程共享），无 schema/设置页，token 未配即"装了个寂寞"，
  曾因缺配 throw 拖崩整个 profile；用户体感"装不上、配不了、不合身"。
- 连环事故（BOM → 启动崩溃 → 疑似连带历史投影问题）进一步放大"不合身"印象。

生态里"合身"的插件：patch 极薄、配置走 schemastery/env、用 DSH 自身的 ctx 能力干活、
失败不碰宿主核心、可选 client 设置卡。**loserfox/telegram 已验证这条路走得通**（且与我们同源：
都是 Hermes telegram adapter 思路）。

## 2. 目标架构

`@dsh-overdrive/gateway-core`（保留 npm 名，行为整体替换；0.2.0 起）：

```
apply(ctx, config)
 ├─ Config: schemastery Schema.object({ ...每平台小节或独立 entry ... })
 ├─ 对每个启用的平台 adapter（telegram / feishu / wecom / discord / slack / whatsapp / cli…）
 │    新 ChatChannel：持有 平台连接 + 会话键 (platform, channel, user) → sessionKey(...)
 └─ DshRuntime（现 dsh-runtime.ts，基本复用）
      ├─ ensureAgent(sessionId) -> ctx.agents.create/resume({ sessionId: SessionId(...), ... })
      ├─ followup/inject -> handle.agent.followup(...)
      └─ onSessionEvent -> ctx.on('session/event')  → 路由回 adapter.send(...)
      （现有：轨迹/状态/任务/审批按钮/自动发件 事件均已覆盖）
```

- 桥接层：现 `bridge.ts` 的 ProtocolServer/session-key 调度 → 改成 `DshController(runtime, driver)`；
  adapter 实现 `SessionDriver`（sendToChat / askApproval / sendTyping / status），
  审批超时/关键词/分片等编排全部保留。
- 去掉运行时依赖 `@dsh-overdrive/sdk` 的 ProtocolServer；`sessionKey/parseSessionKey` 等
  纯函数内联或保留极小子集。sdk/mock-dsh 只留测试用（或退役）。
- `@dsh-overdrive/gateway`（外部多平台 gateway）→ 停止演进；其 adapters 迁入 gateway-core。
- CLI 演示降级为 in-process 的 `cli` driver（无需外部进程）。
- 每平台独立 entry（id: `overdrive-telegram` / `overdrive-feishu` …）或单 entry + schema 小节，
  使 DSH 侧可单独开关/在设置里配置（最终形态对齐 loserfox 一行 insert + 设置卡）。
- token 约定统一：`config.<platform>.token` 缺省回落 `DSH_<PLATFORM>_TOKEN`（如 DSH_TELEGRAM_TOKEN），
  无 token → 该平台 adapter 跳过并告警，**绝不 throw / 绝不阻塞 profile**。

## 3. 复用清单（已核对代码）

| 现文件 | 处理 |
|---|---|
| `gateway-core/src/dsh-runtime.ts` | **直接复用**（已是原生 ctx.agents + session/event） |
| `gateway-core/src/derive.ts` | 复用（DshSessionEvent 映射） |
| `gateway-core/src/cron.ts / autosend.ts / keys.ts` | 复用 |
| `gateway-core/src/bridge.ts` | 重构：去掉 ProtocolServer 参数，改为 SessionDriver 回调式编排 |
| `gateway-core/src/index.ts` | 重写：schema Config + 平台 adapter 装配 + 禁用态兜底 |
| `packages/gateway/src/adapters/*` | 迁入 gateway-core（改实现 SessionDriver，去掉对 SDK 客户端依赖） |
| `packages/sdk` | 运行时不再依赖；保留协议类型仅测试/文档用 |
| `packages/gateway` | 停更并打 deprecated（README/npm deprecated 提示迁移） |

## 4. 分阶段执行

- **P0（半日）**：通读 dsh-runtime/bridge 事件与 agent 生命周期，写最小 in-process
  smoke（cli driver：终端输入→agent→输出回显，无服务器）。
- **P1（试点，验证手感）**：Telegram 原生 adapter 进 gateway-core（grammy long-polling，
  env/schema token、allowlist、分片、轨迹/审批回投），测试覆盖；发 0.2.0-rc 并在本机
  profile 真装真跑（替代失去的外部 gateway）。
- **P2**：其余平台 adapter（feishu/wecom/discord/slack/whatsapp）逐个迁入；
  群提及/审批关键词/自动发件等 parity 能力平移；schema 每平台小节；
  README/quickstart 重写为"dsh plugin add 即用"。
- **P3（可选体验层）**：`dsh.client` web 平台 + client bundle + 设置页卡片
  （对齐 dsh-mmx-bridge），实现"设置里开关/配置"。
- **P4 收尾**：`@dsh-overdrive/gateway` npm deprecated + 退役文档；dsh-index/losebird/
  awesome 等收录条目更新（描述改为 in-process 原生形态）；sdk/mock-dsh 决策退役与否。

## 5. 发版与收录联动

- gateway-core → 0.2.0（破坏性架构变更；`^0.1.9` 用户需显式升级）。
- 每阶段结束跑全量测试（现有 244+ 新增），提交并推送；losebird PR #25 / dsh-index
  分支在最终 0.2.0 发版后统一刷新，避免反复。

## 6. 验收标准（"合身"定义）

1. `dsh plugin --profile web add @dsh-overdrive/gateway-core` 后 `dsh web` 立即可用；
   未配 token 只是该平台静默跳过，历史/设置一切正常。
2. 无需任何外部进程/端口/共享 token；token 走 schema/env，缺失可后补不崩。
3. 平台接入流程与 loserfox/telegram 同级（装→配→聊）。
4. 与宿主核心无侵入（不碰 session 存储、不驻留监听端口除非该平台需要 webhook）。
