import { describe, expect, it } from 'vitest';
import { discordAttachmentUrl, discordComponents, normalizeDiscordMessage } from '../src/adapters/discord.js';

describe('normalizeDiscordMessage', () => {
  it('文本消息 → NormalizedMessage', () => {
    const raw = { channelId: '111', author: { id: '222', bot: false }, content: 'hello' };
    const out = normalizeDiscordMessage(raw);
    expect(out).toMatchObject({ chatId: '111', userId: '222', text: 'hello' });
  });
  it('bot 消息返回 null', () => {
    expect(normalizeDiscordMessage({ channelId: '1', author: { id: '2', bot: true }, content: 'x' })).toBeNull();
  });
  it('含附件 → media: { kind: "image", url }（纯函数 discordAttachmentUrl 取第一条）', () => {
    const raw = {
      channelId: '111',
      author: { id: '222', bot: false },
      content: '',
      attachments: [{ url: 'https://cdn.discordapp.com/a.png', contentType: 'image/png' }],
    };
    expect(discordAttachmentUrl(raw)).toBe('https://cdn.discordapp.com/a.png');
    expect(normalizeDiscordMessage(raw)).toMatchObject({
      chatId: '111', userId: '222', text: '', media: { kind: 'image', url: 'https://cdn.discordapp.com/a.png' },
    });
  });
});

describe('discordComponents（按钮 action row 数据）', () => {
  it('按钮 → discord components 结构', () => {
    const comps = discordComponents([
      { id: 'approve:r1', label: '✅ 同意' },
      { id: 'reject:r1', label: '🚫 拒绝' },
    ]);
    expect(comps).toEqual([{
      type: 1,
      components: [
        { type: 2, custom_id: 'approve:r1', label: '✅ 同意', style: 1 },
        { type: 2, custom_id: 'reject:r1', label: '🚫 拒绝', style: 1 },
      ],
    }]);
  });
});
