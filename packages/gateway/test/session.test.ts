import { describe, expect, it } from 'vitest';
import { Allowlist, buildSessionKey } from '../src/session.js';

describe('buildSessionKey', () => {
  it('用 adapterId + chatId + userId 拼会话键', () => {
    expect(buildSessionKey('whatsapp', { chatId: '60123', userId: '60123' })).toBe('whatsapp:60123:60123');
  });
});

describe('Allowlist', () => {
  it('空列表放行所有（开发模式）', () => {
    const allow = new Allowlist([]);
    expect(allow.allows('anything:any:any')).toBe(true);
  });

  it('非空列表只放行白名单条目', () => {
    const allow = new Allowlist(['whatsapp:60123:60123']);
    expect(allow.allows('whatsapp:60123:60123')).toBe(true);
    expect(allow.allows('whatsapp:99999:99999')).toBe(false);
  });
});
