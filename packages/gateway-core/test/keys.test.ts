import { describe, expect, it } from 'vitest';
import { fromDshSessionId, sanitizeComponent, toDshSessionId } from '../src/keys.js';

describe('sanitizeComponent', () => {
  it('替换不安全字符，保留白名单字符', () => {
    expect(sanitizeComponent('60123456789')).toBe('60123456789');
    expect(sanitizeComponent('a/b\\c..d')).toBe('a_b_c..d');
    expect(sanitizeComponent('中文-号+')).toBe('__-_+');
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
