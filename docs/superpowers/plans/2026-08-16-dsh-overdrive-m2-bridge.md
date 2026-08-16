# dsh-overdrive M2 实施计划：gateway-core 真实桥接 + DSH 真机验证

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 gateway-core 从"占位插件"升级为**真实桥接**：接入 DSH 的 `agents`/`session/event`/`approval/request` 接口，让协议层的会话注入、消息输出、轨迹派生、审批应答、子任务真正驱动 DSH agent；并在真实 DSH 运行时（`npx dsh web --patch`）里完成加载冒烟验证。

**Architecture:** 沿用方案 A 双进程。bridge 逻辑放在独立的 `DshBridge`（依赖最小化的 `DshRuntime` 结构接口，可用 Fake 单测）；真实实现 `createDshRuntime(ctx, …)` 负责把 Cordis ctx 翻译成该接口。协议事件派生（`derive.ts`）做成纯函数，把 DSH 的 `SessionEvent` 映射为协议 `ServerEvent`（M0 报告 D2：DSH 无现成轨迹事件，必须派生）。插件入口 `apply(ctx, config)` 组装 server + runtime + bridge。

**Tech Stack:** TypeScript (strict, NodeNext)、`@deepseek-ai/cordis@^4.0.1`、`@deepseek-ai/dsh-agent|dsh-session|dsh-llm@^0.1.0-rc.6`、vitest、既有 `@dsh-overdrive/sdk`。

**Scope 说明（重要）：**
- 本计划 = **M2a（真实桥接 + 真机冒烟）**。国际平台适配器（WhatsApp/Telegram/Discord/Slack，原设计 M2）与中文平台（M3）、cron 调度器与流式/多媒体（M4）、发布（M5）各自是后续独立计划。
- `TaskRequest.kind='cron'` 本计划**明确不实现**（M4 范围）：`createTask` 对 cron 返回明确错误，不做占位实现。
- 桥接不依赖 `ctx.sessions.get` 语义，采用 harness-lark 已验证的"先 resume（撞 live 重试）→ 失败则 create"模式，降低对 pre-release API 的假设。
- 涉及 DSH 运行时包的 API 全部使用**结构化类型**（测试侧）与官方导入（运行侧）双轨，测试不安装 pre-release 运行时包。

---

## File Structure（本计划新增/修改）

```
packages/gateway-core/
├── package.json                     # 修改：新增 dsh-* 依赖
├── src/
│   ├── index.ts                     # 重写：apply(ctx, config) 组装三件套
│   ├── keys.ts                      # 新增：会话 id 映射 + 组件消毒
│   ├── derive.ts                    # 新增：SessionEvent → ServerEvent 纯函数
│   ├── dsh-runtime.ts               # 新增：ctx → DshRuntime 实现
│   └── bridge.ts                    # 新增：DshBridge（会话/审批/事件转发）
├── test/
│   ├── derive.test.ts               # 新增
│   ├── keys.test.ts                 # 新增
│   ├── runtime.test.ts              # 新增（Fake ctx 冒烟）
│   ├── bridge.test.ts               # 新增（FakeRuntime + ProtocolServer）
│   └── plugin.test.ts               # 修改：改用富 Fake ctx
cordis.smoke.yml                     # 新增：真机冒烟 patch overlay
README.md                            # 修改：M2 状态
```

依赖关系：`keys.ts`/`derive.ts` 零依赖（纯函数）→ `dsh-runtime.ts` 依赖 keys/derive 类型 → `bridge.ts` 依赖 runtime/derive/keys + sdk → `index.ts` 组装。

---

## Task 1: gateway-core 依赖与类型基线

**Files:**
- Modify: `packages/gateway-core/package.json`

- [ ] **Step 1: 更新 `package.json` 增加 DSH 运行时包依赖**

```json
{
  "name": "@dsh-overdrive/gateway-core",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "build": "tsc" },
  "dependencies": {
    "@dsh-overdrive/sdk": "0.1.0",
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-agent": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-llm": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-session": "^0.1.0-rc.6"
  },
  "devDependencies": {}
}
```

- [ ] **Step 2: 安装并确认解析**

```bash
cd <workspace>
npm install
npm ls @deepseek-ai/dsh-agent @deepseek-ai/dsh-llm @deepseek-ai/dsh-session
```
Expected: 三个包都解析到 `0.1.0-rc.x`（若 npm 上不存在或解析失败，**停在本任务并报告**，不要换包名）。`@deepseek-ai/dsh-agent` 应为 `^0.1.0-rc.6` 的 pre-release 最新版。

- [ ] **Step 3: 确认现有构建与测试仍绿（基线）**

```bash
npm run build
npx vitest run packages/gateway-core
```
Expected: 构建成功；gateway-core 现有 1 个插件测试 PASS（M1 的占位实现不变，仍应通过）。

- [ ] **Step 4: 提交**

```bash
git add packages/gateway-core package-lock.json
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "chore(gateway-core): 引入 dsh-agent/dsh-llm/dsh-session 运行时依赖"
```

---

## Task 2: 纯函数层（keys + derive）

**Files:**
- Create: `packages/gateway-core/src/keys.ts`
- Create: `packages/gateway-core/src/derive.ts`
- Create: `packages/gateway-core/test/keys.test.ts`
- Create: `packages/gateway-core/test/derive.test.ts`

- [ ] **Step 1: 写失败测试 `test/keys.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { fromDshSessionId, sanitizeComponent, toDshSessionId } from '../src/keys.js';

describe('sanitizeComponent', () => {
  it('替换不安全字符，保留白名单字符', () => {
    expect(sanitizeComponent('60123456789')).toBe('60123456789');
    expect(sanitizeComponent('a/b\\c..d')).toBe('a_b_c..d');
    expect(sanitizeComponent('中文-号+')).toBe('___-号_');
  });
});

describe('toDshSessionId / fromDshSessionId', () => {
  it('拼接 dsh:<platform>:<channel>:<user>', () => {
    expect(toDshSessionId('whatsapp', '60123', '60123')).toBe('dsh:whatsapp:60123:60123');
  });

  it('往返一致', () => {
    const id = toDshSessionId('cli', 'cli', 'local');
    expect(fromDshSessionId(id)).toEqual({ platform: 'cli', channel: 'cli', user: 'local' });
  });

  it('非法 id 抛错', () => {
    expect(() => fromDshSessionId('lark:1:2')).toThrow(/invalid dsh session id/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/gateway-core/test/keys.test.ts
```
Expected: FAIL（`../src/keys.js` 不存在）。

- [ ] **Step 3: 写 `src/keys.ts`**

```ts
// DSH 会话 id 映射。DSH 的 SessionId 是插件自定 branded string（M0 报告 D1），
// gateway-core 约定为 `dsh:<platform>:<channel>:<user>`。
// 会话 id 会进入 JSONL 持久化路径，组件必须消毒，避免 `/`、`\`、`..` 等不安全字符。

const SAFE = /[^A-Za-z0-9._+\-]/g;

export function sanitizeComponent(value: string): string {
  return value.replace(SAFE, '_');
}

export function toDshSessionId(platform: string, channel: string, user: string, prefix = 'dsh'): string {
  return `${prefix}:${sanitizeComponent(platform)}:${sanitizeComponent(channel)}:${sanitizeComponent(user)}`;
}

export function fromDshSessionId(id: string, prefix = 'dsh'): { platform: string; channel: string; user: string } {
  const [p, platform, channel, user] = id.split(':');
  if (p !== prefix || !platform || !channel || !user) {
    throw new Error(`invalid dsh session id: ${id}`);
  }
  return { platform, channel, user };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run packages/gateway-core/test/keys.test.ts
```
Expected: 3 个测试全 PASS。

- [ ] **Step 5: 写失败测试 `test/derive.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  deriveProtocolEvents,
  extractAssistantText,
  type DshSessionEvent,
} from '../src/derive.js';

describe('extractAssistantText', () => {
  it('拼接 assistant/message 的 text 块', () => {
    const event: DshSessionEvent = {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }] } },
    };
    expect(extractAssistantText(event)).toBe('Hello world');
  });

  it('无 text 块返回空串', () => {
    const event: DshSessionEvent = { type: 'assistant/message', data: { message: { content: [] } } };
    expect(extractAssistantText(event)).toBe('');
  });
});

describe('deriveProtocolEvents（DSH SessionEvent → 协议 ServerEvent）', () => {
  const sessionId = 'dsh:cli:cli:local';

  it('turn/start → busy，turn/end → idle', () => {
    const start = deriveProtocolEvents(sessionId, { type: 'turn/start', data: {} });
    expect(start).toEqual([{ type: 'agent.status', sessionId, ts: expect.any(Number), status: 'busy' }]);

    const end = deriveProtocolEvents(sessionId, { type: 'turn/end', data: {} });
    expect(end).toEqual([{ type: 'agent.status', sessionId, ts: expect.any(Number), status: 'idle' }]);
  });

  it('assistant/chunk text-delta → message.delta（reasoning-delta 忽略）', () => {
    const ev = deriveProtocolEvents(sessionId, {
      type: 'assistant/chunk',
      data: { chunk: { type: 'text-delta', text: 'Hello' } },
    });
    expect(ev).toEqual([{ type: 'message.delta', sessionId, ts: expect.any(Number), text: 'Hello' }]);

    const ignored = deriveProtocolEvents(sessionId, {
      type: 'assistant/chunk',
      data: { chunk: { type: 'reasoning-delta', text: 'thinking…' } },
    });
    expect(ignored).toEqual([]);
  });

  it('assistant/message → message.complete', () => {
    const ev = deriveProtocolEvents(sessionId, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '结果' }] } },
    });
    expect(ev).toEqual([{ type: 'message.complete', sessionId, ts: expect.any(Number), text: '结果' }]);
  });

  it('tool/call → trajectory.step(tool)', () => {
    const ev = deriveProtocolEvents(sessionId, {
      type: 'tool/call',
      data: { name: 'bash', arguments: 'ls' },
    });
    expect(ev).toEqual([{
      type: 'trajectory.step', sessionId, ts: expect.any(Number),
      step: { kind: 'tool', label: 'bash' },
    }]);
  });

  it('无关事件不产出', () => {
    expect(deriveProtocolEvents(sessionId, { type: 'user/message', data: {} })).toEqual([]);
    expect(deriveProtocolEvents(sessionId, { type: 'todo/write', data: {} })).toEqual([]);
  });
});
```

- [ ] **Step 6: 跑测试确认失败**

```bash
npx vitest run packages/gateway-core/test/derive.test.ts
```
Expected: FAIL（`../src/derive.js` 不存在）。

- [ ] **Step 7: 写 `src/derive.ts`**

```ts
import type { ServerEvent } from '@dsh-overdrive/sdk';

// DSH SessionEvent → 协议 ServerEvent 的纯函数映射（M0 报告 D2：DSH 无现成"轨迹 step"事件，必须派生）。
// DSH SessionEvent 采用结构化外形，避免测试依赖 pre-release 运行时包。

export interface DshEventData { [key: string]: unknown }
export interface DshSessionEvent {
  type: string;
  data: DshEventData;
}

export interface TextBlock { type: 'text'; text?: string }
export interface MessageContentBlock { type?: string; text?: string }

export function extractAssistantText(event: DshSessionEvent): string {
  const message = event.data.message as { content?: MessageContentBlock[] } | undefined;
  if (!message?.content) return '';
  const blocks: string[] = [];
  for (const block of message.content) {
    if (block.type === 'text' && typeof block.text === 'string') blocks.push(block.text);
  }
  return blocks.join('');
}

export function deriveProtocolEvents(sessionId: string, event: DshSessionEvent): ServerEvent[] {
  const ts = Date.now();
  switch (event.type) {
    case 'turn/start':
      return [{ type: 'agent.status', sessionId, ts, status: 'busy' }];
    case 'turn/end':
      return [{ type: 'agent.status', sessionId, ts, status: 'idle' }];
    case 'assistant/chunk': {
      const chunk = event.data.chunk as { type?: string; text?: string } | undefined;
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.length > 0) {
        return [{ type: 'message.delta', sessionId, ts, text: chunk.text }];
      }
      return [];
    }
    case 'assistant/message': {
      const text = extractAssistantText(event);
      if (!text) return [];
      return [{ type: 'message.complete', sessionId, ts, text }];
    }
    case 'tool/call': {
      const name = typeof event.data.name === 'string' ? event.data.name : 'unknown';
      return [{ type: 'trajectory.step', sessionId, ts, step: { kind: 'tool', label: name } }];
    }
    default:
      return [];
  }
}
```

- [ ] **Step 8: 跑测试确认通过 + 提交**

```bash
npx vitest run packages/gateway-core/test/derive.test.ts
git add packages/gateway-core/src/keys.ts packages/gateway-core/src/derive.ts packages/gateway-core/test/keys.test.ts packages/gateway-core/test/derive.test.ts
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "feat(gateway-core): 会话 id 映射 + SessionEvent 事件派生（纯函数）"
```
Expected: derive 6 个测试全 PASS，commit 成功。

---

## Task 3: DshRuntime（ctx → 结构化接口）

**Files:**
- Create: `packages/gateway-core/src/dsh-runtime.ts`
- Create: `packages/gateway-core/test/runtime.test.ts`

- [ ] **Step 1: 写失败测试 `test/runtime.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createDshRuntime, type DshRuntime } from '../src/dsh-runtime.js';

/** 最小可用的 Cordis ctx 替身：agents(create/resume) + on(event) + subagents。 */
function fakeCtx(overrides: Record<string, unknown> = {}) {
  const created: Array<Record<string, unknown>> = [];
  const resumed: Array<Record<string, unknown>> = [];
  const handlers = new Map<string, (payload: unknown, ...rest: unknown[]) => unknown>();
  const fakeAgent = { followup: () => {}, inject: () => {} };
  return {
    ctx: {
      agents: {
        create: async (opts: Record<string, unknown>) => { created.push(opts); return { agent: fakeAgent, dispose: async () => {} }; },
        resume: async (opts: Record<string, unknown>) => { resumed.push(opts); return { agent: fakeAgent, dispose: async () => {} }; },
      },
      on: (event: string, cb: (payload: unknown, ...rest: unknown[]) => unknown) => { handlers.set(event, cb); },
      subagents: { start: async () => ({}) },
      ...overrides,
    } as Parameters<typeof createDshRuntime>[0],
    created,
    resumed,
    handlers,
  };
}

describe('createDshRuntime', () => {
  it('ensureAgent 首次走 create，二次命中缓存', async () => {
    const { ctx, created, resumed } = fakeCtx();
    const runtime = createDshRuntime(ctx, { cwd: 'C:/work' });

    const a1 = await runtime.ensureAgent('dsh:cli:cli:local');
    const a2 = await runtime.ensureAgent('dsh:cli:cli:local');
    expect(a1).toBe(a2);
    expect(created).toHaveLength(1);
    expect(resumed).toHaveLength(0);
    expect(created[0].sessionId).toBe('dsh:cli:cli:local');
    expect((created[0].meta as { cwd: string }).cwd).toBe('C:/work');
  });

  it('配置 model 时 agentOptions 带上 provider/model', async () => {
    const { ctx, created } = fakeCtx();
    const runtime = createDshRuntime(ctx, { model: { provider: 'deepseek', model: 'deepseek-chat' } });
    await runtime.ensureAgent('dsh:cli:cli:local');
    expect((created[0].agentOptions as { provider: string }).provider).toBe('deepseek');
    expect((created[0].agentOptions as { model: string }).model).toBe('deepseek-chat');
  });

  it('buildUserMessage 产出 {content, source}', () => {
    const { ctx } = fakeCtx();
    const runtime = createDshRuntime(ctx, {});
    const msg = runtime.buildUserMessage('hi') as { content: unknown[]; source: { kind: string } };
    expect(msg.content).toEqual([{ type: 'text', text: 'hi' }]);
    expect(msg.source.kind).toBe('user');
  });

  it('onSessionEvent 只回调本网关前缀的会话', () => {
    const { ctx, handlers } = fakeCtx();
    const runtime = createDshRuntime(ctx, { sessionPrefix: 'dsh' });
    const seen: string[] = [];
    runtime.onSessionEvent((sessionId) => { seen.push(sessionId); });

    const cb = handlers.get('session/event') as (session: { header: { id: string } }, event: unknown) => void;
    cb({ header: { id: 'dsh:cli:cli:local' } }, { type: 'turn/start', data: {} });
    cb({ header: { id: 'lark:1:2' } }, { type: 'turn/start', data: {} });
    expect(seen).toEqual(['dsh:cli:cli:local']);
  });

  it('onApprovalRequest 只应答本网关前缀的会话，其余委托 next', async () => {
    const { ctx, handlers } = fakeCtx();
    const runtime = createDshRuntime(ctx, { sessionPrefix: 'dsh' });
    const answered: string[] = [];
    runtime.onApprovalRequest((req, next) => {
      answered.push(req.agent.session.header.id);
      return Promise.resolve('allowed-once' as const);
    });

    const cb = handlers.get('approval/request') as (
      req: { agent: { session: { header: { id: string } } } },
      next: () => Promise<string>,
    ) => Promise<string>;

    const own = await cb({ agent: { session: { header: { id: 'dsh:cli:cli:local' } } }, toolName: 'bash' }, async () => 'unavailable');
    expect(own).toBe('allowed-once');

    let delegated = false;
    const other = await cb({ agent: { session: { header: { id: 'lark:1:2' } } }, toolName: 'bash' }, async () => {
      delegated = true;
      return 'unavailable';
    });
    expect(delegated).toBe(true);
    expect(other).toBe('unavailable');
    expect(answered).toEqual(['dsh:cli:cli:local']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/gateway-core/test/runtime.test.ts
```
Expected: FAIL（`../src/dsh-runtime.js` 不存在）。

- [ ] **Step 3: 写 `src/dsh-runtime.ts`**

```ts
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { DshSessionEvent } from './derive.js';

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';

/** DSH approval/request 载荷的结构化外形（harness-lark 同款声明，见其 feishu-approval.ts）。 */
export interface ApprovalRequestLike {
  readonly agent: { session: { header: { id: string } } };
  readonly toolName: string;
  readonly callId?: string;
  readonly reason?: string;
  readonly signal?: AbortSignal;
}

export interface AgentLike {
  sessionId: string;
  followup(msg: unknown): void;
  inject(msg: unknown): void;
}

/** gateway-core 桥接依赖的 DSH 最小面。测试用 Fake 实现，运行时由 ctx 提供。 */
export interface DshRuntime {
  ensureAgent(sessionId: string): Promise<AgentLike>;
  buildUserMessage(text: string): unknown;
  onSessionEvent(cb: (sessionId: string, event: DshSessionEvent) => void): void;
  onApprovalRequest(
    cb: (req: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>,
  ): void;
  spawnSubagent(req: { label: string; prompt: string }): Promise<{ taskId: string }>;
}

export interface DshRuntimeOptions {
  cwd?: string;
  sessionPrefix?: string;
  model?: { provider?: string; model?: string };
}

/**
 * 把 Cordis ctx 翻译成 DshRuntime。
 * 会话生命周期遵循 harness-lark 已验证的模式：先 resume（撞 live 短暂重试），
 * 失败（未持久化）则 create。模型选择与 agent preset 挂载与 harness-lark 对齐。
 */
export function createDshRuntime(ctx: Context, opts: DshRuntimeOptions = {}): DshRuntime {
  const agents = ctx.agents;
  const prefix = opts.sessionPrefix ?? 'dsh';
  const live = new Map<string, AgentLike>();

  async function ensureAgent(sessionId: string): Promise<AgentLike> {
    const existing = live.get(sessionId);
    if (existing) return existing;

    const agentOptions = opts.model
      ? { provider: opts.model.provider, model: opts.model.model }
      : undefined;

    const setup = async (agentCtx: Context): Promise<void> => {
      // 挂载部署默认 agent preset（与 Web 创建的会话同款工具集），失败不阻断。
      const presets = (agentCtx as unknown as { get?: (key: string) => unknown }).get?.('agentPresets');
      if (presets && typeof presets === 'object' && 'mount' in presets) {
        await (presets as { mount: (c: Context) => Promise<unknown> }).mount(agentCtx).catch(() => undefined);
      }
    };

    let handle: { agent: Agent; dispose: () => Promise<void> } | undefined;
    const LIVE_COLLISION_RETRIES = 3;
    const LIVE_COLLISION_DELAY_MS = 1000;
    for (let attempt = 0; attempt < LIVE_COLLISION_RETRIES; attempt++) {
      try {
        handle = await agents.resume({ resumeSessionId: SessionId(sessionId), agentOptions, setup });
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/while it is live|already exists/.test(message)) break; // 未持久化 → 走 create
        await new Promise((r) => setTimeout(r, LIVE_COLLISION_DELAY_MS));
      }
    }
    if (!handle) {
      handle = await agents.create({
        sessionId: SessionId(sessionId),
        meta: { cwd: opts.cwd ?? process.cwd() },
        agentOptions,
        setup,
      });
    }

    const entry: AgentLike = {
      sessionId,
      followup: (msg) => handle!.agent.followup(msg),
      inject: (msg) => handle!.agent.inject(msg),
    };
    live.set(sessionId, entry);
    return entry;
  }

  return {
    ensureAgent,

    buildUserMessage(text) {
      return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } });
    },

    onSessionEvent(cb) {
      ctx.on('session/event', (session: { header: { id: string } }, event: DshSessionEvent) => {
        const sessionId = String(session.header.id);
        if (!sessionId.startsWith(`${prefix}:`)) return;
        cb(sessionId, event);
      });
    },

    onApprovalRequest(cb) {
      ctx.on(
        'approval/request',
        (req: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>) => {
          const sessionId = req.agent.session.header.id;
          if (!sessionId.startsWith(`${prefix}:`)) return next();
          return cb(req, next);
        },
        { prepend: true } as never,
      );
    },

    async spawnSubagent(req) {
      const subagents = (ctx as unknown as { subagents?: { start: (provider: string, request: unknown) => Promise<unknown> } }).subagents;
      const taskId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (!subagents) throw new Error('subagents 服务不可用（部署未安装 provider）');
      await subagents.start('spawn', {
        label: req.label,
        prompt: [{ type: 'text', text: req.prompt }],
      });
      return { taskId };
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run packages/gateway-core/test/runtime.test.ts
```
Expected: 5 个测试全 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/gateway-core/src/dsh-runtime.ts packages/gateway-core/test/runtime.test.ts
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "feat(gateway-core): DshRuntime（ctx → 结构化接口，resume/create + 事件过滤 + 审批委托）"
```

---

## Task 4: DshBridge（会话/审批/事件转发）

**Files:**
- Create: `packages/gateway-core/src/bridge.ts`
- Create: `packages/gateway-core/test/bridge.test.ts`

- [ ] **Step 1: 写失败测试 `test/bridge.test.ts`**

注意：`ProtocolServer` 的 `handlers` 是构造参数且不可变，所以先构造**可变的 handlers 对象** → 创建 ProtocolServer → `new DshBridge(server, runtime)` → 再 `Object.assign(handlers, bridge.handlers())`。这与 `index.ts` 的组装方式一致。

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { DshBridge } from '../src/bridge.js';
import type { DshRuntime } from '../src/dsh-runtime.js';
import { ProtocolServer, type ProtocolHandlers, type ServerEvent } from '@dsh-overdrive/sdk';

const TOKEN = 'test-token';

class FakeRuntime implements DshRuntime {
  followed: Array<{ sessionId: string; msg: { text: string } }> = [];
  ensured = new Set<string>();
  sessionCb?: (sessionId: string, event: { type: string; data: Record<string, unknown> }) => void;
  approvalCb?: (req: any, next: () => Promise<string>) => Promise<string>;
  subagentCalls: Array<{ label: string; prompt: string }> = [];

  async ensureAgent(sessionId: string) {
    this.ensured.add(sessionId);
    return {
      sessionId,
      followup: (msg: { text: string }) => this.followed.push({ sessionId, msg }),
      inject: () => {},
    };
  }
  buildUserMessage(text: string) { return { content: [{ type: 'text', text }], source: { kind: 'user' } }; }
  onSessionEvent(cb: (sessionId: string, event: { type: string; data: Record<string, unknown> }) => void) { this.sessionCb = cb; }
  onApprovalRequest(cb: (req: any, next: () => Promise<string>) => Promise<string>) { this.approvalCb = cb; }
  async spawnSubagent(req: { label: string; prompt: string }) { this.subagentCalls.push(req); return { taskId: 'sub-1' }; }

  push(sessionId: string, type: string, data: Record<string, unknown> = {}): void {
    this.sessionCb?.(sessionId, { type, data });
  }
  askApproval(req: { agent: { session: { header: { id: string } } }; toolName: string }): Promise<string> {
    if (!this.approvalCb) throw new Error('approvalCb 未注册');
    return this.approvalCb(req, async () => 'unavailable');
  }
}

async function setup(): Promise<{
  server: ProtocolServer; runtime: FakeRuntime; bridge: DshBridge;
  handlers: ProtocolHandlers; events: ServerEvent[]; port: number;
}> {
  const runtime = new FakeRuntime();
  const events: ServerEvent[] = [];
  const handlers = {} as ProtocolHandlers;
  const server = new ProtocolServer({ token: TOKEN, handlers, version: '0.1.0' });
  const bridge = new DshBridge(server, runtime, { approvalTimeoutMs: 60_000 });
  Object.assign(handlers, bridge.handlers());
  bridge.start();
  server.onEvent((ev) => events.push(ev));
  const port = await server.listen(0);
  return { server, runtime, bridge, handlers, events, port };
}

describe('DshBridge', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  afterEach(async () => { await ctx?.server.close(); });

  it('upsertSession 确保 agent 存在并返回协议会话键', async () => {
    ctx = await setup();
    const res = await ctx.handlers.upsertSession!({ platform: 'cli', channel: 'cli', user: 'local' });
    expect(res.sessionId).toBe('cli:cli:local');
    expect(ctx.runtime.ensured.has('dsh:cli:cli:local')).toBe(true);
  });

  it('sendMessage 用 followup 注入用户消息', async () => {
    ctx = await setup();
    await ctx.handlers.sendMessage!('cli:cli:local', { text: 'hello' });
    expect(ctx.runtime.followed).toHaveLength(1);
    expect(ctx.runtime.followed[0].sessionId).toBe('dsh:cli:cli:local');
    expect(ctx.runtime.followed[0].msg).toEqual({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } });
  });

  it('DSH 推送 assistant/message → 协议 message.complete', async () => {
    ctx = await setup();
    ctx.runtime.push('dsh:cli:cli:local', 'assistant/message', {
      message: { content: [{ type: 'text', text: '结果' }] },
    });
    expect(ctx.events.some((e) => e.type === 'message.complete' && e.text === '结果')).toBe(true);
  });

  it('审批流：DSH 询问 → 协议 approval.request；resolve approve → allowed-once', async () => {
    ctx = await setup();
    const outcomePromise = ctx.runtime.askApproval({
      agent: { session: { header: { id: 'dsh:cli:cli:local' } } },
      toolName: 'bash',
    });
    const req = ctx.events.find((e) => e.type === 'approval.request') as
      { type: 'approval.request'; reqId: string; summary: string } | undefined;
    expect(req).toBeDefined();
    expect(req!.summary).toContain('bash');

    const ok = await ctx.handlers.resolveApproval!(req!.reqId, 'approve');
    expect(ok.ok).toBe(true);
    await expect(outcomePromise).resolves.toBe('allowed-once');
  });

  it('审批拒绝 → rejected', async () => {
    ctx = await setup();
    const outcomePromise = ctx.runtime.askApproval({
      agent: { session: { header: { id: 'dsh:cli:cli:local' } } },
      toolName: 'bash',
    });
    const req = ctx.events.find((e) => e.type === 'approval.request') as { reqId: string } | undefined;
    await ctx.handlers.resolveApproval!(req!.reqId, 'reject');
    await expect(outcomePromise).resolves.toBe('rejected');
  });

  it('createTask(subagent) 委托 runtime.spawnSubagent；cron 抛错', async () => {
    ctx = await setup();
    const res = await ctx.handlers.createTask!({ sessionId: 'cli:cli:local', kind: 'subagent', prompt: '调研' });
    expect(res.taskId).toBe('sub-1');
    expect(ctx.runtime.subagentCalls[0].prompt).toBe('调研');

    await expect(
      ctx.handlers.createTask!({ sessionId: 'cli:cli:local', kind: 'cron', prompt: '每日', schedule: '0 8 * * *' }),
    ).rejects.toThrow(/cron/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/gateway-core/test/bridge.test.ts
```
Expected: FAIL（`../src/bridge.js` 不存在）。

- [ ] **Step 3: 写 `src/bridge.ts`**

```ts
import {
  ProtocolServer,
  sessionKey,
  type ProtocolHandlers,
  type ServerEvent,
} from '@dsh-overdrive/sdk';
import type { ApprovalOutcome, ApprovalRequestLike, DshRuntime } from './dsh-runtime.js';
import { deriveProtocolEvents } from './derive.js';
import { parseSessionKey, toDshSessionId } from './keys.js';

export interface BridgeOptions {
  /** 审批超时（毫秒），超时自动拒绝。 */
  approvalTimeoutMs?: number;
}

interface PendingApproval {
  sessionId: string;
  resolve: (outcome: ApprovalOutcome) => void;
  timeout: NodeJS.Timeout;
}

/**
 * 协议层与 DSH 之间的桥：会话 upsert/注入、事件转发（含轨迹派生）、
 * 审批应答（answerer，M0 报告 D5：网关侧自建应答通道）、子任务委托。
 */
export class DshBridge {
  private readonly pendings = new Map<string, PendingApproval>();
  private readonly approvalTimeoutMs: number;

  constructor(
    private readonly server: ProtocolServer,
    private readonly runtime: DshRuntime,
    opts: BridgeOptions = {},
  ) {
    this.approvalTimeoutMs = opts.approvalTimeoutMs ?? 120_000;
  }

  /** 订阅 DSH 事件与审批 waterfall。 */
  start(): void {
    this.runtime.onSessionEvent((sessionId, event) => {
      for (const ev of deriveProtocolEvents(sessionId, event)) this.server.emit(ev);
    });
    this.runtime.onApprovalRequest((req, next) => this.answerApproval(req, next));
  }

  handlers(): ProtocolHandlers {
    return {
      upsertSession: async ({ platform, channel, user }) => {
        await this.runtime.ensureAgent(toDshSessionId(platform, channel, user));
        return { sessionId: sessionKey(platform, channel, user) };
      },
      sendMessage: async (protocolSessionId, req) => {
        const { platform, channel, user } = parseSessionKey(protocolSessionId);
        const agent = await this.runtime.ensureAgent(toDshSessionId(platform, channel, user));
        agent.followup(this.runtime.buildUserMessage(req.text));
        return { runId: `${Date.now()}` };
      },
      resolveApproval: async (reqId, decision) => {
        const pending = this.pendings.get(reqId);
        if (!pending) return { ok: false };
        clearTimeout(pending.timeout);
        this.pendings.delete(reqId);
        pending.resolve(decision === 'approve' ? 'allowed-once' : 'rejected');
        return { ok: true };
      },
      createTask: async (req) => {
        if (req.kind === 'cron') {
          throw new Error('cron 任务在 M4 提供（gateway-core 自带调度器），当前版本仅支持 subagent');
        }
        const result = await this.runtime.spawnSubagent({
          label: req.prompt.slice(0, 40),
          prompt: req.prompt,
        });
        return { taskId: result.taskId };
      },
    };
  }

  private answerApproval(
    req: ApprovalRequestLike,
    _next: () => Promise<ApprovalOutcome>,
  ): Promise<ApprovalOutcome> {
    const sessionId = req.agent.session.header.id;
    const reqId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<ApprovalOutcome>((resolve) => {
      const pending: PendingApproval = {
        sessionId,
        resolve,
        timeout: setTimeout(() => {
          this.pendings.delete(reqId);
          resolve('rejected');
        }, this.approvalTimeoutMs),
      };
      pending.timeout.unref?.();
      this.pendings.set(reqId, pending);

      this.server.emit({
        type: 'approval.request',
        sessionId,
        ts: Date.now(),
        reqId,
        summary: `工具 ${req.toolName}${req.reason ? `：${req.reason}` : ''}`,
        timeoutMs: this.approvalTimeoutMs,
      });

      req.signal?.addEventListener('abort', () => {
        const current = this.pendings.get(reqId);
        if (current !== pending) return;
        clearTimeout(pending.timeout);
        this.pendings.delete(reqId);
        resolve('cancelled');
      }, { once: true });
    });
  }
}

// 让 ServerEvent 的联合类型在编译期被引用，避免未使用告警（审批事件经 server.emit 发送）。
export type { ServerEvent };
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run packages/gateway-core/test/bridge.test.ts
```
Expected: 6 个测试全 PASS。

- [ ] **Step 5: 全量回归 + 提交**

```bash
npx vitest run
git add packages/gateway-core/src/bridge.ts packages/gateway-core/test/bridge.test.ts
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "feat(gateway-core): DshBridge（会话/注入/事件转发/审批应答/子任务）"
```
Expected: 全量单测 PASS（sdk 12 + gateway 7 + mock 2 + gateway-core 新增）。

---

## Task 5: 插件入口重写（index.ts）与配置

**Files:**
- Modify: `packages/gateway-core/src/index.ts`
- Modify: `packages/gateway-core/test/plugin.test.ts`

- [ ] **Step 1: 重写 `src/index.ts`**

```ts
import { Context } from '@deepseek-ai/cordis';
import { ProtocolServer, type ProtocolHandlers } from '@dsh-overdrive/sdk';
import { DshBridge } from './bridge.js';
import { createDshRuntime } from './dsh-runtime.js';

export const name = 'dsh-overdrive-gateway-core';

/** 依赖注入：agents 是桥接的硬依赖；subagents 按需探测（不 inject，避免无 provider 的部署加载失败）。 */
export const inject = ['agents'];

export interface GatewayCoreConfig {
  token?: string;
  port?: number;
  sessionPrefix?: string;
  cwd?: string;
  model?: { provider?: string; model?: string };
  approvalTimeoutMs?: number;
}

/**
 * DSH 插件入口。组装 ProtocolServer + DshRuntime + DshBridge：
 * 协议层（HTTP/WS）由 SDK 提供，桥接逻辑见 bridge.ts。
 * 返回 `{ server, ready }` 供测试与上层复用。
 */
export function apply(ctx: Context, rawConfig: GatewayCoreConfig = {}) {
  const token = rawConfig.token ?? 'dev-token';
  const port = rawConfig.port ?? 3192;
  const approvalTimeoutMs = rawConfig.approvalTimeoutMs ?? 120_000;

  const handlers = {} as ProtocolHandlers;
  const server = new ProtocolServer({ token, handlers, version: '0.1.0' });
  const runtime = createDshRuntime(ctx, {
    cwd: rawConfig.cwd,
    sessionPrefix: rawConfig.sessionPrefix,
    model: rawConfig.model,
  });
  const bridge = new DshBridge(server, runtime, { approvalTimeoutMs });
  Object.assign(handlers, bridge.handlers());
  bridge.start();

  const ready = server.listen(port).then((p) => ({ port: p }));
  ctx.effect(() => () => server.close());

  console.log(`[dsh-overdrive-gateway-core] loaded, protocol server on 127.0.0.1:${port} (token: ${token === 'dev-token' ? 'dev-token' : '***'})`);
  return { server, ready, bridge };
}
```

- [ ] **Step 2: 重写 `test/plugin.test.ts`（富 Fake ctx）**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { apply, name } from '../src/index.js';

/** 富 Fake ctx：effect + agents + on + subagents，满足插件启动路径。 */
function fakeCtx() {
  const disposers: Array<() => Promise<void> | void> = [];
  const ctx = {
    agents: {
      create: async (opts: Record<string, unknown>) => ({
        agent: { followup: () => {}, inject: () => {} },
        dispose: async () => {},
        opts,
      }),
      resume: async () => { throw new Error('not persisted'); },
    },
    on: () => {},
    subagents: { start: async () => ({}) },
    effect(cb: () => unknown) {
      const out = cb();
      if (typeof out === 'function') disposers.push(out as () => Promise<void> | void);
    },
  } as Parameters<typeof apply>[0];
  return { ctx, disposers };
}

describe('gateway-core 插件', () => {
  let disposers: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const d of disposers.splice(0).reverse()) await d();
  });

  it('插件名正确', () => {
    expect(name).toBe('dsh-overdrive-gateway-core');
  });

  it('启动后协议服务端可访问（health）', async () => {
    const { ctx, disposers: ds } = fakeCtx();
    disposers = ds;
    const handle = apply(ctx, { token: 'test-token', port: 0 }) as unknown as {
      ready: Promise<{ port: number }>;
    };
    const { port } = await handle.ready;

    const res = await fetch(`http://127.0.0.1:${port}/v1/health`, {
      headers: { authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', version: '0.1.0' });
  });

  it('sendMessage 走桥接（agent 收到 followup）', async () => {
    const { ctx, disposers: ds } = fakeCtx();
    disposers = ds;
    const followed: Array<{ text: string }> = [];
    ctx.agents.create = async (opts: Record<string, unknown>) => ({
      agent: { followup: (m: { content: { text: string }[] }) => followed.push(m.content[0]), inject: () => {} },
      dispose: async () => {},
      opts,
    });

    const handle = apply(ctx, { token: 'test-token', port: 0 }) as unknown as {
      ready: Promise<{ port: number }>;
    };
    const { port } = await handle.ready;

    const res = await fetch(`http://127.0.0.1:${port}/v1/sessions/cli%3Acli%3Alocal/messages`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });
    expect(res.status).toBe(200);
    expect(followed).toEqual([{ type: 'text', text: 'hello' }]);
  });
});
```

- [ ] **Step 3: 跑测试确认通过（替换后）**

```bash
npx vitest run packages/gateway-core/test/plugin.test.ts
```
Expected: 3 个测试全 PASS（若 `apply` 返回类型与旧测试不兼容导致编译错误，以新测试文件为准）。

- [ ] **Step 4: 全量回归 + 构建 + 提交**

```bash
npx vitest run
npm run build
git add packages/gateway-core/src/index.ts packages/gateway-core/test/plugin.test.ts
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "feat(gateway-core): 插件入口重写（server+runtime+bridge 组装 + 配置）"
```
Expected: 全量单测 PASS；构建无错误；commit 成功。

---

## Task 6: 真机冒烟（真实 DSH 运行时加载验证）

**依赖前置：** 需要网络访问 npm registry（`@deepseek-ai/dsh` 已公开，8/13 发布）。**需要 LLM 凭据才能跑通"全链路"子步骤；无凭据时只验证"加载 + 协议可达 + 事件管道"（agent 运行报错本身也是事件，证明桥接工作）。**
**Files:**
- Create: `cordis.smoke.yml`

- [ ] **Step 1: 安装 DSH CLI（仓库根 devDependency）**

```bash
cd <workspace>
npm i -D @deepseek-ai/dsh
npx dsh --version
```
Expected: `dsh` 版本号输出。若 `@deepseek-ai/dsh` 安装失败（registry/tag 问题），**停在本任务并报告**（不要绕过；真实加载必须在官方 CLI 上进行）。

- [ ] **Step 2: 先构建全部包**

```bash
npm run build
```

- [ ] **Step 3: 写 `cordis.smoke.yml`**

```yaml
- insert:
    - id: overdrive-gateway-core
      name: 'C:/Users/Temo Tee/AppData/Roaming/TRAE SOLO/ModularData/ai-agent/work-mode-projects/6a81934bad0b9d1268fe198a/packages/gateway-core/dist/index.js'
      config:
        token: !!js process.env.DSH_OVERDRIVE_TOKEN
        port: 3192
        sessionPrefix: dsh
```

> 若在非本机执行，把 `name` 换成该机器上的仓库绝对路径（正斜杠）。

- [ ] **Step 4: 启动 DSH Web + 插件（后台运行）**

```bash
cd <workspace>
$env:DSH_OVERDRIVE_TOKEN='smoke-token'
npx dsh web --patch ./cordis.smoke.yml
```
以非阻塞方式启动（`blocking: false`），等待约 15–30s 直到日志出现：
- `[dsh-overdrive-gateway-core] loaded, protocol server on 127.0.0.1:3192`

- [ ] **Step 5: 验证协议服务端可达**

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:3192/v1/health' -Headers @{ authorization = 'Bearer smoke-token' }
```
Expected: `status = ok`。同时确认 DSH Web UI 在 `http://127.0.0.1:3080` 可打开。

- [ ] **Step 6: 可选全链路（有 LLM 凭据时）**

配置模型（二选一）：
- 设置环境变量 `DEEPSEEK_API_KEY=<key>`（DSH Web profile 默认模型路由使用）
- 或已有 DSH profile 配置过模型（`%USERPROFILE%\.dsh` 下），跳过本步配置

然后启动 gateway CLI 指向插件协议端口：

```powershell
$env:DSH_BASE_URL='http://127.0.0.1:3192'; $env:DSH_TOKEN='smoke-token'; $env:ALLOWLIST='cli:cli:local'
node packages/gateway/dist/index.js
```
在 stdin 输入 `你好`，观察：
- 若配置了模型：stdout 出现 `🧠`/`🛠️` 轨迹行与最终 `message.complete` 文本 → **PASS: 真机全链路**
- 若无模型：stdout 出现 `⛔`/`❌` 错误事件或 agent 状态事件 → **PASS: 事件管道**（并在报告中注明"未配置模型，仅验证管道"）

- [ ] **Step 7: 停止后台进程，提交**

```bash
git add cordis.smoke.yml package.json package-lock.json
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "test(gateway-core): 真机冒烟配置（cordis.smoke.yml + dsh CLI devDep）"
```
报告必须写明：Step 4 日志、Step 5 health 结果、Step 6 走的是"全链路"还是"仅管道"、以及任何 DSH 侧的报错原文。

---

## Task 7: 文档收尾

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 更新 README 进度段**

把 `## 当前进度（M1 完成）` 段替换为：

```markdown
## 当前进度（M2 完成）

- ✅ gateway-core 真实桥接：会话 upsert/注入（ctx.agents + followup）
- ✅ 输出与轨迹：session/event 订阅 → message.delta/complete + trajectory.step（派生）
- ✅ 审批：approval/request answerer → 协议按钮 → allowed-once/rejected/cancelled
- ✅ 子任务表面（ctx.subagents）；cron 调度器在 M4
- ✅ 真机冒烟：`npx dsh web --patch ./cordis.smoke.yml` 加载验证
- ⏳ 平台适配器（WhatsApp/Telegram/…）见 M2b 计划
```

- [ ] **Step 2: 最终全量验证 + 提交**

```bash
npx vitest run
npm run build
git add README.md
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "docs: M2（真实桥接 + 真机冒烟）完成状态"
git log --oneline
```
Expected: 全量 PASS；git log 显示本计划全部 commit。

---

## Self-Review 结果

- **Spec/报告覆盖：** interface-report §7 的 7 组桥接项——①会话 upsert（bridge.handlers.upsertSession + runtime.ensureAgent）②消息注入（sendMessage → followup）③输出订阅（onSessionEvent + derive）④轨迹派生（derive.tool/call → trajectory.step）⑤审批（answerApproval + resolveApproval）⑥子任务（spawnSubagent；cron 明确延后 M4）⑦插件注册（cordis.smoke.yml + inject/apply 形态）。设计文档 §5 组件、§6 协议端点全部有任务覆盖。
- **D1-D6 处理：** D1 会话键 `dsh:` 前缀（keys.ts）；D2 轨迹派生（derive.ts）；D3 审批词汇映射 approve→allowed-once / reject→rejected，cancelled 由 signal abort 表达（bridge.ts）；D4 cron 延后并在 createTask 明确报错；D5 网关侧 answerer（bridge.answerApproval）；D6 依赖版本与 npm 解析在 Task 1 验证，失败即停。
- **占位符扫描：** 无 TBD/TODO；唯一"可选"步骤是 Task 6 Step 6（LLM 凭据有无的两种验收路径，都有明确期望输出），非占位。
- **类型一致性：** `DshRuntime`/`AgentLike`/`ApprovalRequestLike`/`ProtocolHandlers`/`ServerEvent` 跨任务签名一致；`apply` 返回 `{ server, ready, bridge }` 保持 M1 测试兼容（M1 测试已在 Task 5 用富 Fake ctx 重写）；`bridge.handlers()` 通过 `Object.assign` 注入可变 handlers 对象，与 `index.ts` 组装一致（Task 4 Step 1 的"修正说明"已消除构造期注入的缺陷）。
