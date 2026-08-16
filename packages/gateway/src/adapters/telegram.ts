import { Bot, InlineKeyboard } from 'grammy';
import type { Adapter, NormalizedMessage, OutboundButton, OutboundPayload } from '../adapter.js';

// ── 纯函数 ────────────────────────────────────────────────────

export interface RawTelegramMessage {
  chat?: { id?: number | string };
  from?: { id?: number | string };
  message?: { text?: string };
}

export function normalizeTelegramMessage(raw: RawTelegramMessage): NormalizedMessage | null {
  const text = raw.message?.text;
  if (!text || raw.chat?.id === undefined || raw.from?.id === undefined) return null;
  return {
    chatId: String(raw.chat.id),
    userId: String(raw.from.id),
    text,
  };
}

export function buttonRows(buttons: OutboundButton[]): Array<[string, string]> {
  return buttons.map((b) => [b.label, b.id]);
}

// ── 适配器 ────────────────────────────────────────────────────

export interface TelegramAdapterOptions { token: string; }

export class TelegramAdapter implements Adapter {
  readonly id = 'telegram';
  private readonly bot: Bot;
  private messageCb?: (msg: NormalizedMessage) => void;
  private replyCb?: (buttonId: string) => void;

  constructor(opts: TelegramAdapterOptions) {
    this.bot = new Bot(opts.token);
  }

  async connect(): Promise<void> {
    await this.bot.api.getMe(); // 校验 token
    this.bot.on('message', (ctx) => {
      const msg = normalizeTelegramMessage(ctx as never);
      if (msg) this.messageCb?.(msg);
    });
    this.bot.on('callback_query:data', async (ctx) => {
      const data = ctx.callbackQuery.data;
      await ctx.answerCallbackQuery().catch(() => undefined);
      this.replyCb?.(data);
    });
    this.bot.catch((err) => console.error('[telegram]', err));
    void this.bot.start(); // 长轮询（自托管无需 webhook）
  }

  async send(chatId: string, payload: OutboundPayload): Promise<void> {
    if (payload.buttons?.length) {
      const kb = new InlineKeyboard();
      for (const [label, id] of buttonRows(payload.buttons)) kb.text(label, id);
      await this.bot.api.sendMessage(chatId, payload.text, { reply_markup: kb });
      return;
    }
    await this.bot.api.sendMessage(chatId, payload.text);
  }

  onMessage(cb: (msg: NormalizedMessage) => void): void { this.messageCb = cb; }
  onReply(cb: (buttonId: string) => void): void { this.replyCb = cb; }
}
