import { describe, expect, it } from 'vitest';
import {
  buildNativeFlowButtons,
  buildNumberedReply,
  matchNumberedReply,
  normalizeWhatsAppMessage,
  parseNativeButtonResponse,
  whatsappImageUrl,
  type RawWhatsAppMessage,
} from '../src/adapters/whatsapp.js';

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

describe('whatsappImageUrl / 媒体消息捕获', () => {
  it('imageMessage url + caption → media: { kind: "image", url }；无 url 退 directPath', () => {
    const raw = {
      key: { remoteJid: '60123@s.whatsapp.net' },
      message: { imageMessage: { url: 'https://mmg.whatsapp.net/f/x.jpg', caption: '看图' } },
      messageType: 'imageMessage',
    };
    expect(whatsappImageUrl(raw)).toBe('https://mmg.whatsapp.net/f/x.jpg');
    expect(normalizeWhatsAppMessage(raw)).toMatchObject({
      kind: 'message',
      msg: {
        chatId: '60123@s.whatsapp.net',
        userId: '60123@s.whatsapp.net',
        text: '看图',
        media: { kind: 'image', url: 'https://mmg.whatsapp.net/f/x.jpg' },
      },
    });
    // directPath 兜底（M4 简化：URL 直接透传，认证头后续再补）
    expect(whatsappImageUrl({ message: { imageMessage: { directPath: '/d/p.jpg' } } })).toBe('/d/p.jpg');
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

describe('buildNativeFlowButtons（WhatsApp 原生交互按钮）', () => {
  it('按钮 → nativeFlowMessage buttons 数组', () => {
    const buttons = buildNativeFlowButtons([
      { id: 'approve:r1', label: '✅ 同意' },
      { id: 'reject:r1', label: '🚫 拒绝' },
    ]);
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toMatchObject({
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({ id: 'approve:r1', display_text: '✅ 同意' }),
    });
    expect(buttons[1]).toMatchObject({
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({ id: 'reject:r1', display_text: '🚫 拒绝' }),
    });
  });

  it('空数组 → 空 buttons', () => {
    expect(buildNativeFlowButtons([])).toEqual([]);
  });
});

describe('parseNativeButtonResponse（交互按钮响应解析）', () => {
  it('解析 paramsJson 中的 id', () => {
    const raw: RawWhatsAppMessage = {
      key: { remoteJid: '60123@s.whatsapp.net' },
      message: {
        interactiveResponseMessage: {
          nativeFlowResponseMessage: { paramsJson: JSON.stringify({ id: 'approve:r1' }) },
        },
      },
      messageType: 'interactiveResponseMessage',
    };
    expect(parseNativeButtonResponse(raw)).toBe('approve:r1');
  });

  it('无交互响应 / 非法 JSON / 缺 id 均返回 null', () => {
    expect(parseNativeButtonResponse({ key: { remoteJid: 'x' }, message: { conversation: 'hi' } })).toBeNull();
    expect(parseNativeButtonResponse({ key: { remoteJid: 'x' }, message: {} })).toBeNull();
    expect(parseNativeButtonResponse({ key: { remoteJid: 'x' } })).toBeNull();
    expect(
      parseNativeButtonResponse({
        key: { remoteJid: 'x' },
        message: { interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: 'not-json' } } },
      }),
    ).toBeNull();
    expect(
      parseNativeButtonResponse({
        key: { remoteJid: 'x' },
        message: { interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: JSON.stringify({ foo: 'bar' }) } } },
      }),
    ).toBeNull();
  });
});
