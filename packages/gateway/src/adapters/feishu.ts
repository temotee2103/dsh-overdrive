import { readFileSync } from 'node:fs';
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

/** 按钮 id（"approve:<reqId>" / "reject:<reqId>"）→ 卡片按钮 value。 */
export function buttonValue(button: OutboundButton): { action: string; reqId: string } {
  const idx = button.id.indexOf(':');
  return {
    action: idx >= 0 ? button.id.slice(0, idx) : button.id,
    reqId: idx >= 0 ? button.id.slice(idx + 1) : '',
  };
}

/** 交互卡片 JSON（msg_type: interactive）。原生按钮点击走 card.action.trigger 回调。 */
export function buildApprovalCard(text: string, buttons: OutboundButton[]): string {
  const actions = buttons.map((b) => ({
    tag: 'button',
    text: { tag: 'plain_text', content: b.label },
    type: b.id.startsWith('approve:') ? 'primary' : 'default',
    value: buttonValue(b),
  }));
  const card = {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: text.slice(0, 60) }, template: 'blue' },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: text } },
      { tag: 'action', actions },
    ],
  };
  return JSON.stringify(card);
}

/** 卡片回调 value → 按钮 id（"approve:<reqId>"）；缺字段返回 null。 */
export function cardActionToButtonId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const { action, reqId } = value as { action?: unknown; reqId?: unknown };
  if ((action !== 'approve' && action !== 'reject') || typeof reqId !== 'string' || !reqId) return null;
  return `${action}:${reqId}`;
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
  private replyCb?: (buttonId: string, sender: { chatId: string; userId: string }) => void;
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
          this.replyCb?.(button.id, { chatId, userId: normalized.userId });
          return;
        }
        this.messageCb?.(normalized);
      },
      // 原生交互卡片按钮回调 → 审批应答（Roadmap v0.2）
      // 载荷字段（operator.open_id / context.open_chat_id）取自官方卡片回调事件；
      // 个别版本字段名可能不同 —— 拿不到身份时上层按未授权处理（fail-closed），编号回复兜底不受影响。
      'card.action.trigger': async (data: {
        action?: { value?: unknown };
        operator?: { open_id?: string };
        context?: { open_chat_id?: string };
      }) => {
        const buttonId = cardActionToButtonId(data?.action?.value);
        if (buttonId) {
          this.replyCb?.(buttonId, {
            chatId: data?.context?.open_chat_id ?? '',
            userId: data?.operator?.open_id ?? '',
          });
        }
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
    if (payload.media) {
      // 媒体发送：上传 → 换取 image_key / file_key → 发消息；失败降级为文本路径
      try {
        const buf = readFileSync(payload.media.path);
        const messageId = this.lastMessageIds.get(chatId);
        if (payload.media.kind === 'image') {
          const uploaded = await this.client.im.image.create({
            data: { image_type: 'message', image: buf },
          });
          const content = JSON.stringify({ image_key: uploaded?.image_key ?? '' });
          if (messageId) {
            await this.client.im.message.reply({ path: { message_id: messageId }, data: { msg_type: 'image', content } });
          } else {
            await this.client.im.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: chatId, msg_type: 'image', content } });
          }
          return;
        }
        const uploaded = await this.client.im.file.create({
          data: { file_type: 'stream', file_name: payload.media.caption ?? payload.media.path.split('/').pop() ?? 'file', file: buf },
        });
        const content = JSON.stringify({ file_key: uploaded?.file_key ?? '' });
        if (messageId) {
          await this.client.im.message.reply({ path: { message_id: messageId }, data: { msg_type: 'file', content } });
        } else {
          await this.client.im.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: chatId, msg_type: 'file', content } });
        }
        return;
      } catch (error) {
        console.warn(`[feishu] 媒体上传失败，降级为文本: ${error instanceof Error ? error.message : String(error)}`);
        // 继续走文本发送（含 📎 路径）
      }
    }
    if (payload.buttons?.length) {
      this.pendingButtons.set(chatId, payload.buttons); // 卡片之外仍支持编号回复兜底
      const content = buildApprovalCard(payload.text, payload.buttons);
      const messageId = this.lastMessageIds.get(chatId);
      if (messageId) {
        await this.client.im.message.reply({
          path: { message_id: messageId },
          data: { msg_type: 'interactive', content },
        });
      } else {
        await this.client.im.message.create({
          params: { receive_id_type: 'chat_id' },
          data: { receive_id: chatId, msg_type: 'interactive', content },
        });
      }
      return;
    }
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
  onReply(cb: (buttonId: string, sender: { chatId: string; userId: string }) => void): void { this.replyCb = cb; }
  status(): { connected: boolean } { return { connected: this.connected }; }
}
