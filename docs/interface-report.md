# DSH 插件接口调研报告（M0 交付物）

- 日期：2026-08-16
- DSH commit hash：`47f943859bef60e4160492346772ded9b24f765a`（`deepseek-ai/deepseek-harness`，浅克隆 HEAD）
- harness-lark commit hash：`f9de872da3194073a181b3fb8590b708fe61bfe4`（`huoxue1/harness-lark`，浅克隆 HEAD）
- Cordis npm 包名与版本：`@deepseek-ai/cordis@4.0.1`
  - 证据：`reference/deepseek-harness/vendor/cordis/package.json:2,4`（`"name": "@deepseek-ai/cordis"` / `"version": "4.0.1"`）
  - 佐证：`reference/harness-lark/package.json:39` peerDependencies `"@deepseek-ai/cordis": "^4.0.1"`
  - 其他 DSH 运行时包（peerDeps，harness-lark/package.json:40-45）：`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-scope`、`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-system-prompt`、`@deepseek-ai/dsh-tools`（均 `^0.1.0-rc.6`）
- 调研方法：浅克隆两个仓库到 `reference/`，通读 `docs/architecture.md`、`docs/subsystems/{session,approval,jobs,subagent}.md`、`docs/cookbook/extension-cookbook.md`，并以 harness-lark 作为"通道插件挂接 DSH"的现成参考实现逐行核对。

---

## 1. sessions 服务（注入外部消息）

- 结论：**可行**。DSH 以 `Agent`（事件驱动循环）为会话单元：`ctx.agents.create/resume` 负责创建/继续会话，`agent.followup(userMessage)` 注入外部消息（唤醒式，进入下一轮 turn）；注入一条外部消息即 `followup()`。harness-lark 已证明这条链路（每 chat 一个持久 agent，消息经 `followup()` 入队）。
- 证据：
  - `ctx.agents` 注册表（`reference/deepseek-harness/packages/core/agent/src/index.ts`）：
    - `create(options: CreateAgentOptions): Promise<AgentHandle>`（`index.ts:405`）
    - `resume(options: ResumeAgentOptions): Promise<AgentHandle>`（`index.ts:424`，从持久化会话恢复，`resumeSessionId` 按 id 跨重启续接）
  - `Agent` 入队接口（`reference/deepseek-harness/packages/core/agent/src/runtime-types.ts:124`；实现 `packages/core/agent-loop/src/agent.ts:122`）：
    ```ts
    followup(input: UserMessage): void   // this.send(input, 'next-turn', true) —— 唤醒式
    steer(input: UserMessage): void      // this.send(input, 'next-step', true)
    inject(input: UserMessage): void     // this.send(input, 'next-step', false) —— 不唤醒，排队等下一条消息
    ```
  - 消息构造（`reference/harness-lark/src/agent/bridge.ts:22,243-246`）：`createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })`（`@deepseek-ai/dsh-llm`）→ `record.agent.followup(userMessage)`（`bridge.ts:251`）。
  - 创建/恢复调用（`bridge.ts:351` resume、`bridge.ts:374` create）：
    ```ts
    handle = await agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
    handle = await agents.create({ sessionId, meta: { cwd }, agentOptions, setup })
    ```
  - 会话 id 约定（`bridge.ts:46-52`）：`SessionId('lark:${accountId}:${chatId}')` —— DSH 的 `SessionId` 是 branded string，格式由插件自定，无平台/通道/用户三段式内建概念。
- 注意事项：`followup` 是"打开新一轮 turn"的语义，正在 busy 时也会唤醒驱动；`inject` 不唤醒（等下次自然 wake）。消息体必须用 `createUserMessage`（模型可见的 `user/message` 事件来源）。会话 id 一旦持久化即固定，`/new` 这类重置需换新 id（generation 后缀）。

## 2. 会话输出订阅

- 结论：**可行**。订阅 `session/event`（emit 事件）即可收到该会话全部 append 事件，包括流式 `assistant/chunk`（delta）、整条 `assistant/message` 与回合边界 `turn/end`；harness-lark 的静态/流式回复都由此驱动。
- 证据：
  - `'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void`（`reference/deepseek-harness/packages/core/session/src/index.ts:76`，文档 `docs/subsystems/session.md` cordis-surface 节）。
  - 订阅与分发（`reference/harness-lark/src/agent/bridge.ts:416-419`）：
    ```ts
    this.ctx.on('session/event', (session, event: SessionEvent) => {
      if (session.header.id !== sessionId) return
      void this.onSessionEvent(key, record, sessionId, event)
    })
    ```
  - 事件类型处理（`bridge.ts:435-495`）：
    - `assistant/chunk` → `event.data.chunk.type`：`'reasoning-delta'` / `'text-delta'` / `'usage'`（`bridge.ts:438-447`）——流式 delta 的来源
    - `assistant/message` → `extractAssistantText(event)` 拼接 `content[].type==='text'` 块（`bridge.ts:452-476`、`bridge.ts:611-617`）——完整消息
    - `turn/end` → 收尾（卡片结算/清空 anchor/换表情，`bridge.ts:478-494`）
- 注意事项：`session/event` 是 post-commit fire-and-forget（观察者失败被隔离，不影响 append 成功）；事件带 `session.header.id`，多会话订阅需自行按 id 过滤。流式 delta 只在 `assistant/chunk` 上，协议层的 `message.delta` 应对齐 `text-delta` 而非 `reasoning-delta`。

## 3. 轨迹/会话日志

- 结论：**可行，但需派生**。DSH 没有独立的"轨迹 step"事件；轨迹信息以 append-only `SessionEvent` 日志的形式存在（`turn/start|end`、`step/start|end`、`user/message`、`assistant/chunk|message`、`tool/call|result`、`todo/write` 等），gateway-core 的 `trajectory.step` 需要从 `session/event` 的 `tool/call`+`tool/result`（工具调用）、`assistant/message`（回复）等事件映射派生。
- 证据：
  - 会话即 append-only 日志（`reference/deepseek-harness/docs/subsystems/session.md:5`）："A `Session` is an **append-only log** of typed `SessionEvent`s — the single source of truth"。
  - 事件词汇表 `SessionEventMap`（`docs/subsystems/session.md:27-124`）：`turn/start`、`turn/end`、`step/start`、`step/end`、`user/message`、`assistant/chunk`、`assistant/message`、`tool/call`（`{ turn, step, callId, name, arguments }`）、`tool/result`、`todo/write`、`request/header` 等；插件可 declaration-merge 扩展（log-only 事件，非 surface）。
  - 读取接口：`Session.events`（不可变快照）、`Session.deriveMessages()`（派生模型历史）、`Session.append(type, data, opts)`（`docs/subsystems/session.md:359-518`）。
  - 存储层 `ctx.sessions`（`SessionStore`，`packages/core/session/src/index.ts:792`）：`create/prepare/enter/announce/flush/get/list/fork`；`fork(source, boundary?, childSessionId?)` 可用于轨迹分叉。
  - 持久化：`dsh-session-persistence-jsonl`（`packages/session/session-persistence-jsonl/src/format.ts`）——首行 `{ type: 'session', version, id, createdAt, cwd?, parentSession?, seedLength?, origin?, delegationDepth, agentPreset? }`（`format.ts:33-44`），后续每行一个事件（`SessionEvent`，含 `seq`/`time`/`data`），可选 zstd 压缩（`format.ts:24-26`）。它是"逐条 append"的 JSONL，天然是 append-only 轨迹文件。
- 注意事项：读持久化日志应通过 `sessionPersistence` 服务或 `session/event` 订阅，不要直接解析文件（压缩/编码由后端决定）。轨迹 step 的"工具调用链"可以 `tool/call.callId` ↔ `tool/result` 配对。

## 4. 审批流

- 结论：**可行**。DSH 的审批是"asker + answerer 瀑布"模型：工具/沙箱调用 `ctx.approval.request(req)` 发起询问；`approval/request` 是 waterfall 事件，插件注册 answerer 返回 outcome（`'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`）或 `next()` 委托。gateway-core 应仿照 harness-lark 注册 answerer，把审批渲染到外部平台并回传 outcome。DSH 无内置 HTTP 审批 API，需网关侧自建应答通道。
- 证据：
  - 服务 `ctx.approval`（`ApprovalService`，`reference/deepseek-harness/docs/subsystems/approval.md`，源码 `packages/interaction/user-approval/src/index.ts:192`）：
    ```ts
    setPolicy(agent: Agent, policy: ApprovalPolicy): void          // 'ask' | 'never'
    async request(req: ApprovalRequest): Promise<ApprovalOutcome>  // asker 接口
    overrideOf(session: Session): ApprovalPolicy | undefined
    ```
  - `ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`（`approval.md:28`）；`ApprovalRequest = { agent, toolName, callId?, reason?, signal? }`（`approval.md:60-81`）。
  - waterfall 事件（`packages/interaction/user-approval/src/index.ts:30`）：
    ```ts
    'approval/request'(this: Scoped<ApprovalService>, req: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>
    ```
  - answerer 参考实现（`reference/harness-lark/src/approval/feishu-approval.ts:99-135`）：
    ```ts
    ctx.on('approval/request', (req, next) => {
      const sessionId = req.agent.session.header.id
      if (!sessionId.startsWith(FEISHU_SESSION_PREFIX)) return next()   // 非本通道会话 → 委托
      return new Promise<ApprovalOutcome>((resolve) => { /* 卡片 + 按钮；resolve(outcome) */ })
    }, { prepend: true })                                              // 插到 web answerer 之前
    ```
  - 超时/中止处理（`feishu-approval.ts:112-133`）：10 分钟超时自动 `rejected`；`req.signal` abort → `cancelled`。
- 注意事项：answerer 是"决定者"而不是"发起者"；只对 `req.agent.session.header.id` 属于本网关的会话应答，其余 `next()`。`allowed-once` 是唯一放行结果，失败一律 fail-closed。协议层 `approve/reject` 需映射为 `allowed-once/rejected`（还有 `cancelled`/`unavailable` 两种外部不可达但需要感知的状态）。

## 5. subagent / cron 触发表面

- 结论：**subagent 可行；cron 无内置接口，需自建**。
  - subagent：`ctx.subagents` 服务（按名注册多 provider，`spawn`/`fork`/`acp`/`codex` 等），`SubagentRuntime.start(provider, request)` 一次性委托、`startContinuable()` 可续后台子代理；同时有 `ctx.jobs`（`JobRegistry.start(JobStart)`）管理长任务生命周期。
  - cron：DSH **没有**内建定时调度插件接口。官方 cookbook 明确：cron 由"插件自己注册模型可调度的工具 + 定时器触发 → 空闲时 `followup()`、忙时 `inject()`"实现。gateway-core 需要自带调度器（定时器）＋ 在协议层暴露 `task.kind='cron'` 的创建入口。
- 证据：
  - `ctx.subagents`（`reference/deepseek-harness/docs/subsystems/subagent.md:5-7,101-112`）：`SubagentRuntime.start()` 解析 durable 子代理 descriptor 后调 provider `start()`；`startContinuable()` 返回 `{ childId, messageId }`；`followup()` 是唯一续聊入口。模型侧入口是 `tool-subagent`（`packages/subagent/tool-subagent/src/index.ts:23`：`inject = ['tools', 'subagents', 'systemPrompt']`，`defineTool` 注册名为 `subagent` 的工具，`provider` 配置指定 `ctx.subagents` 下的 provider）。
  - `ctx.jobs`（`docs/subsystems/jobs.md:34-57`）：`JobRegistry.start({ kind, label, outputLimitBytes?, owner?, run() })`；`JobKindMap` 已含 `bash`/`subagent`，插件可合并扩展；`JobOutcome = { status: 'completed'|'killed'|'failed', detail?, output? }`。
  - cron 触发范式（`reference/deepseek-harness/docs/cookbook/extension-cookbook.md:124`）：
    > "Scheduled tasks (cron) | a plugin registers model-callable scheduling tools; timer fires → `followup(…, {source: {kind: 'cron', …}})` when idle / `inject()` notification when busy"
  - `agent.inject()` 不唤醒的语义（`packages/core/agent-loop/src/agent.ts:130`）正好承接"后台通知在忙时排队、下轮进入模型上下文"。
- 注意事项：subagent 依赖 `ctx.subagents` 的 provider 是否被部署安装（base bundle 默认安装哪些 provider 需在目标 profile 确认）；cron 消息的 `source.kind` 建议用 `'cron'`（与 cookbook 一致），并注意 `user/message` 的 `source` 字段区分注入来源。

## 6. 插件注册与加载（cordis.yml / patch overlay）

- 结论：**可行**。插件即 Cordis 函数式插件（`name` + `apply(ctx, config)`），以 **bundle** 形式分发：`package.json` 的 `dsh.bundle.patch` 字段指向 `cordis.patch.yml`，patch 用 `- insert:` 声明行（`id` + `name` + `config`）；配置值可用 `!!js process.env.X` 引用环境变量；行按 `id` 定位，上层 patch 整行替换 `config`。
- 证据：
  - 插件形态（`reference/harness-lark/src/index.ts:57-64`）：
    ```ts
    export const name = 'harness-lark'
    export const inject = ['agents', 'tools']          // 依赖注入声明
    export function apply(ctx: Context, config: HarnessLarkConfig): void { ... }
    ```
  - bundle 声明（`reference/harness-lark/package.json:28-32`）：`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`
  - patch overlay 语法（`reference/harness-lark/cordis.patch.yml:18-29`）：
    ```yaml
    - insert:
        - id: lark
          name: 'harness-lark'
          config:
            appId: !!js process.env.FEISHU_APP_ID
            appSecret: !!js process.env.FEISHU_APP_SECRET
            requireMentionInGroups: true
    ```
  - 分层应用顺序（`reference/deepseek-harness/docs/architecture.md:27`）：profile 列出的 bundle 顺序 → profile 的 `cordis.patch.yml` → home 级 → `--patch` overlay；"A patch targets a row by id and replaces its whole config, or inserts new rows"。base bundle 同款语法见 `packages/bundle/base/cordis.patch.yml:15-`（`- insert:` 下 `id`/`name`/`config` 列表）。
  - 安装命令（`harness-lark/cordis.patch.yml:16`）：`dsh plugin --profile web add harness-lark`
- 注意事项：bundle 行 `id`（如 `lark`）与插件 `name`（如 `harness-lark`）是两个概念：`id` 是配置树里的行标识（patch 定位用），`name` 是 npm 包/插件名。config 用 schemastery `Schema.object(...)` 校验（`harness-lark/src/core/config-schema.ts:66-102`），插件导出的 `Config` 需是 `Schema`。gateway-core 应以独立 npm 包 + `dsh.bundle.patch` 形式分发，供 `dsh plugin add` 安装。

## 7. gateway-core 桥接实现清单

供后续计划直接引用的桥接清单（方法/事件 + 来源 + 调用方式 + 注意事项）：

1. **会话 upsert（协议 `POST /v1/sessions`）**
   - 映射：`upsertSession({platform, channel, user})` → 会话 id 约定为 `SessionId('dsh:${platform}:${channel}:${user}')`（DSH 无三段式内建概念，由插件自定；参考 harness-lark 的 `lark:${accountId}:${chatId}`，`bridge.ts:46-52`）。
   - 调用：`ctx.agents.create({ sessionId, meta: { cwd }, agentOptions, setup })`；已持久化则 `ctx.agents.resume({ resumeSessionId, agentOptions, setup })`（`packages/core/agent/src/index.ts:405,424`；用法 `bridge.ts:351,374`）。
   - 注意：同一 session 同一时刻只允许一个 live 持有者；resume 撞 live 需重试/报错（`bridge.ts:345-370`）。`setup` 回调里做模型选择 `installModelSelection(agentCtx, selectionRef)` 与 agent preset 挂载（`bridge.ts:323-337`）。

2. **注入外部消息（协议 `POST /v1/sessions/{id}/messages`）**
   - 调用：`createUserMessage({ content, source: { kind: 'user' } })` → `agent.followup(userMessage)`（`bridge.ts:243-252`；`agent.ts:122`）。
   - 注意：`followup` 唤醒（next-turn）；后台/通知类用 `agent.inject()`（不唤醒，`agent.ts:130`）。回复通过 `session/event` 异步回传，`sendMessage` 返回的 `runId` 可映射为 session 本地消息序号。

3. **会话输出订阅（协议 WS `/v1/events` 的 `message.delta` / `message.complete` / `agent.status`）**
   - 订阅：`ctx.on('session/event', (session, event) => …)`（`packages/core/session/src/index.ts:76`；用法 `bridge.ts:416-419`）。
   - 映射：`assistant/chunk.text-delta` → `message.delta`；`assistant/message` → `message.complete`（`extractAssistantText`，`bridge.ts:611-617`）；`turn/start`→busy、`turn/end`→idle 可驱动 `agent.status`（`bridge.ts:478-494`）。
   - 注意：按 `session.header.id` 过滤；`session/event` 是 post-commit 广播，不保证顺序处理时的事件时序（自己串行化）。

4. **轨迹（协议 `trajectory.step`）**
   - 订阅 `session/event` 后从 `tool/call`（`{ turn, step, callId, name, arguments }`）+ `tool/result` 派生 `kind:'tool'` 轨迹；`assistant/message`/`assistant/chunk` 可派生 `kind:'thought'`；`ctx.sessions.fork`/`Session.events` 用于历史回放（`docs/subsystems/session.md:27-124,532-538`）。
   - 注意：DSH 无现成"轨迹 step"事件，必须派生；`todo/write` 是全量快照（`docs/subsystems/session.md:90`），可作为任务进度行。

5. **审批（协议 `approval.request` / `POST /v1/approvals/{reqId}/resolve`）**
   - 注册 answerer：`ctx.on('approval/request', (req, next) => …, { prepend: true })`（`feishu-approval.ts:99-135`）；仅应答 `req.agent.session.header.id` 归属本网关的会话，其余 `next()`。
   - 应答映射：协议 `approve` → `'allowed-once'`，`reject` → `'rejected'`；挂起表 + 超时（参考 `feishu-approval.ts:112-116` 的 10 分钟自动拒绝）与 `req.signal` abort → `'cancelled'`。
   - 注意：answerer 是决定者，不是发起者；`ctx.approval.request()` 是 asker 用的（gateway-core 不需要调）。需处理 `unavailable`（无 answerer 时的 fail-closed 结果，协议层可转为 `error`）。

6. **subagent / cron（协议 `POST /v1/tasks`）**
   - `kind:'subagent'` → `ctx.subagents.start(provider, { label, prompt, parent, signal, agentOptions, maxDepth })`（`docs/subsystems/subagent.md:47-96`；provider 名来自部署配置，默认 `spawn`），后台长任务可走 `ctx.jobs.start({ kind: 'subagent', label, owner, run })` 纳入 `JobRegistry` 生命周期（`docs/subsystems/jobs.md:34-57`）。
   - `kind:'cron'` → DSH 无内置：gateway-core 自带调度器，触发时对目标会话 `agent.followup(userMessage with source.kind='cron')`（空闲）或 `agent.inject()`（忙）——cookbook 范式（`docs/cookbook/extension-cookbook.md:124`）。
   - 注意：subagent 依赖部署中已安装的 provider；`prompt` 是 `ContentBlock[]`（`@deepseek-ai/dsh-llm`）。

7. **插件注册（部署形态）**
   - 包声明：`package.json` `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` + 插件导出 `name`/`apply(ctx, config)`/`inject`（`harness-lark/package.json:28-32`、`src/index.ts:57-64`）。
   - patch：`- insert:` 行（`id`/`name`/`config`），密钥用 `!!js process.env.*` 注入（`cordis.patch.yml:18-29`）。
   - 依赖：`@deepseek-ai/cordis@^4.0.1`（peer）+ `@deepseek-ai/dsh-agent|dsh-session|dsh-llm|dsh-tools|dsh-scope|dsh-system-prompt@^0.1.0-rc.6`（peer）。
   - 注意：`Config` 用 schemastery `Schema.object` 声明（`config-schema.ts:66-102`）；所有注册都要放进 `ctx.effect(() => …)` 以便卸载回滚（`src/index.ts:118-137`）。

### 与设计文档（§14 风险项）相关的差异/冲突点（不改设计，留待下一轮计划评审）

- **D1 会话键格式**：设计文档协议用 `platform:channel:user` 三段键；DSH 的 `SessionId` 是插件自定 branded string（harness-lark 用 `lark:account:chat`）。gateway-core 需确定自己的 id 映射（建议 `dsh:<platform>:<channel>:<user>`），并注意 DSH 会话 id 会在 JSONL 持久化里作为目录名/标识复用，需避免含 `/`、`\`、`..` 等不安全字符（`format.ts:110-120` 有 encode 处理，但规范起见网关侧就用白名单字符）。
- **D2 轨迹事件缺失**：协议层 `trajectory.step` 在 DSH 无一一对应事件，必须由 `session/event` 派生（见 §3/§7.4）。派生规则需在下一计划固化（`tool/call`→tool、`assistant/*`→thought、`subagent` 相关事件→subagent）。
- **D3 审批结果词汇**：协议 `approve|reject` 是二元；DSH `ApprovalOutcome` 四态（`allowed-once|rejected|cancelled|unavailable`）。映射：approve→allowed-once、reject→rejected；取消/不可用需在协议层表达（建议补 `cancelled` 或并入 `error`）。
- **D4 cron 无内置**：设计文档把 cron 作为 `TaskRequest.kind` 之一；DSH 需要 gateway-core 自带调度器 + `followup/inject` 注入（§5/§7.6）。这属于"自研组件"而非"DSH 接口"，工作量估算应计入。
- **D5 审批应答通道**：DSH 审批没有 HTTP/WS API，必须由 gateway-core 作为 answerer 注册 + 自建应答桥（§4/§7.5）。设计文档中"DSH 侧审批服务"的假设需改为"网关侧 answerer"。
- **D6 版本**：Task 11 预设 `@deepseek-ai/cordis@^4.0.1` 与实际一致（4.0.1）；但 DSH 运行时包都是 `^0.1.0-rc.6`（pre-release），npm 安装时需确认 registry 与 tag（`@deepseek-ai` scope 是否为公共 registry）。
