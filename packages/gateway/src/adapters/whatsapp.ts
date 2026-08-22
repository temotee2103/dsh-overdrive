import { readFileSync } from 'node:fs';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  generateWAMessageFromContent,
  type WASocket,
  type AnyMessageContent,
} from '@whiskeysockets/baileys';
import * as qrcode from 'qrcode-terminal';
import pino from 'pino';
import type { Adapter, NormalizedMessage, OutboundButton, OutboundPayload } from '../adapter.js';
import { PendingButtons } from '../pending-buttons.js';

// ── 纯函数（可单测）────────────────────────────────────────────

export interface RawWhatsAppMessage {
  key?: { remoteJid?: string; participant?: string; fromMe?: boolean };
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { url?: string; directPath?: string; caption?: string; mimetype?: string };
    audioMessage?: { url?: string; directPath?: string; mimetype?: string };
    videoMessage?: { url?: string; directPath?: string; mimetype?: string; caption?: string };
    documentMessage?: { url?: string; directPath?: string; mimetype?: string; fileName?: string };
    interactiveResponseMessage?: { nativeFlowResponseMessage?: { paramsJson?: string } };
  } & Record<string, unknown>;
  messageType?: string;
}

export function extractWhatsAppText(raw: RawWhatsAppMessage): string | null {
  const msg = raw.message;
  if (!msg) return null;
  if (typeof msg.conversation === 'string' && msg.conversation) return msg.conversation;
  if (msg.extendedTextMessage && typeof msg.extendedTextMessage.text === 'string') return msg.extendedTextMessage.text;
  return null;
}

/** 纯函数：imageMessage 的下载 URL（Baileys 已解析的 url 优先，退 directPath）；无图返回 undefined。 */
export function whatsappImageUrl(raw: RawWhatsAppMessage): string | undefined {
  const img = raw.message?.imageMessage;
  return img?.url ?? img?.directPath ?? undefined;
}

function waMediaUrl(m: { url?: string; directPath?: string } | undefined): string | undefined {
  return m?.url ?? m?.directPath ?? undefined;
}

/** 媒体消息 → media 引用（kind + url）：image/voice/video/file；无 url 视为无法透传，返回 undefined。 */
function whatsappMedia(raw: RawWhatsAppMessage): NormalizedMessage['media'] {
  const msg = raw.message;
  if (!msg) return undefined;
  if (msg.imageMessage) {
    const url = whatsappImageUrl(raw);
    return url ? { kind: 'image', url } : undefined;
  }
  if (msg.audioMessage) {
    const url = waMediaUrl(msg.audioMessage);
    return url ? { kind: 'voice', url } : undefined;
  }
  if (msg.videoMessage) {
    const url = waMediaUrl(msg.videoMessage);
    return url ? { kind: 'video', url } : undefined;
  }
  if (msg.documentMessage) {
    const url = waMediaUrl(msg.documentMessage);
    return url ? { kind: 'file', url } : undefined;
  }
  return undefined;
}

export function normalizeWhatsAppMessage(raw: RawWhatsAppMessage):
  | { kind: 'message'; msg: NormalizedMessage }
  | null {
  if (raw.key?.fromMe) return null;
  const media = whatsappMedia(raw);
  const text = extractWhatsAppText(raw) ?? raw.message?.imageMessage?.caption ?? '';
  if (!text && !media) return null;
  const remoteJid = raw.key?.remoteJid;
  if (!remoteJid) return null;
  const userId = raw.key?.participant ?? remoteJid;
  const msg: NormalizedMessage = { chatId: remoteJid, userId, text };
  if (media) msg.media = media;
  return { kind: 'message', msg };
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

export interface NativeFlowButton {
  name: string;
  buttonParamsJson: string;
}

/** WhatsApp 原生交互按钮：nativeFlowMessage.buttons 数组（{ name: 'quick_reply', buttonParamsJson: JSON({id, display_text}) }）。 */
export function buildNativeFlowButtons(buttons: OutboundButton[]): NativeFlowButton[] {
  return buttons.map((b) => ({
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({ id: b.id, display_text: b.label }),
  }));
}

/** 解析原生按钮响应：interactiveResponseMessage.nativeFlowResponseMessage.paramsJson 中的 id；非交互/非法 JSON/缺 id 返回 null。 */
export function parseNativeButtonResponse(raw: RawWhatsAppMessage): string | null {
  const params = raw.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (!params) return null;
  try {
    const parsed = JSON.parse(params) as { id?: string };
    return parsed.id ?? null;
  } catch {
    return null;
  }
}

// ── 适配器（真实连接，薄层）────────────────────────────────────

export interface WhatsAppAdapterOptions {
  authDir: string;
}

export class WhatsAppAdapter implements Adapter {
  readonly id = 'whatsapp';
  private sock?: WASocket;
  private connected = false;
  private messageCb?: (msg: NormalizedMessage) => void;
  private replyCb?: (buttonId: string, sender: { chatId: string; userId: string }) => void;
  /** chatId → 当前 pending 按钮（编号回复 → 按钮 id，带 TTL 防过期误吞） */
  private readonly pendingButtons = new PendingButtons();

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
      if (update.connection === 'open') {
        this.connected = true;
        console.log('[whatsapp] 已连接 WhatsApp');
      }
      if (update.connection === 'close') {
        this.connected = false;
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
        const waRaw = raw as RawWhatsAppMessage;
        // 原生交互按钮响应：interactiveResponseMessage → 按钮 id（优先于编号回复兜底）
        const buttonId = parseNativeButtonResponse(waRaw);
        if (buttonId) {
          const chatId = waRaw.key?.remoteJid;
          if (chatId) this.pendingButtons.consume(chatId);
          this.replyCb?.(buttonId, {
            chatId: chatId ?? '',
            userId: waRaw.key?.participant ?? chatId ?? '',
          });
          continue;
        }
        const normalized = normalizeWhatsAppMessage(waRaw);
        if (!normalized) continue;
        // 编号回复兜底：若该 chat 有 pending 按钮且消息是数字（TTL 内），转成按钮点击
        const button = this.pendingButtons.match(normalized.msg.chatId, normalized.msg.text);
        if (button) {
          this.replyCb?.(button.id, {
            chatId: normalized.msg.chatId,
            userId: normalized.msg.userId,
          });
          continue;
        }
        this.messageCb?.(normalized.msg);
      }
    });
  }

  async send(chatId: string, payload: OutboundPayload): Promise<void> {
    if (!this.sock) return;
    if (payload.media) {
      const { kind, path, caption } = payload.media;
      const buf = readFileSync(path);
      if (kind === 'image') {
        await this.sock.sendMessage(chatId, { image: buf, caption: caption ?? '' } satisfies AnyMessageContent);
      } else {
        await this.sock.sendMessage(chatId, {
          document: buf,
          fileName: caption ?? path,
          mimetype: 'application/octet-stream',
        } satisfies AnyMessageContent);
      }
      return;
    }
    if (payload.buttons?.length) {
      this.pendingButtons.set(chatId, payload.buttons);
      // 原生交互按钮优先：Baileys 6.x 的 AnyMessageContent 无 interactive 键，
      // 以 proto.IMessage（interactiveMessage.nativeFlowMessage）+ relayMessage 发送。
      const userJid = this.sock.user?.id;
      if (userJid) {
        const waMsg = generateWAMessageFromContent(
          chatId,
          {
            interactiveMessage: {
              body: { text: payload.text },
              nativeFlowMessage: { buttons: buildNativeFlowButtons(payload.buttons) },
            },
          },
          { userJid },
        );
        if (waMsg.message) {
          await this.sock.relayMessage(chatId, waMsg.message, { messageId: waMsg.key.id ?? undefined });
          return;
        }
      }
      // 兜底：连接未就绪（无 userJid）或生成失败时退回编号文本方案
      const text = buildNumberedReply(payload.text, payload.buttons);
      await this.sock.sendMessage(chatId, { text } satisfies AnyMessageContent);
      return;
    }
    await this.sock.sendMessage(chatId, { text: payload.text } satisfies AnyMessageContent);
  }

  onMessage(cb: (msg: NormalizedMessage) => void): void { this.messageCb = cb; }
  onReply(cb: (buttonId: string, sender: { chatId: string; userId: string }) => void): void { this.replyCb = cb; }
  status(): { connected: boolean } { return { connected: this.connected }; }
}
