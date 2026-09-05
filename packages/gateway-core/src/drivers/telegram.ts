import type { MediaRef } from '../dsh-runtime.js';
import { chunkLongText, escapeHtml } from '../format.js';
import type { NativeDriver, NativeOutbound } from '../native.js';

/**
 * Telegram 原生 driver（进程内，P1 MVP）。
 *
 * 与外部 gateway 的 grammy adapter 不同：这里用极简 Bot API 轮询 client
 * （Node 全局 fetch），不引入额外依赖，方便单测注入 seam。MVP 能力：
 * 文本收发 + allowlist + HTML + 长文分片 + typing 提示；媒体/审批按钮在
 * P2 扩展（届时可复用外部 adapter 的 normalize 纯函数）。
 */

// —— Telegram Bot API 结构外形 ——

export interface RawTelegramUpdate {
  update_id: number;
  message?: {
    message_id?: number;
    text?: string;
    caption?: string;
    from?: { id?: number };
    chat?: { id?: number };
    photo?: unknown[];
    voice?: unknown;
    audio?: unknown;
    video?: unknown;
    document?: unknown;
  };
  callback_query?: unknown;
}

/** Bot API 调用面（默认走真实 API，测试注入 fake）。 */
export interface TelegramApiLike {
  getMe(): Promise<unknown>;
  getUpdates(params: { offset: number; timeout: number }): Promise<{ result: RawTelegramUpdate[] }>;
  sendMessage(chatId: number | string, text: string, extra?: Record<string, unknown>): Promise<unknown>;
  sendChatAction(chatId: number | string, action: 'typing'): Promise<unknown>;
}

/** 一条已归一化的入站消息。 */
export interface TelegramInbound {
  channel: string; // chat id
  user: string; // from id
  text: string;
  media?: MediaRef;
}

export interface TelegramNativeOptions {
  token: string;
  allowedUserIds?: number[];
  allowAllUsers?: boolean;
  /** Telegram 单条消息上限。 */
  maxMessageLength?: number;
  pollingTimeoutSec?: number;
  /** 测试注入 seam。 */
  api?: TelegramApiLike;
  /** 测试注入 seam（轮询间隔）。 */
  sleep?: (ms: number) => Promise<void>;
}

const API_BASE = 'https://api.telegram.org';

function realApi(token: string): TelegramApiLike {
  async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`telegram api ${method} -> ${res.status}`);
    const json = (await res.json()) as { ok: boolean; description?: string; result: T };
    if (!json.ok) throw new Error(`telegram api ${method}: ${json.description ?? 'unknown error'}`);
    return json.result;
  }
  return {
    getMe: () => call('getMe', {}),
    getUpdates: (params) => call('getUpdates', { ...params }),
    sendMessage: (chatId, text, extra) => call('sendMessage', { chat_id: chatId, text, ...extra }),
    sendChatAction: (chatId, action) => call('sendChatAction', { chat_id: chatId, action }),
  };
}

const HELP_TEXT = [
  'dsh-overdrive gateway-core（进程内模式）',
  '/help — 帮助',
  '/new — 开启新会话',
  '/clear — 重置当前会话',
].join('\n');

/**
 * Telegram 原生 driver：轮询拿消息 → onIncoming；send() 把出站载荷发回聊天。
 * 未配置任何允许用户且 allowAllUsers=false 时，仅回复一条初始化提示并忽略消息。
 */
export class TelegramNativeDriver implements NativeDriver {
  readonly platform = 'telegram';

  private readonly api: TelegramApiLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly allowed: ReadonlySet<number>;
  private readonly allowAll: boolean;
  private readonly maxMessageLength: number;
  private readonly pollTimeoutMs: number;
  private offset = 0;
  private running = false;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private onIncoming?: (m: TelegramInbound) => Promise<void> | void;
  private lastTypingAt = 0;
  private warnedDenied = false;

  constructor(private readonly opts: TelegramNativeOptions) {
    this.api = opts.api ?? realApi(opts.token);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.allowed = new Set(opts.allowedUserIds ?? []);
    this.allowAll = opts.allowAllUsers ?? false;
    this.maxMessageLength = opts.maxMessageLength ?? 4096;
    this.pollTimeoutMs = (opts.pollingTimeoutSec ?? 30) * 1000;
  }

  /** 校验 token 并启动轮询。onIncoming 处理归一化入站消息。 */
  async start(onIncoming: (m: TelegramInbound) => Promise<void> | void): Promise<void> {
    if (this.running) return;
    await this.api.getMe(); // token 无效在此抛错（调用方决定是否吞掉）
    this.onIncoming = onIncoming;
    this.running = true;
    void this.pollLoop();
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
    this.onIncoming = undefined;
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const { result } = await this.api.getUpdates({
          offset: this.offset,
          timeout: Math.round(this.pollTimeoutMs / 1000),
        });
        for (const update of result) {
          if (update.update_id >= this.offset) this.offset = update.update_id + 1;
          await this.handleUpdate(update);
        }
      } catch (error) {
        console.warn(`[gateway-core] telegram 轮询错误: ${error instanceof Error ? error.message : String(error)}`);
        await this.sleep(3000); // 退避，避免热循环
      }
      await this.sleep(50); // 轮询底线，防止空转热循环
    }
  }

  /** 归一化 + 鉴权；返回 null 表示忽略（非文本/超员）。 */
  private handleUpdate(update: RawTelegramUpdate): Promise<void> | void {
    if (update.callback_query || !update.message) return;
    const msg = update.message;
    if (msg.chat?.id === undefined || msg.from?.id === undefined) return;
    const text = msg.text ?? msg.caption ?? '';
    const media: MediaRef | undefined = undefined;
    if (!text && !media) return;

    const chatId = String(msg.chat.id);
    const userId = msg.from.id;
    if (!this.allowAll && !this.allowed.has(userId)) {
      if (!this.warnedDenied) {
        this.warnedDenied = true;
        void this.api.sendMessage(
          chatId,
          '⚠️ 你不在允许列表中。管理员需配置 telegram.allowedUserIds 或 telegram.allowAllUsers=true。',
        );
      }
      return;
    }

    return this.onIncoming?.({ channel: chatId, user: String(userId), text, media });
  }

  async send(to: { channel: string; user: string }, outbound: NativeOutbound): Promise<void> {
    switch (outbound.kind) {
      case 'status':
        if (outbound.status === 'busy') await this.notifyTyping(to.channel);
        return;
      case 'delta':
        return; // MVP：流式增量在 complete 汇总发送
      case 'trajectory':
        return;
      case 'approval': {
        const body = `${outbound.summary}\n\n回复「批准」或「1」允许；「拒绝」或「0」拒绝（${Math.round(outbound.timeoutMs / 1000)}s 内）`;
        for (const chunk of chunkLongText(body, this.maxMessageLength)) {
          await this.api.sendMessage(to.channel, escapeHtml(chunk), { parse_mode: 'HTML' });
        }
        return;
      }
      case 'complete': {
        if (!outbound.text) return;
        for (const chunk of chunkLongText(outbound.text, this.maxMessageLength)) {
          await this.api.sendMessage(to.channel, escapeHtml(chunk), { parse_mode: 'HTML' });
        }
        return;
      }
    }
  }

  private async notifyTyping(chatId: string): Promise<void> {
    const now = Date.now();
    if (now - this.lastTypingAt < 4000) return; // 限频
    this.lastTypingAt = now;
    try {
      await this.api.sendChatAction(chatId, 'typing');
    } catch {
      /* typing 失败可忽略 */
    }
  }
}

/** apply 层用的命令处理辅助：返回 null 表示普通消息。 */
export function telegramCommand(text: string): '/help' | '/new' | '/clear' | null {
  const trimmed = text.trim();
  if (trimmed === '/help' || trimmed === '/start') return '/help';
  if (trimmed === '/new') return '/new';
  if (trimmed === '/clear') return '/clear';
  return null;
}

export const telegramHelpText = HELP_TEXT;
