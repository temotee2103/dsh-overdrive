# dsh-overdrive M4 实施计划：爆款特性（轨迹/命令面/cron/流式/媒体/WhatsApp 原生按钮）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 兑现设计 §2 的三大主打：①**聊天内全程可追踪**（turn 级轨迹聚合 + `/trace` 命令）；②**自主多智能体**（`/task` 子任务、`/cron` 定时任务（gateway-core 自研调度器，D4）、`/agents` 状态、`/new` 重置）；③**流式/媒体/原生审批按钮**（`message.delta` 打字指示、图片收发、WhatsApp 原生交互审批按钮）。

**Architecture:** 命令面与轨迹聚合放在 gateway 侧纯函数模块（可单测）；cron 调度器与子任务接线在 gateway-core（bridge + scheduler，面向 DshRuntime 接口可测）；WhatsApp 原生按钮是 Baileys send 层改造 + 纯函数；媒体沿既有协议 `SendMessageRequest.media` 全链路打通。

**Tech Stack:** 既有 TS/vitest/sdk/gateway/gateway-core；`node:cron` 不用（自研 5 字段匹配纯函数，避免依赖）。

**Scope 说明（重要）：**
- **流式渲染** = `message.delta` 触发平台"打字中"指示（`Adapter.sendTyping?` 可选方法），complete 发最终消息。逐 token 编辑消息仅 Telegram/Discord 预留（M5 后候选），跨平台一致性优先。
- **语音**：接收后降级为明确提示（"收到语音，暂不支持转写；请发文字"），ASR 接入留 M5 后（需外部 provider）。
- **图片**：走 `media` 协议字段 → DSH content block `{type:'image'}`；模型不支持多模态时以 `error` 事件降级（bridge 已具备错误透传）。
- cron 5 字段语法 `分 时 日 月 周`，由调度循环每 30s 检查一次 `nextRun`。

---

## File Structure（本计划新增/修改）

```
packages/gateway/
├── src/
│   ├── adapter.ts            # 修改：+sendTyping? 可选方法
│   ├── commands.ts           # 新增：命令解析与处理（纯函数）
│   ├── trajectory.ts         # 新增：turn 级轨迹聚合（纯函数）
│   ├── index.ts              # 修改：接线命令面 + 轨迹聚合 + delta 打字指示
│   └── adapters/
│       ├── telegram.ts       # 修改：sendTyping + 图片捕获
│       ├── whatsapp.ts       # 修改：原生交互按钮 + 图片捕获
│       ├── discord.ts        # 修改：sendTyping + 图片捕获
│       └── slack.ts          # 修改：sendTyping（无操作）+ 图片 URL
├── test/
│   ├── commands.test.ts
│   ├── trajectory.test.ts
│   ├── streaming.test.ts
│   └── adapters.whatsapp.test.ts  # 修改：+原生按钮用例
packages/gateway-core/
├── src/
│   ├── cron.ts               # 新增：5 字段 cron 匹配 + nextRun（纯函数）
│   ├── bridge.ts             # 修改：createTask 支持 cron（D4）+ 媒体 content block
│   └── dsh-runtime.ts        # 修改：buildUserMessage 支持 media
├── test/
│   ├── cron.test.ts
│   └── bridge.test.ts        # 修改：+cron +media 用例
README.md / docs/smoke-platforms.md  # 修改
```

---

## Task 1: 命令面 + 轨迹聚合（纯函数层）

**Files:**
- Create: `packages/gateway/src/commands.ts`
- Create: `packages/gateway/src/trajectory.ts`
- Create: `packages/gateway/test/commands.test.ts`
- Create: `packages/gateway/test/trajectory.test.ts`

- [ ] **Step 1: 写失败测试 `test/commands.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { parseCommand, type ParsedCommand } from '../src/commands.js';

describe('parseCommand', () => {
  it('识别 /trace、/task、/cron、/agents、/new、/help', () => {
    expect(parseCommand('/trace')).toEqual({ kind: 'trace' });
    expect(parseCommand('/new')).toEqual({ kind: 'new' });
    expect(parseCommand('/agents')).toEqual({ kind: 'agents' });
    expect(parseCommand('/help')).toEqual({ kind: 'help' });
    expect(parseCommand('/task 调研竞品')).toEqual({ kind: 'task', prompt: '调研竞品' });
    expect(parseCommand('/cron 0 8 * * * 每日汇报')).toEqual({ kind: 'cron', schedule: '0 8 * * *', prompt: '每日汇报' });
  });
  it('非命令返回 null', () => {
    expect(parseCommand('hello')).toBeNull();
    expect(parseCommand('/unknown')).toBeNull();
    expect(parseCommand('/task')).toBeNull(); // 缺参数
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/gateway/test/commands.test.ts
```

- [ ] **Step 3: 写 `src/commands.ts`**

```ts
export type ParsedCommand =
  | { kind: 'trace' }
  | { kind: 'new' }
  | { kind: 'agents' }
  | { kind: 'help' }
  | { kind: 'task'; prompt: string }
  | { kind: 'cron'; schedule: string; prompt: string };

const CRON_RE = /^\/cron\s+(\S+)\s+(.+)$/;

export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (trimmed === '/trace') return { kind: 'trace' };
  if (trimmed === '/new') return { kind: 'new' };
  if (trimmed === '/agents') return { kind: 'agents' };
  if (trimmed === '/help') return { kind: 'help' };
  const task = trimmed.match(/^\/task\s+(.+)$/);
  if (task) return { kind: 'task', prompt: task[1] };
  const cron = trimmed.match(CRON_RE);
  if (cron) return { kind: 'cron', schedule: cron[1], prompt: cron[2] };
  return null;
}

export const HELP_TEXT = [
  '/help — 帮助',
  '/trace — 查看最近一轮轨迹',
  '/task <需求> — 派子任务',
  '/cron <分 时 日 月 周> <需求> — 定时任务',
  '/agents — 查看子任务状态',
  '/new — 重置会话',
].join('\n');
```

- [ ] **Step 4: 写失败测试 `test/trajectory.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { TrajectoryAggregator } from '../src/trajectory.js';
import type { ServerEvent } from '@dsh-overdrive/sdk';

describe('TrajectoryAggregator', () => {
  it('聚合 turn 内轨迹，turn 结束产出摘要', () => {
    const agg = new TrajectoryAggregator();
    const events: ServerEvent[] = [];
    agg.onEvent({ type: 'agent.status', sessionId: 'cli:cli:local', ts: 1, status: 'busy' }, (ev) => events.push(ev));
    agg.onEvent({ type: 'trajectory.step', sessionId: 'cli:cli:local', ts: 2, step: { kind: 'thought', label: '分析' } }, (ev) => events.push(ev));
    agg.onEvent({ type: 'trajectory.step', sessionId: 'cli:cli:local', ts: 3, step: { kind: 'tool', label: 'bash' } }, (ev) => events.push(ev));
    agg.onEvent({ type: 'agent.status', sessionId: 'cli:cli:local', ts: 4, status: 'idle' }, (ev) => events.push(ev));

    const summary = events.find((e) => e.type === 'trajectory.summary');
    expect(summary).toBeDefined();
    const text = (summary as { text: string }).text;
    expect(text).toContain('🧠 分析');
    expect(text).toContain('🛠️ bash');
  });

  it('busy 状态在摘要前透传，idle 后清空缓冲', () => {
    const agg = new TrajectoryAggregator();
    const events: ServerEvent[] = [];
    agg.onEvent({ type: 'agent.status', sessionId: 'cli:cli:local', ts: 1, status: 'busy' }, (ev) => events.push(ev));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('agent.status');

    agg.onEvent({ type: 'agent.status', sessionId: 'cli:cli:local', ts: 2, status: 'idle' }, (ev) => events.push(ev));
    expect(events).toHaveLength(2);
  });

  it('其他事件（message.complete 等）原样透传', () => {
    const agg = new TrajectoryAggregator();
    const events: ServerEvent[] = [];
    agg.onEvent({ type: 'message.complete', sessionId: 's', ts: 1, text: '结果' }, (ev) => events.push(ev));
    expect(events).toEqual([{ type: 'message.complete', sessionId: 's', ts: 1, text: '结果' }]);
  });
});
```

- [ ] **Step 5: 跑测试确认失败 → 写 `src/trajectory.ts`**

```bash
npx vitest run packages/gateway/test/trajectory.test.ts   # FAIL（模块不存在）
```

```ts
import type { ServerEvent, TrajectoryStep } from '@dsh-overdrive/sdk';

/** turn 级轨迹聚合：收集 trajectory.step，turn/end（idle）时产出 trajectory.summary 摘要卡片。 */
export class TrajectoryAggregator {
  private readonly buffer = new Map<string, TrajectoryStep[]>();

  onEvent(ev: ServerEvent, emit: (ev: ServerEvent) => void): void {
    if (ev.type === 'agent.status' && ev.status === 'idle') {
      const steps = this.buffer.get(ev.sessionId) ?? [];
      this.buffer.delete(ev.sessionId);
      if (steps.length > 0) {
        emit({ type: 'trajectory.summary', sessionId: ev.sessionId, ts: Date.now(), steps });
      }
      emit(ev);
      return;
    }
    if (ev.type === 'agent.status' && ev.status === 'busy') {
      this.buffer.set(ev.sessionId, []);
      emit(ev);
      return;
    }
    if (ev.type === 'trajectory.step') {
      const list = this.buffer.get(ev.sessionId);
      if (list) list.push(ev.step);
      else this.buffer.set(ev.sessionId, [ev.step]);
      return; // 单步不实时推，等摘要（减少刷屏）
    }
    emit(ev);
  }
}

export function formatTrajectorySummary(steps: TrajectoryStep[]): string {
  const lines = steps.map((s) => {
    const icon = s.kind === 'tool' ? '🛠️' : s.kind === 'subagent' ? '🤖' : '🧠';
    return `${icon} ${s.label}`;
  });
  return `📋 轨迹（${lines.length} 步）\n${lines.join('\n')}`;
}
```

> 协议 `ServerEvent` 需要新增 `trajectory.summary` 变体：在 `packages/sdk/src/protocol.ts` 的 `ServerEvent` 联合类型追加 `| { type: 'trajectory.summary'; sessionId: string; ts: number; steps: TrajectoryStep[] }`，并同步 `planOutbound`（gateway）对该事件的渲染为 `formatTrajectorySummary(steps)`。此修改含在 Task 2 的接线步骤中。

- [ ] **Step 6: 跑测试确认通过 + 提交**

```bash
npx vitest run packages/gateway/test/commands.test.ts packages/gateway/test/trajectory.test.ts
git add packages/gateway/src/commands.ts packages/gateway/src/trajectory.ts packages/gateway/test/commands.test.ts packages/gateway/test/trajectory.test.ts
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "feat(gateway): 命令面解析 + turn 级轨迹聚合"
```
Expected: commands 4 个 + trajectory 3 个测试 PASS。

---

## Task 2: Gateway 接线（命令处理 + 轨迹摘要 + 流式打字指示）

**Files:**
- Modify: `packages/sdk/src/protocol.ts`（+`trajectory.summary` 事件）
- Modify: `packages/gateway/src/adapter.ts`（+`sendTyping?`）
- Modify: `packages/gateway/src/index.ts`（命令分发 + TrajectoryAggregator + delta→typing）
- Create: `packages/gateway/test/streaming.test.ts`

- [ ] **Step 1: 协议加 `trajectory.summary`**

在 `packages/sdk/src/protocol.ts` 的 `ServerEvent` 联合类型追加：

```ts
  | { type: 'trajectory.summary'; sessionId: string; ts: number; steps: TrajectoryStep[] }
```

- [ ] **Step 2: `adapter.ts` 加可选打字方法**

```ts
export interface Adapter {
  readonly id: string;
  connect(): Promise<void>;
  send(chatId: string, payload: OutboundPayload): Promise<void>;
  /** 可选：平台"正在输入"指示（Telegram/WhatsApp 实现，其余默认无操作）。 */
  sendTyping?(chatId: string): Promise<void>;
  onMessage(cb: (msg: NormalizedMessage) => void): void;
  onReply(cb: (buttonId: string) => void): void;
}
```

- [ ] **Step 3: 写失败测试 `test/streaming.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { DeltaTracker } from '../src/index.js';

describe('DeltaTracker（message.delta → 打字指示，complete → 终稿）', () => {
  it('首个 delta 触发 typing，重复 delta 不重复触发', () => {
    const t = new DeltaTracker();
    const typings: string[] = [];
    const outputs: string[] = [];
    t.onDelta('s1', () => typings.push('s1'));
    t.onDelta('s1', () => typings.push('s1'));
    expect(typings).toEqual(['s1']);
    void outputs;
  });
});
```

- [ ] **Step 4: 跑测试确认失败 → 修改 `src/index.ts`**

```bash
npx vitest run packages/gateway/test/streaming.test.ts   # FAIL
```

`index.ts` 变更点：
1. 新增 `export class DeltaTracker`（按 sessionId 记录已触发 typing，`onDelta(sessionId, fireTyping)`）。
2. `wireAdapter` 内：
   - 用 `TrajectoryAggregator` 包一层事件流（`aggregator.onEvent(ev, (out) => { ...原 planOutbound+send 逻辑... })`）；
   - `planOutbound` 增加 `trajectory.summary` → `{ payload: { text: formatTrajectorySummary(ev.steps) } }`；
   - `message.delta` → 调 `adapter.sendTyping?.(chatId)`（经 `DeltaTracker` 去重），不 send 文本；
   - 命令面：`adapter.onMessage` 先 `parseCommand(msg.text)`，命中则分发：
     - `trace` → 查最近摘要缓冲（`TrajectoryAggregator` 暴露 `recentSummary(sessionId)`），无则"暂无轨迹"；
     - `new` → 用 `buildSessionKey` 相同参数发 `POST /v1/tasks`？否——`new` 需重置会话：调用新协议端点（见 Step 5）。
     - `task` → `client.createTask({ sessionId: key, kind: 'subagent', prompt })`，回执"🤖 子任务已派出"；
     - `cron` → `client.createTask({ sessionId: key, kind: 'cron', prompt, schedule })`，回执"⏰ 定时任务已注册"；
     - `agents` → 回执"（M4 简化）子任务状态由 agent 汇报，/task 派发"；
     - `help` → `HELP_TEXT`。
3. `TrajectoryAggregator` 增加 `recentSummary(sessionId): string | null`（保存最近一次摘要文本）。

- [ ] **Step 5: 协议加"重置会话"端点（配合 /new）**

`packages/sdk/src/protocol.ts` 增补（server.ts 同步路由）：

```ts
export interface ResetSessionRequest { /* 空 */ }
export interface ResetSessionResponse { ok: boolean }
```
`packages/sdk/src/server.ts` 增加路由 `POST /v1/sessions/:id/reset` → `handlers.resetSession(sessionId)`；`ProtocolHandlers` 增 `resetSession(sessionId: string): Promise<{ ok: boolean }>`；`GatewayClient` 增 `resetSession(sessionId): Promise<ResetSessionResponse>`。
`packages/gateway-core` 的 bridge 实现 `resetSession`：`runtime.destroyAgent(sessionId)`（`DshRuntime` 增 `destroyAgent?`，真实实现 `agent.dispose()` + `live.delete`；FakeRuntime 实现之）。`/new` 命令即调用它，随后回执"🆕 会话已重置"。

- [ ] **Step 6: 全量回归 + 提交**

```bash
npx vitest run
npm run build
npm run e2e
git add packages/sdk/src/protocol.ts packages/sdk/src/server.ts packages/sdk/src/client.ts packages/gateway/src/adapter.ts packages/gateway/src/index.ts packages/gateway/test/streaming.test.ts
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "feat(gateway): 命令面接线 + 轨迹摘要渲染 + delta 打字指示 + 会话重置"
```
Expected: 全量 PASS；E2E 三条路径 PASS（CLI 适配器无 sendTyping，无影响）。

---

## Task 3: gateway-core cron 调度器 + subagent/cron 落地

**Files:**
- Create: `packages/gateway-core/src/cron.ts`
- Create: `packages/gateway-core/test/cron.test.ts`
- Modify: `packages/gateway-core/src/bridge.ts`（createTask 支持 cron + media content block）
- Modify: `packages/gateway-core/src/dsh-runtime.ts`（buildUserMessage 支持 media + destroyAgent）
- Modify: `packages/gateway-core/test/bridge.test.ts`

- [ ] **Step 1: 写失败测试 `test/cron.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { cronMatches, parseCron } from '../src/cron.js';

describe('parseCron（5 字段）', () => {
  it('解析合法表达式', () => {
    expect(parseCron('0 8 * * *')).toEqual({ minute: [0], hour: [8], dayOfMonth: '*', month: '*', dayOfWeek: '*' });
  });
  it('非法表达式抛错', () => {
    expect(() => parseCron('0 8 *')).toThrow();
    expect(() => parseCron('60 8 * * *')).toThrow();
  });
});

describe('cronMatches', () => {
  it('每天 08:00 命中', () => {
    const cron = parseCron('0 8 * * *');
    expect(cronMatches(cron, new Date(2026, 7, 16, 8, 0))).toBe(true);
    expect(cronMatches(cron, new Date(2026, 7, 16, 8, 1))).toBe(false);
    expect(cronMatches(cron, new Date(2026, 7, 17, 8, 0))).toBe(true);
  });
  it('每周一 09:30 命中', () => {
    const cron = parseCron('30 9 * * 1');
    expect(cronMatches(cron, new Date(2026, 7, 17, 9, 30))).toBe(true); // 2026-08-17 是周一
    expect(cronMatches(cron, new Date(2026, 7, 18, 9, 30))).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败 → 写 `src/cron.ts`**

```bash
npx vitest run packages/gateway-core/test/cron.test.ts   # FAIL
```

```ts
export interface CronSchedule {
  minute: number[];
  hour: number[];
  dayOfMonth: '*' | number[];
  month: number[];
  dayOfWeek: '*' | number[];
}

function parseField(field: string, min: number, max: number, name: string): number[] | '*' {
  if (field === '*') return '*';
  return field.split(',').map((part) => {
    const n = Number(part);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`cron ${name} 字段非法: ${part}`);
    return n;
  });
}

export function parseCron(expr: string): CronSchedule {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron 需要 5 个字段: ${expr}`);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const monthNums = parseField(month, 1, 12, 'month');
  const dom = parseField(dayOfMonth, 1, 31, 'day-of-month');
  const dow = parseField(dayOfWeek, 0, 6, 'day-of-week');
  return {
    minute: parseField(minute, 0, 59, 'minute') as number[],
    hour: parseField(hour, 0, 23, 'hour') as number[],
    dayOfMonth: dom === '*' ? '*' : dom,
    month: monthNums as number[],
    dayOfWeek: dow === '*' ? '*' : dow,
  };
}

export function cronMatches(cron: CronSchedule, date: Date): boolean {
  if (!cron.minute.includes(date.getMinutes())) return false;
  if (!cron.hour.includes(date.getHours())) return false;
  if (!cron.month.includes(date.getMonth() + 1)) return false;
  if (cron.dayOfMonth !== '*' && !cron.dayOfMonth.includes(date.getDate())) return false;
  if (cron.dayOfWeek !== '*' && !cron.dayOfWeek.includes(date.getDay())) return false;
  return true;
}

/** 下一次命中时间（精确到分钟），用于调度循环对齐。 */
export function nextRunTime(cron: CronSchedule, from: Date): Date {
  const t = new Date(from);
  t.setSeconds(0, 0);
  for (let i = 0; i < 60 * 24 * 366; i++) {
    t.setMinutes(t.getMinutes() + 1);
    if (cronMatches(cron, t)) return t;
  }
  throw new Error('无法在一年内找到 cron 下次执行时间');
}
```

- [ ] **Step 3: 改 `dsh-runtime.ts`：buildUserMessage 支持 media + destroyAgent**

`buildUserMessage(text, media?)`：media 有值时 content 为 `[{ type: 'text', text }, { type: 'image', url }]`（DSH content block 支持 `{type:'image', url}`；若模型/运行时类型不允许，以实际 dsh-llm 类型为准，仅保留文本并 console.warn 降级）。新增 `destroyAgent(sessionId)`：`live.get(sessionId)?.dispose?.()` + `live.delete(sessionId)`（`AgentLike` 增 `dispose?: () => Promise<void>`；`DshRuntime` 接口增 `destroyAgent?(sessionId): Promise<void>`）。

- [ ] **Step 4: 改 `bridge.ts`：createTask 支持 cron + resetSession + media 透传**

```ts
createTask: async (req) => {
  if (req.kind === 'cron') {
    if (!req.schedule) throw new Error('cron 任务需要 schedule（5 字段）');
    const { parseCron } = await import('./cron.js');
    const cron = parseCron(req.schedule); // 非法直接抛错，注册失败
    this.cronJobs.set(req.prompt, { sessionId: req.sessionId, cron, prompt: req.prompt, lastFiredMinute: -1 });
    return { taskId: `cron-${Date.now()}` };
  }
  const result = await this.runtime.spawnSubagent({ label: req.prompt.slice(0, 40), prompt: req.prompt });
  return { taskId: result.taskId };
},
resetSession: async (sessionId) => {
  await this.runtime.destroyAgent?.(toDshSessionId(...parseSessionKey(sessionId)));
  return { ok: true };
},
```

`DshBridge` 增 `startCronLoop()`（`start()` 里调用）：`setInterval` 每 30s 遍历 `cronJobs`，`cronMatches` 命中且分钟未执行过 → `runtime.ensureAgent(sessionId)` + `agent.followup(runtime.buildUserMessage(prompt))`（空闲唤醒语义，M0 报告 D4 cookbook 范式）；`ctx.effect` 清理 interval。`sendMessage` handler 改为 `agent.followup(this.runtime.buildUserMessage(req.text, req.media))`。

- [ ] **Step 5: 补 `test/bridge.test.ts` 用例（cron 注册 + media 透传 + reset）**

```ts
it('createTask(cron) 注册成功且 /v1/tasks 返回 taskId', async () => {
  ctx = await setup();
  const res = await ctx.handlers.createTask!({ sessionId: 'cli:cli:local', kind: 'cron', prompt: '汇报', schedule: '0 8 * * *' });
  expect(res.taskId).toMatch(/^cron-/);
});
it('sendMessage 带 media 时 buildUserMessage 收到 media', async () => {
  ctx = await setup();
  await ctx.handlers.sendMessage!('cli:cli:local', { text: '看图', media: { kind: 'image', url: 'https://x/y.png' } });
  expect(ctx.runtime.followed[0].msg).toMatchObject({ content: [{ type: 'text', text: '看图' }] });
});
it('resetSession 调 runtime.destroyAgent', async () => {
  ctx = await setup();
  await ctx.handlers.resetSession!('cli:cli:local');
  expect(ctx.runtime.destroyed).toContain('dsh:cli:cli:local');
});
```

（`FakeRuntime` 相应增 `destroyed: string[]` 与 `destroyAgent` 记录；原"cron 抛错"用例改为"cron 非法 schedule 抛错"。）

- [ ] **Step 6: 全量回归 + 提交**

```bash
npx vitest run
npm run build
git add packages/gateway-core/src/cron.ts packages/gateway-core/test/cron.test.ts packages/gateway-core/src/bridge.ts packages/gateway-core/src/dsh-runtime.ts packages/gateway-core/test/bridge.test.ts
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "feat(gateway-core): cron 调度器（自研 5 字段）+ subagent/cron 命令落地 + media 透传 + 会话重置"
```
Expected: 全量 PASS。

---

## Task 4: WhatsApp 原生交互审批按钮

**Files:**
- Modify: `packages/gateway/src/adapters/whatsapp.ts`
- Modify: `packages/gateway/test/adapters.whatsapp.test.ts`

- [ ] **Step 1: 加失败测试（原生按钮纯函数）**

```ts
import { buildNativeFlowButtons } from '../src/adapters/whatsapp.js';
describe('buildNativeFlowButtons（WhatsApp 原生交互按钮）', () => {
  it('按钮 → nativeFlowMessage buttons 数组', () => {
    const buttons = buildNativeFlowButtons([
      { id: 'approve:r1', label: '✅ 同意' },
      { id: 'reject:r1', label: '🚫 拒绝' },
    ]);
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toMatchObject({ name: 'quick_reply', buttonParamsJson: JSON.stringify({ id: 'approve:r1', display_text: '✅ 同意' }) });
  });
});
```

- [ ] **Step 2: 实现（覆盖编号文本方案 → 原生按钮优先）**

`whatsapp.ts` 变更：
1. 新增纯函数 `buildNativeFlowButtons(buttons)`：返回 `[{ name: 'quick_reply', buttonParamsJson: JSON.stringify({ id, display_text }) }]`。
2. `send()`：有按钮时改发 `interactive.nativeFlowMessage`（不再发编号文本；`pendingButtons` 保留用于"编号回复"兜底兼容，但按钮响应走 `interactiveResponseMessage` 解析）。
3. `messages.upsert` 处理新增分支：`raw.message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson`（JSON 串含 `id`）→ `replyCb(id)`。

```ts
export function parseNativeButtonResponse(raw: RawWhatsAppMessage): string | null {
  const interactive = raw.message?.interactiveResponseMessage as
    | { nativeFlowResponseMessage?: { paramsJson?: string } } | undefined;
  const params = interactive?.nativeFlowResponseMessage?.paramsJson;
  if (!params) return null;
  try {
    const parsed = JSON.parse(params) as { id?: string };
    return parsed.id ?? null;
  } catch {
    return null;
  }
}
```

测试补充：`parseNativeButtonResponse` 解析 `{"id":"approve:r1"}` → `'approve:r1'`；`buildNativeFlowButtons` 断言（Step 1）。

- [ ] **Step 3: 跑测试确认通过 + 提交**

```bash
npx vitest run packages/gateway/test/adapters.whatsapp.test.ts
npm run build
git add packages/gateway/src/adapters/whatsapp.ts packages/gateway/test/adapters.whatsapp.test.ts
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "feat(gateway): WhatsApp 原生交互审批按钮（nativeFlowMessage）+ 按钮响应解析"
```
Expected: whatsapp 测试全 PASS（含新增原生按钮用例；若 Baileys 6.x 的 interactive 载荷类型与实际不符，以 `AnyMessageContent` 类型为准微调 send()，纯函数测试不受影响）。

---

## Task 5: 媒体收发（图片）全链路

**Files:**
- Modify: `packages/gateway/src/adapters/telegram.ts`（+图片捕获）
- Modify: `packages/gateway/src/adapters/discord.ts`（+图片捕获）
- Modify: `packages/gateway/src/adapters/slack.ts`（+图片捕获）
- Modify: `packages/gateway/src/adapters/whatsapp.ts`（+图片捕获 + 语音降级提示）
- Modify: `packages/gateway/test/adapters.*.test.ts`（各 +1 用例）

- [ ] **Step 1: 各适配器图片捕获（纯函数 + 薄层）**

统一规则：文本消息优先；若消息含图片（各平台字段不同）则产出 `media: { kind: 'image', url }` 附在 `NormalizedMessage.media`；语音/视频/文件 → `media: { kind: <type> }` 由 gateway-core 处理（不支持则降级）。

- **Telegram**：`ctx.message.photo` 有值时取最后一张 `file_id` → `https://api.telegram.org/file/bot<token>/<file_path>`（需 `getFile` 换 path；纯函数 `telegramImageUrl(token, photo)` 只做 file_id → URL 模板，真实 getFile 在 adapter）。
- **Discord**：`message.attachments.first()?.url`（纯函数 `discordAttachmentUrl(msg)`）。
- **Slack**：`message.files?.[0]?.url_private`（纯函数 `slackFileUrl(msg)`；需 `Authorization` header，`send` 侧无此问题——M4 简化：URL 直接透传，私有文件需 token 的后续再补）。
- **WhatsApp**：`imageMessage.url` 直接可用（Baileys 下载后的 url 字段）或 `directPath`；纯函数 `whatsappImageUrl(raw)`。

测试：各 +1 纯函数用例（构造含图消息断言 media 字段）。

- [ ] **Step 2: gateway 透传 media**

`wireAdapter` 的 `client.sendMessage(key, { text: msg.text, media: msg.media })` 已有 media 透传（M2 已实现），无需改动；仅确认 `NormalizedMessage.media` 贯通到协议 `SendMessageRequest.media`（类型已一致）。

- [ ] **Step 3: gateway-core 媒体处理（image → content block，语音降级）**

`dsh-runtime.buildUserMessage(text, media)`：`media.kind === 'image' && media.url` → 追加 `{ type: 'image', url: media.url }`（Task 3 已改，此处补语音降级）：`media.kind === 'voice'` → 文本末尾追加 `\n[收到语音消息，暂不支持转写]` 并 console.warn。

- [ ] **Step 4: 全量回归 + 提交**

```bash
npx vitest run
npm run build
git add packages/gateway/src/adapters packages/gateway/test packages/gateway-core/src/dsh-runtime.ts
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "feat(gateway): 图片收发全链路（4 平台捕获 → 协议 media → DSH content block）+ 语音降级"
```
Expected: 全量 PASS。

---

## Task 6: 回归 + 文档收尾

**Files:**
- Modify: `README.md`
- Modify: `docs/smoke-platforms.md`

- [ ] **Step 1: README 进度段**

新增：

```markdown
- ✅ **M4：爆款特性**（/trace 轨迹摘要、/task /cron 命令面、/new 重置、delta 打字指示、图片收发、WhatsApp 原生审批按钮）
```

- [ ] **Step 2: smoke-platforms.md 追加 M4 验收点**

每平台通用追加：

```markdown
- [ ] `/help` 显示命令列表
- [ ] `/task 写一句话总结` 派生子任务并收到回执
- [ ] `/cron 0 9 * * * 每日摘要` 注册成功（gateway-core 日志显示调度已装）
- [ ] `/trace` 显示最近一轮轨迹摘要
- [ ] `/new` 重置会话
- [ ] 图片消息：发一张图，agent 有响应或明确降级提示
- [ ] （WhatsApp）审批出现原生交互按钮，点击直接生效
```

- [ ] **Step 3: 最终全量验证 + 提交**

```bash
npx vitest run
npm run build
npm run e2e
git add README.md docs/smoke-platforms.md
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "docs: M4 爆款特性验收点 + README 更新"
git log --oneline
```
Expected: 全量 PASS、E2E PASS。

---

## Self-Review 结果

- **Spec 覆盖：** 设计 §2 三大主打——轨迹（T1/T2）、多智能体（T1/T2/T3 cron+subagent+agents+new）、流式/媒体/原生按钮（T2/T4/T5）；§7 数据流（media 贯通）；M0 D4（cron 自研调度器 T3）。
- **占位符扫描：** 无 TBD/TODO；`agents` 命令的"简化回执"是明确的 M4 范围决策（真实状态上报需 DSH jobs 事件订阅，留 M5 后）；语音 ASR 明确标注"需外部 provider，M5 后"。
- **类型一致性：** `ServerEvent.trajectory.summary` 在 protocol/planOutbound/aggregator 三处同步；`Adapter.sendTyping?` 可选方法不破坏既有实现；`DshRuntime.destroyAgent?` 可选接口（Fake/真实双轨）；`bridge.resetSession` 与协议 `POST /v1/sessions/:id/reset` 对应。
- **风险暴露：** WhatsApp nativeFlowMessage 的响应形态在 Baileys 6.x 未实测，故保留编号回复兜底路径（`pendingButtons` 双轨），纯函数测试隔离风险；cron `nextRunTime` 用一年上限防死循环；媒体 vision 依赖模型多模态，降级路径明确。
