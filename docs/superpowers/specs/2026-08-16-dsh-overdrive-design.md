# dsh-overdrive 设计文档

- 日期：2026-08-16
- 状态：已获用户批准（2026-08-16）；M0 调研修订（D1–D6）于同日合入（见附录 A）
- 定位：让 DeepSeek Harness (DSH) 变成"超越 Hermes / OpenClaw"的多平台聊天智能体，主打开源影响力

---

## 1. 背景与目标

DSH（DeepSeek Harness）v0.1 于 2026-08-13 开源，MIT 协议，核心哲学是 **"Everything is a plugin"**（模型、工具、技能、会话、沙箱、存储、循环、调度、UI 全部可替换），内核基于 Cordis。Hermes Agent（Nous Research）和 OpenClaw 是已有的"终端智能体 + 多平台消息网关"（21+ 平台），但它们**没有 DSH 的全程可追踪能力**。

**本项目目标**：开发一个 DSH 插件 + 配套 Gateway，把 DSH 变成可通过 WhatsApp / Telegram / Discord / Slack / 飞书 / 钉钉 / 企业微信对话使用的智能体，并叠加 Hermes / OpenClaw 不具备的差异化能力，目标是成为 dsh-plugin 生态的社区爆款（开源影响力：GitHub stars、社区讨论、媒体关注）。

**成功标准**（用户定义）：
1. 开源影响力——社区爆款
2. 全程可追踪（DSH 独家，聊天内可见）
3. 自主多智能体（subagent 并行、cron、主动汇报）
4. 零配置一键部署（docker 一条命令 + 扫码）

## 2. 差异化定位（爆款故事）

> "不是又一个 OpenClaw——是**看得见思考过程、可以随时指挥团队**的 OpenClaw，而且一条命令部署。"

三大主打：
1. **全程可追踪**：聊天里可查看 agent 完整轨迹（思考/工具调用/子任务）、回放历史会话（DSH append-only session log 的聊天化表达）。Hermes / OpenClaw 做不到。
2. **自主多智能体**：聊天命令触发 subagent 并行任务、cron 定时任务、agent 主动汇报（"你 WhatsApp 里的私人团队"）。
3. **零配置一键部署**：`docker compose up -d` + 扫码配对，内置向导、健康检查、自动升级路径。

## 3. 命名与仓库

- 项目名：**dsh-overdrive**（"超频/超越"，呼应碾压 Hermes/OpenClaw 的定位）
- 仓库结构（monorepo，npm workspaces）：
  - `packages/gateway-core/` — DSH 插件（npm 包名 `@dsh-overdrive/gateway-core`）
  - `packages/gateway/` — 独立多平台 Gateway 进程（npm 包名 `@dsh-overdrive/gateway`）
  - `packages/sdk/` — 共享协议类型 + 两端 client
  - `packages/web/` — Web 控制台（扫码向导/健康面板/轨迹回放/日志）
  - `deploy/` — Dockerfile + docker-compose.yml + healthcheck
  - `docs/` — 文档
- GitHub topic：`dsh-plugin`

## 4. 架构（方案 A：核心插件 + 独立 Gateway，双进程）

```
┌─────────────────────┐        ┌──────────────────────────┐
│  消息平台            │        │  Gateway（独立 Node 进程） │
│  WhatsApp/Telegram  │◄──────►│  adapters/*               │
│  Discord/Slack/飞书  │  SDK   │  会话映射/白名单/审批       │
│  钉钉/企业微信        │        │  扫码向导/健康检查          │
└─────────────────────┘        └──────────┬───────────────┘
                                   Remote Session Driver API
                                   (HTTP + WS, token 认证)
                                           │
                                           ▼
                               ┌──────────────────────────┐
                               │  DSH 进程（docker 内）     │
                               │  gateway-core 插件         │
                               │  会话注入/轨迹桥/审批桥      │
                               │  多智能体触发表面            │
                               │  sessions/llm/tools/...    │
                               └──────────────────────────┘
```

选 A 的原因：DSH 处于 v0.1 开发者预览，插件 API 剧烈变动；把平台适配器放在插件 API 之外，能保住"能跑"底线。灵魂（轨迹/审批/多智能体桥）仍在插件内，叙事不损失。

## 5. 组件

| 组件 | 职责 | 技术要点 |
|---|---|---|
| `gateway-core`（DSH 插件） | 暴露 Remote Session Driver API；把 DSH 的会话/轨迹/审批/子任务桥出去 | TypeScript、Cordis 插件（`apply(ctx, config)` + `inject: ['agents']`）；桥接：`agents.create/resume` + `agent.followup`、`session/event` 订阅、`approval/request` answerer（D5）、`ctx.subagents`；内嵌 HTTP/WS server |
| `gateway`（独立进程） | 平台适配器 + 会话映射 + 安全 + 控制台 | Node.js；适配器接口 `{ id, connect(), send(), onMessage() }` |
| `sdk`（共享） | 通信协议类型 + 两端 client | 单一事件 schema，两端共用 |
| `web`（控制台） | 扫码向导/健康面板/轨迹回放/日志 | 静态页面，由 gateway 托管 |
| `deploy/` | Dockerfile + docker-compose + 健康检查 | 基于官方 `deploy/Dockerfile` |

## 6. Remote Session Driver 协议

**认证**：两端共享 token（环境变量注入）。

**事件总线**（WS 推送，每事件含 `sessionId` + `ts`）：
- `message.delta` / `message.complete` — agent 流式输出
- `trajectory.step` — 思考/工具调用/子任务（全程可追踪的原材料）
- `approval.request` — agent 请求批准危险操作
- `agent.status` — busy / idle / 子任务派生
- `task.done` / `error`

**HTTP 端点**：
- `POST /v1/sessions` — 按 `platform:channel:user` upsert 会话
- `POST /v1/sessions/{id}/messages` — 注入用户消息，触发 agent run
- `POST /v1/approvals/{reqId}/resolve` — 审批确认（同意/拒绝）
- `POST /v1/tasks` — 触发 subagent / cron 任务（cron 在 M4 提供）
- `GET /v1/health` — 健康检查

**会话键映射（D1）**：协议层会话键为 `platform:channel:user`；gateway-core 映射为 DSH 侧 SessionId `dsh:<platform>:<channel>:<user>`（DSH 的 SessionId 是插件自定 branded string，各组件需消毒，避免 `/`、`\`、`..` 等不安全字符）。

## 7. 数据流（一次对话）

1. WhatsApp 消息 → Baileys → adapter `onMessage`
2. Gateway 规整（文本/语音/图片）→ 会话键 `platform:channel:user` → 注入 DSH
3. `gateway-core` 映射为 DSH 会话 id `dsh:<platform>:<channel>:<user>`（D1），`agents.resume/create` 取会话，`agent.followup(createUserMessage(...))` 注入（新一轮 turn）
4. agent 运行 → `session/event`（turn/start、assistant/chunk|message、tool/call|result…）→ gateway-core **派生**为协议事件（轨迹由 `tool/call` 等派生，D2）→ WS 推回 gateway
5. Gateway 翻译为平台动作：文本回消息；轨迹折叠为"思考摘要"卡片；审批变成带【同意/拒绝】按钮的消息
6. 用户点按钮 → resolve 回传 → gateway-core 作为 **approval answerer**（D5）结算 outcome（approve→allowed-once / reject→rejected，D3）→ agent 继续

## 8. 安全模型（安全底线，默认行为）

- **白名单**：仅允许配置的号码/群/频道 ID 与 agent 对话
- **默认拒绝**：未白名单即不可用；工具策略默认最小权限
- **审批超时**：默认拒绝 + 通知（可配置超时）
- **审批结果词汇（D3）**：协议 approve/reject 二元 → DSH 四态 `allowed-once | rejected | cancelled | unavailable`；`cancelled`（agent 侧中止）与 `unavailable`（无应答方）需感知表达
- **可追踪**：所有对话与轨迹写 append-only log（复用 DSH session log）

## 9. 错误处理

- 平台断线：指数退避重连；Baileys 登录态持久化进 volume，重启不丢
- agent 忙：消息排队 + 回复 typing 状态
- 审批超时：默认拒绝 + 通知
- 长输出：分段发送；流式合并
- 语音/图片：降级策略（无法转写/理解则明确提示）
- DSH 不可用：gateway 健康检查降级提示

## 10. 测试策略

- 单元：协议序列化、会话键映射、审批状态机、命令解析
- 集成：mock DSH（fake gateway-core server）↔ gateway；各 adapter 用测试凭据
- E2E：docker-compose 一键起，WhatsApp 扫码后全链路
- 手工验收清单（每平台一份）

## 11. 首发平台清单（一次完整首发）

| 平台 | 接入方式 | 状态 |
|---|---|---|
| Telegram | Bot API（官方） | 首发 ✅ |
| Discord | Bot token（官方） | 首发 ✅ |
| Slack | Socket Mode（官方） | 首发 ✅ |
| WhatsApp | Baileys + 扫码（同 Hermes/OpenClaw） | 首发 ✅ |
| 飞书 | 官方 SDK | 首发 ✅ |
| 钉钉 | 官方 API | 首发 ✅ |
| 企业微信 | 官方 API（可直达普通微信用户） | 首发 ✅ |
| 个人微信 | 非官方 hook（封号风险） | 实验性标注，后续可选 |

## 12. 部署

- 一个 `docker-compose.yml`，两条服务（dsh + gateway）
- 数据卷挂 `/root/.dsh`（会话/登录态/轨迹日志持久化）
- 端口：dsh 默认 `3080`（回环绑定，由 Docker 映射）；gateway 控制台默认 `3190`
- 首次启动：打开控制台 → 配模型/API key → 扫码配对 → 开聊

## 13. 里程碑

- **M0（前置）✅**：clone DSH 源码 + harness-lark，读透插件接口；产出 `docs/interface-report.md`（D1–D6 见附录 A）
- **M1 · 骨架 ✅**：monorepo + SDK 协议 + gateway-core 插件雏形 + mock 端到端
- **M2a · 真实桥接 ✅**：gateway-core 接 `ctx.agents` / `session/event` / `approval/request`；真机冒烟通过（插件加载 + health + 事件管道）
- **M2b · 国际平台 ✅**：WhatsApp / Telegram / Discord / Slack 适配器 + 多适配器并发（待真机凭据验收）
- **M3 · 中文平台**：飞书 + 钉钉 + 企业微信适配器
- **M4 · 爆款特性**：轨迹摘要卡片 + WhatsApp 原生交互审批按钮 + subagent/cron 聊天命令面（cron 为 gateway-core 自研调度器，D4）+ 语音/图片收发 + 流式渲染（`message.delta`）
- **M5 · 发布**：docker-compose 一键部署 + Web 控制台 + npm 发布（`dsh.bundle.patch` 分发，D6）+ GitHub 仓库/License/CI + 文档/演示视频 + `dsh-plugin` topic、DSH Discord、HN/CSDN 等渠道

## 14. 风险与缓解

| 风险 | 缓解 |
|---|---|
| DSH 插件 API 不稳定（v0.1 破坏性变更） | 平台适配器放在 gateway 侧；gateway-core 插件保持最小面；跟进上游变更 |
| WhatsApp 封号 | Baileys 登录态持久化；建议独立号码；文档注明风险；可选 Business API |
| 个人微信封号 | 首发用企业微信官方 API，个人微信标实验性 |
| 全平台工作量过大 | 适配器接口统一；每平台增量交付；M2/M3 分两批 |
| 演示翻车（网络/扫码） | E2E 清单 + 录屏前置演练 |

## 15. 范围外（YAGNI）

- 不做聊天 UI 本身（复用各平台客户端）
- 不做多租户 SaaS 控制面（首发自托管）
- 不做语音合成/主动外呼（首发语音只做接收与转写）
- 不做模型计费/额度管理

---

## 附录 A：M0 调研对设计的修订（D1–D6，2026-08-16 合入）

来源：`docs/interface-report.md` §7。**代码已按下列修订实现**，本附录保证文档与实现一致。

- **D1 会话键**：协议层用 `platform:channel:user`；DSH 侧 SessionId 由插件自定，映射为 `dsh:<platform>:<channel>:<user>`（各组件消毒，避免 `/`、`\`、`..`）。
- **D2 轨迹派生**：DSH 无现成"轨迹 step"事件；`trajectory.step` 由 `session/event` 派生（`tool/call` → tool、`assistant/*` → thought）。
- **D3 审批词汇**：协议 `approve/reject` 二元 → DSH 四态 `allowed-once/rejected/cancelled/unavailable`；`cancelled` 由 `req.signal` abort 表达。
- **D4 cron 自研**：DSH 无内置调度接口；cron 由 gateway-core 自带调度器 + `followup`/`inject` 注入（M4 实现）。
- **D5 审批应答通道**：DSH 无 HTTP 审批 API；gateway-core 注册 `approval/request` answerer（网关侧应答），而非设计初稿假设的"DSH 侧审批服务"。
- **D6 版本**：`@deepseek-ai/cordis@4.0.1`；DSH 运行时包 `@deepseek-ai/dsh-agent | dsh-llm | dsh-session@^0.1.0-rc.6`；dsh CLI 需 Node ≥ 22.15（`node:zlib` zstd 导出）；Windows 插件路径须 `file://` URL。
