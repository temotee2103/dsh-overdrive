import { describe, expect, it } from 'vitest';
import { DeltaTracker, planOutbound, wireAdapter } from '../src/index.js';
import { HELP_TEXT } from '../src/commands.js';
import { GatewayClient, type ServerEvent } from '@dsh-overdrive/sdk';
import type { Adapter, NormalizedMessage, OutboundPayload } from '../src/adapter.js';

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

  it('complete 后同会话下一个 turn 的 delta 可再次触发 typing', () => {
    const t = new DeltaTracker();
    const typings: string[] = [];
    t.onDelta('s1', () => typings.push('s1'));
    t.onComplete('s1');
    t.onDelta('s1', () => typings.push('s1'));
    expect(typings).toEqual(['s1', 's1']);
  });
});

describe('planOutbound（trajectory.summary 摘要卡片渲染）', () => {
  it('trajectory.summary → formatTrajectorySummary 文本', () => {
    const ev: ServerEvent = {
      type: 'trajectory.summary', sessionId: 'cli:cli:local', ts: 1,
      steps: [{ kind: 'thought', label: '分析' }, { kind: 'tool', label: 'bash' }],
    };
    const out = planOutbound(ev)!;
    expect(out.payload.text).toContain('📋 轨迹（2 步）');
    expect(out.payload.text).toContain('🧠 分析');
    expect(out.payload.text).toContain('🛠️ bash');
  });
});

/** 可编程 FakeAdapter（带 sendTyping 探测）。 */
class FakeAdapter implements Adapter {
  readonly id: string;
  readonly sent: Array<{ chatId: string; payload: OutboundPayload }> = [];
  readonly typings: string[] = [];
  private messageCb?: (msg: NormalizedMessage) => Promise<void> | void;
  private replyCb?: (buttonId: string) => Promise<void> | void;
  constructor(id: string) { this.id = id; }
  async connect(): Promise<void> {}
  async send(chatId: string, payload: OutboundPayload): Promise<void> { this.sent.push({ chatId, payload }); }
  async sendTyping(chatId: string): Promise<void> { this.typings.push(chatId); }
  onMessage(cb: (msg: NormalizedMessage) => void): void { this.messageCb = cb; }
  onReply(cb: (buttonId: string) => void): void { this.replyCb = cb; }
  emit(msg: NormalizedMessage): Promise<void> | void { return this.messageCb?.(msg); }
}

/** 假 DSH 客户端：可编程事件推流 + 记录调用。 */
function fakeClient() {
  const createTasks: Array<{ sessionId: string; kind: string; prompt: string; schedule?: string }> = [];
  const resets: string[] = [];
  let eventCb: ((ev: ServerEvent) => void) | undefined;
  const client = {
    upsertSession: async (req: { platform: string; channel: string; user: string }) =>
      ({ sessionId: `${req.platform}:${req.channel}:${req.user}` }),
    sendMessage: async () => ({ runId: 'r1' }),
    resolveApproval: async () => ({ ok: true }),
    createTask: async (req: { sessionId: string; kind: 'subagent' | 'cron'; prompt: string; schedule?: string }) => {
      createTasks.push(req);
      return { taskId: 't1' };
    },
    resetSession: async (sessionId: string) => { resets.push(sessionId); return { ok: true }; },
    connect: async (cb: (ev: ServerEvent) => void) => { eventCb = cb; return () => undefined; },
  };
  const push = (ev: ServerEvent): void => eventCb?.(ev);
  return { client, createTasks, resets, push } as unknown as {
    client: GatewayClient; createTasks: typeof createTasks; resets: string[];
    push: (ev: ServerEvent) => void;
  };
}

describe('wireAdapter（命令分发 + delta 打字指示 + 轨迹聚合接线）', () => {
  it('message.delta → sendTyping 一次；complete 后下一 turn 再触发', async () => {
    const adapter = new FakeAdapter('cli');
    const { client, push } = fakeClient();
    await wireAdapter(adapter, client, { allowlist: [], allowAll: true });

    push({ type: 'message.delta', sessionId: 'cli:cli:local', ts: 1, text: '…' });
    push({ type: 'message.delta', sessionId: 'cli:cli:local', ts: 2, text: '…' });
    expect(adapter.typings).toEqual(['cli']); // sendTyping 目标是 chatId（无消息时回退到 channel）
    expect(adapter.sent).toHaveLength(0); // delta 不产出文本

    push({ type: 'message.complete', sessionId: 'cli:cli:local', ts: 3, text: '结果' });
    push({ type: 'message.delta', sessionId: 'cli:cli:local', ts: 4, text: '…' });
    expect(adapter.typings).toEqual(['cli', 'cli']);
  });

  it('trajectory.step 不实时输出，idle 时以 trajectory.summary 摘要输出', async () => {
    const adapter = new FakeAdapter('cli');
    const { client, push } = fakeClient();
    await wireAdapter(adapter, client, { allowlist: [], allowAll: true });

    push({ type: 'agent.status', sessionId: 'cli:cli:local', ts: 1, status: 'busy' });
    push({ type: 'trajectory.step', sessionId: 'cli:cli:local', ts: 2, step: { kind: 'thought', label: '分析' } });
    push({ type: 'trajectory.step', sessionId: 'cli:cli:local', ts: 3, step: { kind: 'tool', label: 'bash' } });
    expect(adapter.sent).toHaveLength(0); // 单步不推

    push({ type: 'agent.status', sessionId: 'cli:cli:local', ts: 4, status: 'idle' });
    const summary = adapter.sent.find((s) => s.payload.text.includes('📋 轨迹'));
    expect(summary?.payload.text).toContain('🧠 分析');
    expect(summary?.payload.text).toContain('🛠️ bash');
  });

  it('/help → HELP_TEXT 原样输出', async () => {
    const adapter = new FakeAdapter('cli');
    const { client } = fakeClient();
    await wireAdapter(adapter, client, { allowlist: [], allowAll: true });
    await adapter.emit({ chatId: 'cli', userId: 'local', text: '/help' });
    expect(adapter.sent[0].payload.text).toBe(HELP_TEXT);
  });

  it('/task 派子任务并回执；/cron 注册定时任务并回执', async () => {
    const adapter = new FakeAdapter('cli');
    const { client, createTasks } = fakeClient();
    await wireAdapter(adapter, client, { allowlist: [], allowAll: true });

    await adapter.emit({ chatId: 'cli', userId: 'local', text: '/task 调研竞品' });
    expect(createTasks).toContainEqual({ sessionId: 'cli:cli:local', kind: 'subagent', prompt: '调研竞品' });
    expect(adapter.sent.at(-1)!.payload.text).toContain('🤖 子任务已派出');

    await adapter.emit({ chatId: 'cli', userId: 'local', text: '/cron 0 8 * * * 每日汇报' });
    expect(createTasks).toContainEqual({ sessionId: 'cli:cli:local', kind: 'cron', prompt: '每日汇报', schedule: '0 8 * * *' });
    expect(adapter.sent.at(-1)!.payload.text).toContain('⏰ 定时任务已注册');
  });

  it('/new 走 resetSession 端点并回执；/trace 显示最近摘要，无则提示', async () => {
    const adapter = new FakeAdapter('cli');
    const { client, resets, push } = fakeClient();
    await wireAdapter(adapter, client, { allowlist: [], allowAll: true });

    await adapter.emit({ chatId: 'cli', userId: 'local', text: '/trace' });
    expect(adapter.sent.at(-1)!.payload.text).toContain('暂无轨迹');

    push({ type: 'agent.status', sessionId: 'cli:cli:local', ts: 1, status: 'busy' });
    push({ type: 'trajectory.step', sessionId: 'cli:cli:local', ts: 2, step: { kind: 'thought', label: '分析' } });
    push({ type: 'agent.status', sessionId: 'cli:cli:local', ts: 3, status: 'idle' });

    await adapter.emit({ chatId: 'cli', userId: 'local', text: '/trace' });
    expect(adapter.sent.at(-1)!.payload.text).toContain('🧠 分析');

    await adapter.emit({ chatId: 'cli', userId: 'local', text: '/new' });
    expect(resets).toEqual(['cli:cli:local']);
    expect(adapter.sent.at(-1)!.payload.text).toContain('🆕 会话已重置');
  });

  it('/agents 返回简化回执', async () => {
    const adapter = new FakeAdapter('cli');
    const { client } = fakeClient();
    await wireAdapter(adapter, client, { allowlist: [], allowAll: true });
    await adapter.emit({ chatId: 'cli', userId: 'local', text: '/agents' });
    expect(adapter.sent[0].payload.text).toContain('/task 派发');
  });
});
