import { describe, expect, it } from 'vitest';
import { sessionKey, parseSessionKey, encodeEvent, decodeEvent, type ServerEvent } from '../src/protocol.js';

describe('sessionKey', () => {
  it('拼装与解析往返一致', () => {
    const key = sessionKey('whatsapp', '60123456789', '60123456789');
    expect(key).toBe('whatsapp:60123456789:60123456789');
    expect(parseSessionKey(key)).toEqual({ platform: 'whatsapp', channel: '60123456789', user: '60123456789' });
  });

  it('缺字段的会话键抛错', () => {
    expect(() => parseSessionKey('only-one')).toThrow(/invalid session key/);
  });
});

describe('event codec', () => {
  it('encode/decode 往返一致', () => {
    const ev: ServerEvent = { type: 'trajectory.step', sessionId: 'cli:cli:local', ts: 1, step: { kind: 'tool', label: 'echo' } };
    expect(decodeEvent(encodeEvent(ev))).toEqual(ev);
  });

  it('非法 payload 抛错', () => {
    expect(() => decodeEvent('{"foo":1}')).toThrow(/invalid event/);
  });
});
