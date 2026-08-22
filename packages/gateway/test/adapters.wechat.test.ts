import { describe, expect, it } from 'vitest';
import {
  buildGetUpdatesBody, buildNumberedReplyText, buildSendMessageBody, chunkText, extractWeChatText, parseWeChatUpdate,
} from '../src/adapters/wechat.js';

describe('extractWeChatText', () => {
  it('提取 text_item 文本', () => {
    expect(extractWeChatText({ from_user_id: 'u1', text_item: { text: 'hello' } })).toBe('hello');
  });
  it('提取 item_list 中 type===1 的文本', () => {
    expect(extractWeChatText({ item_list: [{ type: 2, text_item: { text: 'img' } }, { type: 1, text_item: { text: 'text' } }] })).toBe('text');
  });
  it('无文本返回 null', () => {
    expect(extractWeChatText({ from_user_id: 'u1' })).toBeNull();
  });
});

describe('parseWeChatUpdate', () => {
  it('文本消息 → NormalizedMessage（chatId=userId=from_user_id）', () => {
    expect(parseWeChatUpdate({ from_user_id: 'wx-1', context_token: 'tok', text_item: { text: 'hi' } }))
      .toEqual({ chatId: 'wx-1', userId: 'wx-1', text: 'hi' });
  });
  it('非文本或缺发送者返回 null', () => {
    expect(parseWeChatUpdate({ from_user_id: 'wx-1', text_item: { text: '' } })).toBeNull();
    expect(parseWeChatUpdate({ text_item: { text: 'x' } })).toBeNull();
  });
});

describe('buildGetUpdatesBody', () => {
  it('带同步游标与 longpolling，且必须带 base_info.channel_version', () => {
    const body = buildGetUpdatesBody('buf-1');
    expect(body.get_updates_buf).toBe('buf-1');
    expect(body.longpolling_timeout).toBe(35000);
    expect(body.base_info).toEqual({ channel_version: '1.0.2' });
  });
});

describe('buildSendMessageBody', () => {
  it('msg 包裹 + text_item，带回话 context_token', () => {
    const body = buildSendMessageBody('wx-1', '回复', 'tok-1', 'client-1');
    expect(body.base_info).toEqual({ channel_version: '1.0.2' });
    expect(body.msg).toMatchObject({
      from_user_id: '',
      to_user_id: 'wx-1',
      client_id: 'client-1',
      message_type: 2,
      message_state: 2,
      context_token: 'tok-1',
      item_list: [{ type: 1, text_item: { text: '回复' } }],
    });
  });
});

describe('chunkText', () => {
  it('长文本按上限分段', () => {
    const chunks = chunkText('a'.repeat(1700), 800);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].length).toBe(800);
    expect(chunks[2].length).toBe(100);
  });
  it('短文本单段', () => {
    expect(chunkText('hi', 800)).toEqual(['hi']);
  });
});

describe('buildNumberedReplyText', () => {
  it('生成 1/2 选项文本', () => {
    const text = buildNumberedReplyText('需要批准', [
      { id: 'approve:r1', label: '✅ 同意' },
      { id: 'reject:r1', label: '🚫 拒绝' },
    ]);
    expect(text).toContain('1) ✅ 同意');
    expect(text).toContain('回复数字选择');
  });
  it('无按钮时原样返回', () => {
    expect(buildNumberedReplyText('hi', [])).toBe('hi');
  });
});
