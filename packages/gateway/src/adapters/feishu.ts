import lark from '@larksuiteoapi/node-sdk';
import type { Adapter, NormalizedMessage, OutboundButton, OutboundPayload } from '../adapter.js';
import { PendingButtons } from '../pending-buttons.js';

// @larksuiteoapi/node-sdk 是 CommonJS 包（main=lib/index.js，无 "type":"module"）：
// Node 原生 ESM 下必须 default 导入后解构（同 M2b 的 @slack/bolt 处理）。
const { Client, WSClient, EventDispatcher } = lark;

// ── 纯函数 ────────────────────────────────────────────────────

export interface FeishuReceivePayload {
  event?: {
    message?: {
      message_id?: string;
      chat_id?: string;
      message_type?: string;
      content?: string;
    };
    sender?: { sender_id?: { open_id?: string } };
  };
}

export function parseFeishuTextMessage(payload: FeishuReceivePayload): NormalizedMessage | null {
  const message = payload.event?.message;
  const sender = payload.event?.sender?.sender_id?.open_id;
  if (!message?.chat_id || !sender) return null;
  if (message.message_type !== 'text') return null;
  let text = '';
  try {
    text = (JSON.parse(message.content ?? '{}') as { text?: string }).text ?? '';
  } catch {
    return null;
  }
  if (!text) return null;
  return { chatId: message.chat_id, userId: sender, text };
}

export function buildNumberedText(text: string, buttons: OutboundButton[]): string {
  if (buttons.length === 0) return text;
  const options = buttons.map((b, i) => `${i + 1}) ${b.label}`).join('\n');
  return `${text}\n\n${options}\n\n回复数字选择。`;
}

export function matchNumberedButton(text: string, buttons: OutboundButton[]): OutboundButton | undefined {
  const n = Number(text.trim());
  if (!Number.isInteger(n) || n < 1 || n > buttons.length) return undefined;
  return buttons[n - 1];
}

// ── 适配器 ────────────────────────────────────────────────────

export interface FeishuAdapterOptions {
  appId: string;
  appSecret: string;
}

export class FeishuAdapter implements Adapter {
  readonly id = 'feishu';
  private readonly client: InstanceType<typeof Client>;
  private ws?: InstanceType<typeof WSClient>;
  private connected = false;
  private messageCb?: (msg: NormalizedMessage) => void;
  private replyCb?: (buttonId: string) => void;
  private readonly pendingButtons = new PendingButtons();
  /** chatId → 最近一条入站消息的 message_id（send 优先 reply，缺失则 create 兜底） */
  private readonly lastMessageIds = new Map<string, string>();

  constructor(private readonly opts: FeishuAdapterOptions) {
    this.client = new Client({ appId: opts.appId, appSecret: opts.appSecret });
  }

  async connect(): Promise<void> {
    const dispatcher = new EventDispatcher({}).register({
      'im.message.receive_v1': async (data: FeishuReceivePayload) => {
        const message = data.event?.message;
        if (message?.chat_id && message.message_id) {
          this.lastMessageIds.set(message.chat_id, message.message_id);
        }
        const normalized = parseFeishuTextMessage(data);
        if (!normalized) return;
        const chatId = normalized.chatId;
        const button = this.pendingButtons.match(chatId, normalized.text);
        if (button) {
          this.replyCb?.(button.id);
          return;
        }
        this.messageCb?.(normalized);
      },
    });
    this.ws = new WSClient({
      appId: this.opts.appId,
      appSecret: this.opts.appSecret,
      loggerLevel: lark.LoggerLevel.error,
    });
    await this.ws.start({ eventDispatcher: dispatcher });
    this.connected = true;
    console.log('[feishu] 飞书长连接已建立');
  }

  async send(chatId: string, payload: OutboundPayload): Promise<void> {
    if (payload.buttons?.length) this.pendingButtons.set(chatId, payload.buttons);
    const text = buildNumberedText(payload.text, payload.buttons ?? []);
    const content = JSON.stringify({ text });
    const messageId = this.lastMessageIds.get(chatId);
    if (messageId) {
      // 有最近入站消息：im.message.reply（path=message_id）回复原消息
      await this.client.im.message.reply({
        path: { message_id: messageId },
        data: { msg_type: 'text', content },
      });
    } else {
      // 无入站消息（主动下发）：im.message.create 按 receive_id=chat_id 发送
      await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: chatId, msg_type: 'text', content },
      });
    }
  }

  onMessage(cb: (msg: NormalizedMessage) => void): void { this.messageCb = cb; }
  onReply(cb: (buttonId: string) => void): void { this.replyCb = cb; }
  status(): { connected: boolean } { return { connected: this.connected }; }
}
