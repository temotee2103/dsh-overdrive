import { afterEach, describe, expect, it } from 'vitest';
import { createNativeBridge, deriveNativeOutbound, type NativeDriver } from '../src/native.js';
import type { DshSessionEvent } from '../src/derive.js';

type Cb = (...args: unknown[]) => unknown;

interface CreateRecord {
  sessionId: string;
  followups: unknown[];
}

function fakeCtx() {
  const handlers = new Map<string, Cb[]>();
  const disposers: Array<() => unknown> = [];
  const creates: CreateRecord[] = [];
  const ctx = {
    agents: {
      create: async (opts: Record<string, unknown>) => {
        const rec: CreateRecord = { sessionId: String(opts.sessionId), followups: [] };
        creates.push(rec);
        return {
          agent: {
            followup: (m: unknown) => rec.followups.push(m),
            inject: () => {},
          },
          dispose: async () => {},
          opts,
        };
      },
      resume: async () => { throw new Error('not persisted'); },
    },
    on: (ev: string, cb: Cb) => {
      if (!handlers.has(ev)) handlers.set(ev, []);
      handlers.get(ev)!.push(cb);
    },
    subagents: { start: async () => ({}) },
    effect(cb: () => unknown) {
      const out = cb();
      if (typeof out === 'function') disposers.push(out);
    },
  } as Parameters<typeof createNativeBridge>[0];
  function emit(ev: string, ...args: unknown[]) {
    for (const cb of handlers.get(ev) ?? []) cb(...args);
  }
  return { ctx, creates, disposers, emit };
}

function fakeDriver(): NativeDriver & { sent: Array<{ to: { channel: string; user: string }; o: unknown }> } {
  const d = {
    platform: 'cli',
    sent: [] as Array<{ to: { channel: string; user: string }; o: unknown }>,
    async send(to: { channel: string; user: string }, o: unknown) {
      d.sent.push({ to, o });
    },
  };
  return d;
}

function sessionEvent(type: string, data: Record<string, unknown> = {}): DshSessionEvent {
  return { type, data };
}

/** 提取 createUserMessage 产物的首个 text block。 */
function firstText(msg: unknown): string {
  const content = (msg as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
  const block = content.find((b) => b.type === 'text');
  return block?.text ?? '';
}

describe('进程内原生桥接（P0）', () => {
  let disposers: Array<() => unknown> = [];
  afterEach(() => { for (const d of disposers.splice(0).reverse()) d(); });

  it('入站消息唤醒 agent：会话 id=dsh:cli:<channel>:<user>，followup 收到文本', async () => {
    const { ctx, creates, disposers: ds } = fakeCtx();
    disposers = ds;
    const driver = fakeDriver();
    const bridge = createNativeBridge(ctx, { driver });

    await bridge.handleUserMessage({ channel: 'local', user: 'u1' }, '你好 DSH');

    expect(creates).toHaveLength(1);
    expect(creates[0].sessionId).toBe('dsh:cli:local:u1');
    expect(creates[0].followups).toHaveLength(1);
    expect(firstText(creates[0].followups[0])).toBe('你好 DSH');
  });

  it('同一会话第二次消息复用已建 agent（不重复 create）', async () => {
    const { ctx, creates, disposers: ds } = fakeCtx();
    disposers = ds;
    const driver = fakeDriver();
    const bridge = createNativeBridge(ctx, { driver });

    await bridge.handleUserMessage({ channel: 'local', user: 'u1' }, 'one');
    await bridge.handleUserMessage({ channel: 'local', user: 'u1' }, 'two');

    expect(creates).toHaveLength(1);
    expect(creates[0].followups.map((m) => firstText(m))).toEqual(['one', 'two']);
  });

  it('出站映射：DSH session 事件 → driver.send 载荷序列', async () => {
    const { ctx, disposers: ds, emit } = fakeCtx();
    disposers = ds;
    const driver = fakeDriver();
    void createNativeBridge(ctx, { driver });

    const sid = 'dsh:cli:local:u1';
    emit('session/event', { header: { id: sid } }, sessionEvent('turn/start'));
    emit('session/event', { header: { id: sid } }, sessionEvent('assistant/chunk', { chunk: { type: 'text-delta', text: '你' } }));
    emit('session/event', { header: { id: sid } }, sessionEvent('assistant/chunk', { chunk: { type: 'text-delta', text: '好' } }));
    emit('session/event', { header: { id: sid } }, sessionEvent('tool/call', { name: 'read_file' }));
    emit('session/event', { header: { id: sid } }, sessionEvent('assistant/message', {
      message: { content: [{ type: 'text', text: '完成！' }] },
    }));
    emit('session/event', { header: { id: sid } }, sessionEvent('turn/end'));

    expect(driver.sent.map((s) => s.o)).toEqual([
      { kind: 'status', status: 'busy' },
      { kind: 'delta', text: '你' },
      { kind: 'delta', text: '好' },
      { kind: 'trajectory', step: { kind: 'tool', label: 'read_file' } },
      { kind: 'complete', text: '完成！' },
      { kind: 'status', status: 'idle' },
    ]);
    expect(driver.sent.every((s) => s.to.channel === 'local' && s.to.user === 'u1')).toBe(true);
  });

  it('非网关前缀的会话（如 web 会话）不路由到 driver', async () => {
    const { ctx, disposers: ds, emit } = fakeCtx();
    disposers = ds;
    const driver = fakeDriver();
    void createNativeBridge(ctx, { driver });

    emit('session/event', { header: { id: 'web:abc:def' } }, sessionEvent('assistant/message', {
      message: { content: [{ type: 'text', text: 'ignored' }] },
    }));
    expect(driver.sent).toEqual([]);
  });

  it('deriveNativeOutbound 未知事件返回空', () => {
    expect(deriveNativeOutbound(sessionEvent('some/unknown'))).toEqual([]);
  });
});
