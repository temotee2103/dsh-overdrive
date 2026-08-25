import { describe, expect, it } from 'vitest';
import { isGroupChat, isMentioned, shouldRespond } from '../src/mention.js';

describe('isGroupChat', () => {
  it('telegram 负 ID 为群', () => {
    expect(isGroupChat('telegram', '-1001234567890')).toBe(true);
    expect(isGroupChat('telegram', '-12345')).toBe(true);
    expect(isGroupChat('telegram', '12345')).toBe(false);
  });
  it('whatsapp @g.us 为群', () => {
    expect(isGroupChat('whatsapp', '123@ g.us'.replace(' ', ''))).toBe(true);
    expect(isGroupChat('whatsapp', '123@s.whatsapp.net')).toBe(false);
  });
  it('slack D 开头为私聊', () => {
    expect(isGroupChat('slack', 'D123')).toBe(false);
    expect(isGroupChat('slack', 'C123')).toBe(true);
  });
  it('无法判定的平台默认视为私聊', () => {
    expect(isGroupChat('discord', 'any')).toBe(false);
    expect(isGroupChat('feishu', 'oc_1')).toBe(false);
  });
});

describe('isMentioned', () => {
  it('telegram/whatsapp @身份', () => {
    expect(isMentioned('telegram', '@mybot 你好', 'mybot')).toBe(true);
    expect(isMentioned('telegram', '你好', 'mybot')).toBe(false);
    expect(isMentioned('whatsapp', '@8613800000000 hi', '8613800000000')).toBe(true);
  });
  it('discord/slack <@ID>', () => {
    expect(isMentioned('discord', '<@123456> hello', '123456')).toBe(true);
    expect(isMentioned('slack', 'hello <@U123>', 'U123')).toBe(true);
    expect(isMentioned('discord', 'hello', '123456')).toBe(false);
  });
  it('无法检测的平台视为已提及', () => {
    expect(isMentioned('feishu', '随便', 'x')).toBe(true);
  });
});

describe('shouldRespond', () => {
  const msg = (text: string) => ({ chatId: '-100123', userId: 'u', text });
  it('未开启提及模式 → 始终响应', () => {
    expect(shouldRespond('telegram', msg('随便'), { requireMention: false, botIdentity: 'b' })).toBe(true);
  });
  it('群聊未提及 → 不响应；提及 → 响应', () => {
    const policy = { requireMention: true, botIdentity: 'mybot' };
    expect(shouldRespond('telegram', msg('你好'), policy)).toBe(false);
    expect(shouldRespond('telegram', msg('@mybot 你好'), policy)).toBe(true);
  });
  it('私聊始终响应', () => {
    const policy = { requireMention: true, botIdentity: 'mybot' };
    expect(shouldRespond('telegram', { chatId: '12345', userId: 'u', text: '你好' }, policy)).toBe(true);
  });
});
