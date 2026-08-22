// v0.2b 实验性：个人微信适配器（腾讯官方 iLink / ClawBot 协议，HTTP/JSON）。
// 协议形状与 DSH 生态已验证实现（super-wechat-bridge）一致：
//   - 登录：GET /ilink/bot/get_bot_qrcode?bot_type=3 → GET /ilink/bot/get_qrcode_status?qrcode=
//   - 收：POST /ilink/bot/getupdates（长轮询，响应 data.msgs + get_updates_buf 同步游标）
//   - 发：POST /ilink/bot/sendmessage（msg 包裹 + item_list[].text_item，必须带 base_info.channel_version）
// 使用 iLink 需遵守《微信 ClawBot 功能使用条款》；本适配器标记为实验性，需真实设备验证。
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as qrcode from 'qrcode-terminal';
import type { Adapter, NormalizedMessage, OutboundButton, OutboundPayload } from '../adapter.js';
import { PendingButtons } from '../pending-buttons.js';

const DEFAULT_BASE = 'https://ilinkai.weixin.qq.com';
const CHANNEL_VERSION = '1.0.2';
const TEXT_CHUNK_LIMIT = 800;

// ── 纯函数（可单测）───────────────────────────────────────────

export interface WeChatIncomingMsg {
  from_user_id?: string;
  context_token?: string;
  text_item?: { text?: string };
  item_list?: Array<{ type?: number; text_item?: { text?: string } }>;
}

/** 纯函数：从 iLink 消息提取文本（text_item 或 item_list[].text_item，type===1 为文本）。 */
export function extractWeChatText(msg: WeChatIncomingMsg): string | null {
  if (msg.text_item?.text) return msg.text_item.text;
  for (const item of msg.item_list ?? []) {
    if (item.type === 1 && item.text_item?.text) return item.text_item.text;
  }
  return null;
}

/** 纯函数：iLink 入站消息 → NormalizedMessage；非文本/缺发送者返回 null。 */
export function parseWeChatUpdate(msg: WeChatIncomingMsg): NormalizedMessage | null {
  const userId = msg.from_user_id;
  const text = extractWeChatText(msg);
  if (!userId || !text) return null;
  return { chatId: userId, userId, text };
}

/** 纯函数：getupdates 长轮询请求体。base_info.channel_version 缺失时服务器不投递（生态实测）。 */
export function buildGetUpdatesBody(syncBuf: string): Record<string, unknown> {
  return { get_updates_buf: syncBuf, longpolling_timeout: 35000, base_info: { channel_version: CHANNEL_VERSION } };
}

/** 纯函数：sendmessage 请求体（msg 包裹 + text_item）。clientId 可注入以便测试。 */
export function buildSendMessageBody(
  toUserId: string,
  text: string,
  contextToken: string,
  clientId = `dsh-${randomUUID()}`,
): Record<string, unknown> {
  return {
    msg: {
      from_user_id: '',
      to_user_id: toUserId,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      context_token: contextToken,
      item_list: [{ type: 1, text_item: { text } }],
    },
    base_info: { channel_version: CHANNEL_VERSION },
  };
}

/** 纯函数：长文本按上限分段（iLink 单条消息长度限制）。 */
export function chunkText(text: string, limit = TEXT_CHUNK_LIMIT): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += limit) chunks.push(text.slice(i, i + limit));
  return chunks;
}

/** 纯函数：审批按钮 → 编号回复文本（原生按钮不支持时的兜底）。 */
export function buildNumberedReplyText(text: string, buttons: OutboundButton[]): string {
  if (buttons.length === 0) return text;
  const options = buttons.map((b, i) => `${i + 1}) ${b.label}`).join('\n');
  return `${text}\n\n${options}\n\n回复数字选择。`;
}

// ── 适配器（实验性）────────────────────────────────────────────

export interface WeChatAdapterOptions {
  /** iLink api-token（扫码登录后自动保存；也可预先配置 WECHAT_TOKEN） */
  token?: string;
  baseUrl?: string;
  stateDir?: string;
}

export class WeChatAdapter implements Adapter {
  readonly id = 'wechat';
  private messageCb?: (msg: NormalizedMessage) => void;
  private replyCb?: (buttonId: string, sender: { chatId: string; userId: string }) => void;
  private readonly pendingButtons = new PendingButtons();
  private readonly stateDir: string;
  private token: string;
  private syncBuf = '';
  private readonly contextTokens = new Map<string, string>();
  private polling = false;
  private stopped = false;

  constructor(private readonly opts: WeChatAdapterOptions) {
    this.stateDir = opts.stateDir ?? 'data/wechat';
    this.token = opts.token ?? '';
    // 恢复持久化状态：token / sync 游标 / 上下文 token（回话关联必需）
    try {
      if (existsSync(join(this.stateDir, 'token.txt'))) this.token = this.token || readFileSync(join(this.stateDir, 'token.txt'), 'utf8').trim();
      if (existsSync(join(this.stateDir, 'sync_buf.txt'))) this.syncBuf = readFileSync(join(this.stateDir, 'sync_buf.txt'), 'utf8').trim();
      if (existsSync(join(this.stateDir, 'context_tokens.json'))) {
        const tokens = JSON.parse(readFileSync(join(this.stateDir, 'context_tokens.json'), 'utf8')) as Record<string, unknown>;
        for (const [k, v] of Object.entries(tokens)) if (typeof v === 'string') this.contextTokens.set(k, v);
      }
    } catch {
      /* 状态文件损坏则忽略，走全新登录 */
    }
  }

  private persistState(): void {
    try {
      mkdirSync(this.stateDir, { recursive: true });
      writeFileSync(join(this.stateDir, 'token.txt'), this.token, 'utf8');
      writeFileSync(join(this.stateDir, 'sync_buf.txt'), this.syncBuf, 'utf8');
      writeFileSync(join(this.stateDir, 'context_tokens.json'), JSON.stringify(Object.fromEntries(this.contextTokens)), 'utf8');
    } catch {
      /* 持久化失败不阻断 */
    }
  }

  async connect(): Promise<void> {
    if (!this.token) {
      console.log('[wechat] 未配置 WECHAT_TOKEN：尝试实验性扫码登录（v0.2b）…');
      void this.tryLogin().then((ok) => { if (ok) this.startPolling(); });
      return;
    }
    this.startPolling();
  }

  private base(): string {
    return (this.opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
  }

  private async apiFetch(endpoint: string, body: Record<string, unknown>, timeoutMs = 45000): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.base()}/${endpoint}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          AuthorizationType: 'ilink_bot_token',
          Authorization: `Bearer ${this.token}`,
          'X-WECHAT-UIN': String(Math.floor(Math.random() * 0x7fffffff)),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`iLink ${endpoint} HTTP ${res.status}`);
      return (await res.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 实验性扫码登录：打印二维码（liteapp URL 渲染为 QR），轮询扫码状态，成功后持久化 token。 */
  private async tryLogin(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base()}/ilink/bot/get_bot_qrcode?bot_type=3`);
      const d = (await res.json().catch(() => null)) as { qrcode?: string; qrcode_img_content?: string } | null;
      if (!d?.qrcode || !d.qrcode_img_content) {
        console.warn(`[wechat] 获取登录二维码失败: ${JSON.stringify(d).slice(0, 200)}`);
        return false;
      }
      console.log('[wechat] 请用微信扫描下方二维码完成 iLink ClawBot 登录:');
      qrcode.generate(d.qrcode_img_content, { small: true });
      for (let i = 0; i < 60 && !this.stopped; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const st = (await fetch(`${this.base()}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(d.qrcode)}`).then((r) => r.json())) as { bot_token?: string };
          if (st?.bot_token) {
            this.token = st.bot_token;
            this.persistState();
            console.log('[wechat] 扫码成功，已保存 token，开始收消息');
            return true;
          }
        } catch {
          /* 状态轮询瞬时失败继续重试 */
        }
      }
      console.log('[wechat] 扫码超时（3 分钟未确认）；重启适配器可重新生成二维码');
      return false;
    } catch (error) {
      console.warn(`[wechat] 登录流程异常: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private startPolling(): void {
    if (this.polling) return;
    this.polling = true;
    void this.pollLoop();
  }

  private async pollLoop(): Promise<void> {
    while (!this.stopped && this.token) {
      try {
        const data = await this.apiFetch('ilink/bot/getupdates', buildGetUpdatesBody(this.syncBuf));
        if (typeof data.get_updates_buf === 'string') {
          this.syncBuf = data.get_updates_buf;
          this.persistState();
        }
        for (const msg of (data.msgs as WeChatIncomingMsg[] | undefined) ?? []) {
          const normalized = parseWeChatUpdate(msg);
          if (!normalized) continue;
          if (msg.context_token) this.contextTokens.set(normalized.userId, msg.context_token);
          const button = this.pendingButtons.match(normalized.chatId, normalized.text);
          if (button) {
            this.replyCb?.(button.id, { chatId: normalized.chatId, userId: normalized.userId });
            continue;
          }
          this.messageCb?.(normalized);
        }
      } catch (error) {
        if (this.stopped) break;
        console.warn(`[wechat] 轮询失败: ${error instanceof Error ? error.message : String(error)}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    this.polling = false;
  }

  async send(chatId: string, payload: OutboundPayload): Promise<void> {
    if (!this.token) throw new Error('wechat 未登录（无 token），无法发送');
    if (payload.buttons?.length) this.pendingButtons.set(chatId, payload.buttons);
    const text = buildNumberedReplyText(payload.text, payload.buttons ?? []);
    const contextToken = this.contextTokens.get(chatId) ?? '';
    for (const chunk of chunkText(text)) {
      await this.apiFetch('ilink/bot/sendmessage', buildSendMessageBody(chatId, chunk, contextToken));
    }
  }

  onMessage(cb: (msg: NormalizedMessage) => void): void { this.messageCb = cb; }
  onReply(cb: (buttonId: string, sender: { chatId: string; userId: string }) => void): void { this.replyCb = cb; }
  status(): { connected: boolean } { return { connected: Boolean(this.token) }; }
}
