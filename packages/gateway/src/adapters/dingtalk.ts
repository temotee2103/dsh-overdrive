import type { Adapter, NormalizedMessage, OutboundButton, OutboundPayload } from '../adapter.js';
import { PendingButtons } from '../pending-buttons.js';
import { DWClient, TOPIC_ROBOT, type RobotMessage } from 'dingtalk-stream-sdk-nodejs';

// dingtalk-stream-sdk-nodejs@2.0.4 实测：exports 提供 DWClient + TOPIC_ROBOT
// （/v1.0/im/bot/messages/get）；回调 registerCallbackListener(TOPIC_ROBOT, (msg) => …)，
// msg.data 是 RobotMessage 的 JSON 字符串；回复直接 POST 消息内的 sessionWebhook（无需 access_token）。

// ── 纯函数 ────────────────────────────────────────────────────

export interface ParsedRobotMessage {
  chatId: string;
  userId: string;
  text: string;
  sessionWebhook: string;
}

export function parseBotMessage(data: RobotMessage): ParsedRobotMessage | null {
  if (data.msgtype !== 'text' || !data.text?.content) return null;
  if (!data.conversationId || !data.senderStaffId || !data.sessionWebhook) return null;
  return {
    chatId: data.conversationId,
    userId: data.senderStaffId,
    text: data.text.content,
    sessionWebhook: data.sessionWebhook,
  };
}

export function buildReplyBody(text: string): { msgtype: 'text'; text: { content: string } } {
  return { msgtype: 'text', text: { content: text } };
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

export interface DingTalkAdapterOptions {
  clientId: string;
  clientSecret: string;
}

export class DingTalkAdapter implements Adapter {
  readonly id = 'dingtalk';
  private client?: DWClient;
  private connected = false;
  private messageCb?: (msg: NormalizedMessage) => void;
  private replyCb?: (buttonId: string) => void;
  private readonly pendingButtons = new PendingButtons();
  /** conversationId → 最近的 sessionWebhook（回复通道，过期由钉钉侧管理） */
  private readonly webhooks = new Map<string, string>();

  constructor(private readonly opts: DingTalkAdapterOptions) {}

  async connect(): Promise<void> {
    const client = new DWClient({ clientId: this.opts.clientId, clientSecret: this.opts.clientSecret });
    this.client = client;
    client.registerCallbackListener(TOPIC_ROBOT, (msg) => {
      let data: RobotMessage;
      try {
        data = JSON.parse(msg.data) as RobotMessage;
      } catch {
        return;
      }
      const parsed = parseBotMessage(data);
      if (!parsed) return;
      this.webhooks.set(parsed.chatId, parsed.sessionWebhook);
      const button = this.pendingButtons.match(parsed.chatId, parsed.text);
      if (button) {
        this.replyCb?.(button.id);
        return;
      }
      this.messageCb?.({ chatId: parsed.chatId, userId: parsed.userId, text: parsed.text });
    });
    await client.connect();
    this.connected = true;
    console.log('[dingtalk] 钉钉 Stream 已连接');
  }

  async send(chatId: string, payload: OutboundPayload): Promise<void> {
    const webhook = this.webhooks.get(chatId);
    if (!webhook) throw new Error(`钉钉会话 ${chatId} 无可用 sessionWebhook（先让用户发一条消息）`);
    if (payload.buttons?.length) this.pendingButtons.set(chatId, payload.buttons);
    const text = buildNumberedText(payload.text, payload.buttons ?? []);
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildReplyBody(text)),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`钉钉回发失败 ${res.status}: ${body.slice(0, 200)}`);
    }
  }

  onMessage(cb: (msg: NormalizedMessage) => void): void { this.messageCb = cb; }
  onReply(cb: (buttonId: string) => void): void { this.replyCb = cb; }
  status(): { connected: boolean } { return { connected: this.connected }; }
}
