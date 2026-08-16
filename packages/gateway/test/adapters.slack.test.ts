import { describe, expect, it } from 'vitest';
import { normalizeSlackMessage, slackBlocks, slackFileUrl } from '../src/adapters/slack.js';

describe('normalizeSlackMessage', () => {
  it('文本消息 → NormalizedMessage', () => {
    const raw = { channel: 'C123', user: 'U456', text: 'hello', subtype: undefined };
    const out = normalizeSlackMessage(raw);
    expect(out).toMatchObject({ chatId: 'C123', userId: 'U456', text: 'hello' });
  });
  it('bot 自己的消息（subtype=bot_message）返回 null', () => {
    expect(normalizeSlackMessage({ channel: 'C1', user: 'U2', text: 'x', subtype: 'bot_message' })).toBeNull();
  });
  it('含文件 → media: { kind: "image", url }（纯函数 slackFileUrl 取 files[0].url_private）', () => {
    const raw = {
      channel: 'C1',
      user: 'U2',
      text: '',
      files: [{ url_private: 'https://files.slack.com/files/x.png', mimetype: 'image/png' }],
    };
    expect(slackFileUrl(raw)).toBe('https://files.slack.com/files/x.png');
    expect(normalizeSlackMessage(raw)).toMatchObject({
      chatId: 'C1', userId: 'U2', text: '', media: { kind: 'image', url: 'https://files.slack.com/files/x.png' },
    });
  });
});

describe('slackBlocks', () => {
  it('纯文本 → 一个 section', () => {
    const blocks = slackBlocks('hi', []);
    expect(blocks).toEqual([{ type: 'section', text: { type: 'mrkdwn', text: 'hi' } }]);
  });
  it('带按钮 → section + actions', () => {
    const blocks = slackBlocks('需要批准', [
      { id: 'approve:r1', label: '✅ 同意' },
      { id: 'reject:r1', label: '🚫 拒绝' },
    ]);
    expect(blocks[1]).toMatchObject({
      type: 'actions',
      elements: [
        { type: 'button', value: 'approve:r1', text: { type: 'plain_text', text: '✅ 同意' } },
        { type: 'button', value: 'reject:r1', text: { type: 'plain_text', text: '🚫 拒绝' } },
      ],
    });
  });
});
