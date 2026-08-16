import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
  type AnyMessageContent,
} from '@whiskeysockets/baileys';
import * as qrcode from 'qrcode-terminal';
import pino from 'pino';
import type { Adapter, NormalizedMessage, OutboundButton, OutboundPayload } from '../adapter.js';

// ── 纯函数（可单测）────────────────────────────────────────────

export interface RawWhatsAppMessage {
  key?: { remoteJid?: string; participant?: string; fromMe?: boolean };
  message?: { conversation?: string; extendedTextMessage?: { text?: string } } & Record<string, unknown>;
  messageType?: string;
}

export function extractWhatsAppText(raw: RawWhatsAppMessage): string | null {
  const msg = raw.message;
  if (!msg) return null;
  if (typeof msg.conversation === 'string' && msg.conversation) return msg.conversation;
  if (msg.extendedTextMessage && typeof msg.extendedTextMessage.text === 'string') return msg.extendedTextMessage.text;
  return null;
}

export function normalizeWhatsAppMessage(raw: RawWhatsAppMessage):
  | { kind: 'message'; msg: NormalizedMessage }
  | null {
  if (raw.key?.fromMe) return null;
  const text = extractWhatsAppText(raw);
  if (!text) return null;
  const remoteJid = raw.key?.remoteJid;
  if (!remoteJid) return null;
  const userId = raw.key?.participant ?? remoteJid;
  return { kind: 'message', msg: { chatId: remoteJid, userId, text } };
}

export function buildNumberedReply(text: string, buttons: OutboundButton[]): string {
  const options = buttons.map((b, i) => `${i + 1}) ${b.label}`).join('\n');
  return `${text}\n\n${options}\n\n回复数字选择。`;
}

export function matchNumberedReply(text: string, buttons: OutboundButton[]): OutboundButton | undefined {
  const n = Number(text.trim());
  if (!Number.isInteger(n) || n < 1 || n > buttons.length) return undefined;
  return buttons[n - 1];
}

// ── 适配器（真实连接，薄层）────────────────────────────────────

export interface WhatsAppAdapterOptions {
  authDir: string;
}

export class WhatsAppAdapter implements Adapter {
  readonly id = 'whatsapp';
  private sock?: WASocket;
  private messageCb?: (msg: NormalizedMessage) => void;
  private replyCb?: (buttonId: string) => void;
  /** chatId → 当前 pending 按钮（编号回复 → 按钮 id） */
  private readonly pendingButtons = new Map<string, OutboundButton[]>();

  constructor(private readonly opts: WhatsAppAdapterOptions) {}

  async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.opts.authDir);
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['dsh-overdrive', 'Chrome', '120.0.0.0'],
    });
    this.sock = sock;

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
      if (update.qr) {
        qrcode.generate(update.qr, { small: true });
        console.log('[whatsapp] 请用 WhatsApp 扫上方二维码完成配对（重启应用可重新生成）');
      }
      if (update.connection === 'open') console.log('[whatsapp] 已连接 WhatsApp');
      if (update.connection === 'close') {
        const status = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        if (status === DisconnectReason.loggedOut) {
          console.error('[whatsapp] 已登出：删除 data/whatsapp 目录后重启可重新扫码');
          return;
        }
        console.warn('[whatsapp] 连接断开，3s 后重连…');
        setTimeout(() => void this.connect().catch((e) => console.error('[whatsapp] 重连失败:', e)), 3000);
      }
    });

    sock.ev.on('messages.upsert', ({ messages }) => {
      for (const raw of messages) {
        const normalized = normalizeWhatsAppMessage(raw as RawWhatsAppMessage);
        if (!normalized) continue;
        // 编号回复：若该 chat 有 pending 按钮且消息是数字，转成按钮点击
        const pending = this.pendingButtons.get(normalized.msg.chatId);
        if (pending) {
          const button = matchNumberedReply(normalized.msg.text, pending);
          if (button) {
            this.pendingButtons.delete(normalized.msg.chatId);
            this.replyCb?.(button.id);
            continue;
          }
        }
        this.messageCb?.(normalized.msg);
      }
    });
  }

  async send(chatId: string, payload: OutboundPayload): Promise<void> {
    if (!this.sock) return;
    if (payload.buttons?.length) {
      this.pendingButtons.set(chatId, payload.buttons);
      const text = buildNumberedReply(payload.text, payload.buttons);
      await this.sock.sendMessage(chatId, { text } satisfies AnyMessageContent);
      return;
    }
    await this.sock.sendMessage(chatId, { text: payload.text } satisfies AnyMessageContent);
  }

  onMessage(cb: (msg: NormalizedMessage) => void): void { this.messageCb = cb; }
  onReply(cb: (buttonId: string) => void): void { this.replyCb = cb; }
}
