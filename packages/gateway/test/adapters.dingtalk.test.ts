import { describe, expect, it } from 'vitest';
import { buildActionCard, buildReplyBody, buttonCallbackData, parseBotMessage, parseCardCallback } from '../src/adapters/dingtalk.js';

describe('parseBotMessage（RobotMessage → NormalizedMessage）', () => {
  it('文本消息', () => {
    const data = {
      conversationId: 'cid1',
      senderStaffId: 'u1',
      msgtype: 'text',
      text: { content: 'hello' },
      sessionWebhook: 'https://hook.dingtalk.com/x',
    };
    const out = parseBotMessage(data);
    expect(out).toMatchObject({ chatId: 'cid1', userId: 'u1', text: 'hello' });
  });
  it('非文本返回 null', () => {
    expect(parseBotMessage({ conversationId: 'c', msgtype: 'picture' })).toBeNull();
  });
});

describe('buildReplyBody（sessionWebhook 回发载荷）', () => {
  it('文本消息体', () => {
    expect(buildReplyBody('hi')).toEqual({ msgtype: 'text', text: { content: 'hi' } });
  });
});

describe('buildActionCard（钉钉 actionCard）', () => {
  it('生成带 cardCallbackData 的按钮', () => {
    const card = buildActionCard('需要批准', [
      { id: 'approve:r1', label: '✅ 同意' },
      { id: 'reject:r1', label: '🚫 拒绝' },
    ]);
    expect(card.msgtype).toBe('actionCard');
    expect(card.actionCard.btns).toHaveLength(2);
    expect(card.actionCard.btns[0].actionURL).toContain('cardCallbackData=');
    expect(decodeURIComponent(card.actionCard.btns[0].actionURL.split('cardCallbackData=')[1])).toBe('{"action":"approve","reqId":"r1"}');
  });
});

describe('parseCardCallback（TOPIC_CARD 回调载荷 → 按钮 id + 身份）', () => {
  it('识别 cardCallbackData 字段', () => {
    expect(parseCardCallback({ cardPrivateData: { cardCallbackData: '{"action":"approve","reqId":"r1"}' } })).toMatchObject({ buttonId: 'approve:r1' });
  });
  it('识别 params / cardActionData 字段与嵌套结构', () => {
    expect(parseCardCallback({ cardPrivateData: { params: '{"action":"reject","reqId":"r9"}' } })).toMatchObject({ buttonId: 'reject:r9' });
    expect(parseCardCallback({ a: { b: { cardActionData: '{"action":"approve","reqId":"x"}' } } })).toMatchObject({ buttonId: 'approve:x' });
  });
  it('带回会话与用户身份（用于白名单校验）', () => {
    expect(parseCardCallback({
      cardPrivateData: { cardCallbackData: '{"action":"approve","reqId":"r1"}', userId: 'u1' },
      conversationId: 'cid1',
    })).toEqual({ buttonId: 'approve:r1', chatId: 'cid1', userId: 'u1' });
  });
  it('非法载荷返回 null', () => {
    expect(parseCardCallback(null)).toBeNull();
    expect(parseCardCallback({ cardPrivateData: { cardCallbackData: 'not-json' } })).toBeNull();
    expect(parseCardCallback({ cardPrivateData: { cardCallbackData: '{"action":"other","reqId":"r1"}' } })).toBeNull();
    expect(parseCardCallback({ cardPrivateData: { cardCallbackData: '{"action":"approve"}' } })).toBeNull();
  });
  it('buttonCallbackData 与 parseCardCallback 往返一致', () => {
    const data = buttonCallbackData({ id: 'reject:r7', label: 'x' });
    expect(parseCardCallback({ cardPrivateData: { cardCallbackData: data } })).toMatchObject({ buttonId: 'reject:r7' });
  });
});
