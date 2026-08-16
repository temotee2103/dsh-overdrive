import { describe, expect, it } from 'vitest';
import { buildNumberedReply, matchNumberedReply, normalizeWhatsAppMessage } from '../src/adapters/whatsapp.js';

describe('normalizeWhatsAppMessage', () => {
  it('文本消息 → NormalizedMessage（chatId=JID, userId=发送者）', () => {
    const raw = {
      key: { remoteJid: '60123@s.whatsapp.net', participant: undefined },
      message: { conversation: 'hello' },
      messageType: 'conversation',
    };
    const out = normalizeWhatsAppMessage(raw);
    expect(out?.kind).toBe('message');
    expect(out?.msg).toMatchObject({ chatId: '60123@s.whatsapp.net', userId: '60123@s.whatsapp.net', text: 'hello' });
  });

  it('群聊用 participant 作 userId', () => {
    const raw = {
      key: { remoteJid: 'group@g.us', participant: '60123@s.whatsapp.net' },
      message: { extendedTextMessage: { text: 'hi' } },
      messageType: 'extendedTextMessage',
    };
    const out = normalizeWhatsAppMessage(raw);
    expect(out?.msg.userId).toBe('60123@s.whatsapp.net');
    expect(out?.msg.chatId).toBe('group@g.us');
  });

  it('非文本消息返回 null', () => {
    expect(normalizeWhatsAppMessage({ key: { remoteJid: 'x' }, message: { imageMessage: {} } })).toBeNull();
    expect(normalizeWhatsAppMessage({ key: { remoteJid: 'x' }, message: {} })).toBeNull();
  });
});

describe('buildNumberedReply / matchNumberedReply（审批按钮的编号文本方案）', () => {
  it('生成 1/2 编号选项', () => {
    const text = buildNumberedReply('⚠️ 需要批准：删除文件', [
      { id: 'approve:r1', label: '✅ 同意' },
      { id: 'reject:r1', label: '🚫 拒绝' },
    ]);
    expect(text).toContain('1) ✅ 同意');
    expect(text).toContain('2) 🚫 拒绝');
  });

  it('回复数字能匹配回按钮 id', () => {
    const buttons = [
      { id: 'approve:r1', label: '✅ 同意' },
      { id: 'reject:r1', label: '🚫 拒绝' },
    ];
    expect(matchNumberedReply('1', buttons)?.id).toBe('approve:r1');
    expect(matchNumberedReply('2', buttons)?.id).toBe('reject:r1');
    expect(matchNumberedReply('9', buttons)).toBeUndefined();
    expect(matchNumberedReply('同意', buttons)).toBeUndefined();
  });
});
