import { describe, expect, it } from 'vitest';
import { buttonRows, normalizeTelegramMessage } from '../src/adapters/telegram.js';

describe('normalizeTelegramMessage', () => {
  it('文本消息 → NormalizedMessage（chatId/userId 字符串化）', () => {
    const ctx = { chat: { id: 12345 }, from: { id: 678 }, message: { text: 'hello' } };
    const out = normalizeTelegramMessage(ctx as never);
    expect(out).toMatchObject({ chatId: '12345', userId: '678', text: 'hello' });
  });
  it('无文本返回 null', () => {
    expect(normalizeTelegramMessage({ chat: { id: 1 }, from: { id: 2 }, message: { photo: [] } } as never)).toBeNull();
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
