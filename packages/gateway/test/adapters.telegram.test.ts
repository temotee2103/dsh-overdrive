import { describe, expect, it } from 'vitest';
import { buttonRows, normalizeTelegramMessage, telegramImageUrl, telegramPhotoFileId } from '../src/adapters/telegram.js';

describe('normalizeTelegramMessage', () => {
  it('文本消息 → NormalizedMessage（chatId/userId 字符串化）', () => {
    const ctx = { chat: { id: 12345 }, from: { id: 678 }, message: { text: 'hello' } };
    const out = normalizeTelegramMessage(ctx as never);
    expect(out).toMatchObject({ chatId: '12345', userId: '678', text: 'hello' });
  });
  it('无文本返回 null', () => {
    expect(normalizeTelegramMessage({ chat: { id: 1 }, from: { id: 2 }, message: { photo: [] } } as never)).toBeNull();
  });
  it('含 photo 的消息 → media: { kind: "image" }，file_id → 下载 URL 模板（真实 getFile 在 adapter）', () => {
    const ctx = {
      chat: { id: 1 },
      from: { id: 2 },
      message: { photo: [{ file_id: 'small' }, { file_id: 'large' }] },
    };
    expect(normalizeTelegramMessage(ctx as never)).toMatchObject({
      chatId: '1', userId: '2', text: '', media: { kind: 'image' },
    });
    expect(telegramPhotoFileId(ctx.message.photo)).toBe('large');
    expect(telegramImageUrl('SECRET', 'photos/file_10.jpg')).toBe('https://api.telegram.org/file/botSECRET/photos/file_10.jpg');
  });
});

describe('buttonRows（InlineKeyboard 数据）', () => {
  it('按钮 → [label, id] 行', () => {
    expect(buttonRows([
      { id: 'approve:r1', label: '✅ 同意' },
      { id: 'reject:r1', label: '🚫 拒绝' },
    ])).toEqual([
      ['✅ 同意', 'approve:r1'],
      ['🚫 拒绝', 'reject:r1'],
    ]);
  });
});
