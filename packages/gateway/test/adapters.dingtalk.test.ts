import { describe, expect, it } from 'vitest';
import { buildReplyBody, parseBotMessage } from '../src/adapters/dingtalk.js';

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
