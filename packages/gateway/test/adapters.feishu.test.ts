import { describe, expect, it } from 'vitest';
import { buildNumberedText, parseFeishuTextMessage } from '../src/adapters/feishu.js';

describe('parseFeishuTextMessage（im.message.receive_v1 载荷 → NormalizedMessage）', () => {
  it('文本私聊消息', () => {
    const data = {
      event: {
        message: { message_id: 'om_1', chat_id: 'oc_1', message_type: 'text', content: JSON.stringify({ text: 'hello' }) },
        sender: { sender_id: { open_id: 'ou_1' } },
      },
    };
    const out = parseFeishuTextMessage(data);
    expect(out).toMatchObject({ chatId: 'oc_1', userId: 'ou_1', text: 'hello' });
  });
  it('非文本消息返回 null', () => {
    const data = { event: { message: { message_type: 'image', content: '{}' }, sender: { sender_id: { open_id: 'ou_1' } } } };
    expect(parseFeishuTextMessage(data)).toBeNull();
  });
});

describe('buildNumberedText（审批编号回复）', () => {
  it('生成 1/2 选项文本', () => {
    const text = buildNumberedText('需要批准', [
      { id: 'approve:r1', label: '✅ 同意' },
      { id: 'reject:r1', label: '🚫 拒绝' },
    ]);
    expect(text).toContain('1) ✅ 同意');
    expect(text).toContain('2) 🚫 拒绝');
  });
});
