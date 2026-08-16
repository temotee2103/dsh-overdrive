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
