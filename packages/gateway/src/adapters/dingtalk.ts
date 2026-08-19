import type { Adapter, NormalizedMessage, OutboundButton, OutboundPayload } from '../adapter.js';
import { PendingButtons } from '../pending-buttons.js';
import { DWClient, TOPIC_CARD, TOPIC_ROBOT, type RobotMessage } from 'dingtalk-stream-sdk-nodejs';

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

/** 按钮 id（"approve:<reqId>" / "reject:<reqId>"）→ 卡片回调载荷 JSON 字符串。 */
export function buttonCallbackData(button: OutboundButton): string {
  const idx = button.id.indexOf(':');
  return JSON.stringify({
    action: idx >= 0 ? button.id.slice(0, idx) : button.id,
    reqId: idx >= 0 ? button.id.slice(idx + 1) : '',
  });
}

/** 钉钉 actionCard 消息体（Roadmap v0.2）。按钮回调经 TOPIC_CARD 走 Stream 返回。 */
export function buildActionCard(text: string, buttons: OutboundButton[]): {
  msgtype: 'actionCard';
  actionCard: { title: string; text: string; btnOrientation: string; btns: Array<{ title: string; actionURL: string }> };
} {
  return {
    msgtype: 'actionCard',
    actionCard: {
      title: '需要批准',
      text,
      btnOrientation: '1',
      btns: buttons.map((b) => ({
        title: b.label,
        actionURL: `dingtalk://dingtalkclient/action/openapp?cardCallbackData=${encodeURIComponent(buttonCallbackData(b))}`,
      })),
    },
  };
}

export interface CardCallbackResult {
  buttonId: string;
  chatId?: string;
  userId?: string;
}

/**
 * 钉钉卡片回调载荷 → { buttonId, chatId?, userId? }。
 * Stream 模式下回调 JSON 的字段名（cardCallbackData / params / cardActionData，以及会话/用户字段）
 * 在不同卡片版本有差异，这里做多路径深度兜底解析；真机验证后可按实际字段收敛。找不到返回 null。
 */
export function parseCardCallback(raw: unknown): CardCallbackResult | null {
  let buttonId: string | null = null;
  let chatId: string | undefined;
  let userId: string | undefined;

  const visit = (obj: unknown, depth: number): void => {
    if (depth > 5 || !obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (!buttonId && typeof value === 'string' && (key === 'cardCallbackData' || key === 'params' || key === 'cardActionData')) {
        try {
          const parsed = JSON.parse(value) as { action?: string; reqId?: string };
          if ((parsed.action === 'approve' || parsed.action === 'reject') && typeof parsed.reqId === 'string' && parsed.reqId) {
            buttonId = `${parsed.action}:${parsed.reqId}`;
          }
        } catch {
          /* 该字段不是 JSON 载荷，继续往下找 */
        }
      }
      if (!chatId && typeof value === 'string' && (key === 'conversationId' || key === 'conversation_id') && value) {
        chatId = value;
      }
      if (!userId && typeof value === 'string' && (key === 'senderStaffId' || key === 'senderId' || key === 'userid' || key === 'userId') && value) {
        userId = value;
      }
      if (typeof value === 'object') visit(value, depth + 1);
    }
  };
  visit(raw, 0);
  return buttonId ? { buttonId, chatId, userId } : null;
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
  private replyCb?: (buttonId: string, sender: { chatId: string; userId: string }) => void;
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
        this.replyCb?.(button.id, { chatId: parsed.chatId, userId: parsed.userId });
        return;
      }
      this.messageCb?.({ chatId: parsed.chatId, userId: parsed.userId, text: parsed.text });
    });
    // 原生 actionCard 按钮回调（Stream 模式，Roadmap v0.2）
    client.registerCallbackListener(TOPIC_CARD, (msg) => {
      let data: unknown;
      try {
        data = JSON.parse(msg.data) as unknown;
      } catch {
        return;
      }
      const result = parseCardCallback(data);
      if (result) {
        this.replyCb?.(result.buttonId, {
          chatId: result.chatId ?? result.userId ?? '',
          userId: result.userId ?? '',
        });
      }
    });
    await client.connect();
    this.connected = true;
    console.log('[dingtalk] 钉钉 Stream 已连接');
  }

  async send(chatId: string, payload: OutboundPayload): Promise<void> {
    const webhook = this.webhooks.get(chatId);
    if (!webhook) throw new Error(`钉钉会话 ${chatId} 无可用 sessionWebhook（先让用户发一条消息）`);
    if (payload.buttons?.length) {
      this.pendingButtons.set(chatId, payload.buttons); // 卡片之外仍支持编号回复兜底
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildActionCard(payload.text, payload.buttons)),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`钉钉回发失败 ${res.status}: ${body.slice(0, 200)}`);
      }
      return;
    }
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
  onReply(cb: (buttonId: string, sender: { chatId: string; userId: string }) => void): void { this.replyCb = cb; }
  status(): { connected: boolean } { return { connected: this.connected }; }
}
