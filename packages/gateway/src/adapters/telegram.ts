import { Bot, InlineKeyboard } from 'grammy';
import type { Adapter, NormalizedMessage, OutboundButton, OutboundPayload } from '../adapter.js';

// ── 纯函数 ────────────────────────────────────────────────────

export interface RawTelegramMessage {
  chat?: { id?: number | string };
  from?: { id?: number | string };
  message?: {
    text?: string;
    caption?: string;
    photo?: Array<{ file_id?: string }>;
    voice?: { file_id?: string };
    audio?: { file_id?: string };
    video?: { file_id?: string };
    document?: { file_id?: string };
  };
}

/** 纯函数：取 photo 数组最后一张（最大尺寸）的 file_id；无图返回 undefined。 */
export function telegramPhotoFileId(photo: Array<{ file_id?: string }>): string | undefined {
  return photo[photo.length - 1]?.file_id;
}

/** 纯函数：Telegram 文件下载 URL 模板。file_path 需 getFile(file_id) 换取（真实调用在 adapter 薄层）。 */
export function telegramImageUrl(token: string, filePath: string): string {
  return `https://api.telegram.org/file/bot${token}/${filePath}`;
}

export function normalizeTelegramMessage(raw: RawTelegramMessage): NormalizedMessage | null {
  if (raw.chat?.id === undefined || raw.from?.id === undefined) return null;
  const msg = raw.message;
  if (!msg) return null;
  const text = msg.text ?? msg.caption ?? '';
  let media: NormalizedMessage['media'];
  if (msg.photo?.length) media = { kind: 'image' }; // url 由 adapter getFile 薄层填充
  else if (msg.voice || msg.audio) media = { kind: 'voice' };
  else if (msg.video) media = { kind: 'video' };
  else if (msg.document) media = { kind: 'file' };
  if (!text && !media) return null;
  const out: NormalizedMessage = { chatId: String(raw.chat.id), userId: String(raw.from.id), text };
  if (media) out.media = media;
  return out;
}

export function buttonRows(buttons: OutboundButton[]): Array<[string, string]> {
  return buttons.map((b) => [b.label, b.id]);
}

// ── 适配器 ────────────────────────────────────────────────────

export interface TelegramAdapterOptions { token: string; }

export class TelegramAdapter implements Adapter {
  readonly id = 'telegram';
  private readonly bot: Bot;
  private readonly token: string;
  private connected = false;
  private messageCb?: (msg: NormalizedMessage) => void;
  private replyCb?: (buttonId: string) => void;

  constructor(opts: TelegramAdapterOptions) {
    this.token = opts.token;
    this.bot = new Bot(opts.token);
  }

  async connect(): Promise<void> {
    await this.bot.api.getMe(); // 校验 token
    this.connected = true;
    this.bot.on('message', (ctx) => {
      void this.handleMessage(ctx as never);
    });
    this.bot.on('callback_query:data', async (ctx) => {
      const data = ctx.callbackQuery.data;
      await ctx.answerCallbackQuery().catch(() => undefined);
      this.replyCb?.(data);
    });
    this.bot.catch((err) => console.error('[telegram]', err));
    void this.bot.start(); // 长轮询（自托管无需 webhook）
  }

  /** 薄层：photo → getFile(file_id) 换 file_path → 下载 URL 填充 msg.media.url（纯函数只做模板）。 */
  private async handleMessage(raw: RawTelegramMessage): Promise<void> {
    const msg = normalizeTelegramMessage(raw);
    if (!msg) return;
    const fileId = msg.media?.kind === 'image' ? telegramPhotoFileId(raw.message?.photo ?? []) : undefined;
    if (fileId) {
      try {
        const file = await this.bot.api.getFile(fileId);
        if (file.file_path) msg.media!.url = telegramImageUrl(this.token, file.file_path);
      } catch (error) {
        console.error('[telegram] getFile 失败:', error);
      }
    }
    this.messageCb?.(msg);
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
  status(): { connected: boolean } { return { connected: this.connected }; }
}
