import { describe, expect, it, vi } from 'vitest';
import { PendingButtons, PENDING_BUTTONS_TTL_MS } from '../src/pending-buttons.js';

describe('PendingButtons', () => {
  it('数字回复命中并消费', () => {
    const pb = new PendingButtons();
    pb.set('chat-1', [
      { id: 'approve:1', label: '同意' },
      { id: 'reject:1', label: '拒绝' },
    ]);
    expect(pb.match('chat-1', '2')).toEqual({ id: 'reject:1', label: '拒绝' });
    expect(pb.match('chat-1', '1')).toBeUndefined(); // 已消费
  });

  it('非数字 / 越界不消费，按钮仍有效', () => {
    const pb = new PendingButtons();
    pb.set('chat-1', [{ id: 'a', label: '同意' }]);
    expect(pb.match('chat-1', 'hello')).toBeUndefined();
    expect(pb.match('chat-1', '5')).toBeUndefined();
    expect(pb.match('chat-1', '1')).toEqual({ id: 'a', label: '同意' });
  });

  it('过期后自动失效（不吞后续数字消息）', () => {
    vi.useFakeTimers();
    try {
      const pb = new PendingButtons(1000);
      pb.set('chat-1', [{ id: 'a', label: '同意' }]);
      vi.advanceTimersByTime(1001);
      expect(pb.match('chat-1', '1')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('TTL 内不失效', () => {
    vi.useFakeTimers();
    try {
      const pb = new PendingButtons(PENDING_BUTTONS_TTL_MS);
      pb.set('chat-1', [{ id: 'a', label: '同意' }]);
      vi.advanceTimersByTime(PENDING_BUTTONS_TTL_MS - 1);
      expect(pb.match('chat-1', '1')).toEqual({ id: 'a', label: '同意' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('consume 删除 pending（原生按钮点击）', () => {
    const pb = new PendingButtons();
    pb.set('chat-1', [{ id: 'a', label: '同意' }]);
    pb.consume('chat-1');
    expect(pb.match('chat-1', '1')).toBeUndefined();
  });

  it('不同 chat 互不影响', () => {
    const pb = new PendingButtons();
    pb.set('chat-1', [{ id: 'a', label: '同意' }]);
    pb.set('chat-2', [{ id: 'b', label: '拒绝' }]);
    expect(pb.match('chat-2', '1')).toEqual({ id: 'b', label: '拒绝' });
    expect(pb.match('chat-1', '1')).toEqual({ id: 'a', label: '同意' });
  });
});
