import { describe, expect, it } from 'vitest';
import {
  buildApprovalCard, buildNumberedText, cardActionToButtonId, parseFeishuTextMessage,
} from '../src/adapters/feishu.js';

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

describe('buildApprovalCard（飞书原生交互卡片）', () => {
  it('生成 interactive 卡片 JSON：header + 文本 + action 按钮', () => {
    const content = buildApprovalCard('需要批准：执行危险操作', [
      { id: 'approve:r1', label: '✅ 同意' },
      { id: 'reject:r1', label: '🚫 拒绝' },
    ]);
    const card = JSON.parse(content);
    expect(card.config.wide_screen_mode).toBe(true);
    expect(card.header.title.content).toContain('需要批准');
    const actions = card.elements.find((e: { tag: string }) => e.tag === 'action').actions;
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({
      tag: 'button',
      type: 'primary', // approve 主按钮
      value: { action: 'approve', reqId: 'r1' },
    });
    expect(actions[1].value).toEqual({ action: 'reject', reqId: 'r1' });
  });
});

describe('cardActionToButtonId（卡片回调 → 按钮 id）', () => {
  it('approve/reject 值还原为按钮 id', () => {
    expect(cardActionToButtonId({ action: 'approve', reqId: 'r1' })).toBe('approve:r1');
    expect(cardActionToButtonId({ action: 'reject', reqId: 'r9' })).toBe('reject:r9');
  });
  it('非法值返回 null', () => {
    expect(cardActionToButtonId(null)).toBeNull();
    expect(cardActionToButtonId({})).toBeNull();
    expect(cardActionToButtonId({ action: 'other', reqId: 'r1' })).toBeNull();
    expect(cardActionToButtonId({ action: 'approve' })).toBeNull();
    expect(cardActionToButtonId('str')).toBeNull();
  });
});
