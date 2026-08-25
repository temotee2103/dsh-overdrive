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

  /**
   * 回复解析（对齐竞品的文字审批）：数字编号（"1"/"2"…）或关键词
   * （批准/同意/yes/ok/确认 → approve 按钮；拒绝/不同意/no/取消 → reject 按钮）。
   * 命中即消费；无 pending / 已过期 / 不匹配返回 undefined。
   */
  match(chatId: string, text: string): OutboundButton | undefined {
    const entry = this.map.get(chatId);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.map.delete(chatId);
      return undefined;
    }
    const trimmed = text.trim().toLowerCase();
    // 数字回复
    const n = Number(trimmed);
    if (Number.isInteger(n) && n >= 1 && n <= entry.buttons.length) {
      const button = entry.buttons[n - 1];
      if (button) this.map.delete(chatId);
      return button;
    }
    // 文字审批关键词（竞品 dsh-im 同款：回复「批准/拒绝」即可）
    const approveWords = ['批准', '同意', 'yes', 'ok', '确认', 'approve'];
    const rejectWords = ['拒绝', '不同意', 'no', '取消', 'reject'];
    const wantsApprove = approveWords.some((w) => trimmed === w || trimmed.startsWith(`${w} `));
    const wantsReject = rejectWords.some((w) => trimmed === w || trimmed.startsWith(`${w} `));
    if (wantsApprove || wantsReject) {
      const button = entry.buttons.find((b) =>
        wantsApprove ? b.id.startsWith('approve:') : b.id.startsWith('reject:'),
      );
      if (button) this.map.delete(chatId);
      return button;
    }
    return undefined;
  }

  /** 消费原生按钮点击（如 WhatsApp 原生交互按钮）：删除该 chat 的 pending。 */
  consume(chatId: string): void {
    this.map.delete(chatId);
  }
}
