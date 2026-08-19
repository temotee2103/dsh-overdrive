import type { OutboundButton } from './adapter.js';

export const PENDING_BUTTONS_TTL_MS = 5 * 60_000;

interface PendingButtonEntry {
  buttons: OutboundButton[];
  expiresAt: number;
}

/**
 * 编号回复兜底的按钮暂存（带 TTL）。
 *
 * 审批/危险操作按钮发出后，用户在聊天里回复数字（"1"/"2"…）选择；
 * 若按钮长期不消费，后续的普通数字消息会被误判成按钮回复。
 * 本类在 TTL（默认 5 分钟）后自动失效，杜绝"过期按钮吞消息"。
 */
export class PendingButtons {
  private readonly map = new Map<string, PendingButtonEntry>();

  constructor(private readonly ttlMs: number = PENDING_BUTTONS_TTL_MS) {}

  set(chatId: string, buttons: OutboundButton[]): void {
    this.map.set(chatId, { buttons, expiresAt: Date.now() + this.ttlMs });
  }

  /** 数字回复命中：返回匹配按钮并消费（删除）；无 pending / 已过期 / 非数字或越界返回 undefined。 */
  match(chatId: string, text: string): OutboundButton | undefined {
    const entry = this.map.get(chatId);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.map.delete(chatId);
      return undefined;
    }
    const n = Number(text.trim());
    if (!Number.isInteger(n) || n < 1 || n > entry.buttons.length) return undefined;
    const button = entry.buttons[n - 1];
    if (button) this.map.delete(chatId);
    return button;
  }

  /** 消费原生按钮点击（如 WhatsApp 原生交互按钮）：删除该 chat 的 pending。 */
  consume(chatId: string): void {
    this.map.delete(chatId);
  }
}
