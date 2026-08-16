import Bolt from '@slack/bolt';
import type { Adapter, NormalizedMessage, OutboundButton, OutboundPayload } from '../adapter.js';

// @slack/bolt 是 CommonJS 包：Node 原生 ESM 下 `import { App }`（命名导入）会因
// cjs-module-lexer 无法识别其导出而失败（App 为 undefined / 静态导入抛 SyntaxError），
// 必须 default 导入后解构。
const { App } = Bolt;

// ── 纯函数 ────────────────────────────────────────────────────

export interface RawSlackMessage {
  channel?: string;
  user?: string;
  text?: string;
  subtype?: string;
  bot_id?: string;
  files?: Array<{ url_private?: string; mimetype?: string }>;
}

/** 纯函数：取第一条文件的私有 URL（files[0].url_private）；无文件返回 undefined。 */
export function slackFileUrl(raw: RawSlackMessage): string | undefined {
  return raw.files?.[0]?.url_private;
}

type MediaKind = 'voice' | 'image' | 'video' | 'file';

function mediaKindFromMime(mime?: string): MediaKind {
  if (mime?.startsWith('image/')) return 'image';
  if (mime?.startsWith('audio/')) return 'voice';
  if (mime?.startsWith('video/')) return 'video';
  return 'file';
}

export function normalizeSlackMessage(raw: RawSlackMessage): NormalizedMessage | null {
  if (!raw.channel || !raw.user || raw.subtype === 'bot_message' || raw.bot_id) return null;
  const text = raw.text ?? '';
  const url = slackFileUrl(raw);
  if (!text && !url) return null;
  const out: NormalizedMessage = { chatId: raw.channel, userId: raw.user, text };
  if (url) out.media = { kind: mediaKindFromMime(raw.files?.[0]?.mimetype), url };
  return out;
}

export function slackBlocks(text: string, buttons: OutboundButton[]): unknown[] {
  const blocks: unknown[] = [{ type: 'section', text: { type: 'mrkdwn', text } }];
  if (buttons.length > 0) {
    blocks.push({
      type: 'actions',
      elements: buttons.map((b) => ({
        type: 'button',
        value: b.id,
        text: { type: 'plain_text', text: b.label },
      })),
    });
  }
  return blocks;
}

// ── 适配器 ────────────────────────────────────────────────────

export interface SlackAdapterOptions {
  botToken: string;
  appToken: string;
}

export class SlackAdapter implements Adapter {
  readonly id = 'slack';
  // 解构出的 App 只有值绑定（无类型绑定），实例类型需用 InstanceType<typeof App>
  private readonly app: InstanceType<typeof App>;
  private connected = false;
  private messageCb?: (msg: NormalizedMessage) => void;
  private replyCb?: (buttonId: string) => void;

  constructor(opts: SlackAdapterOptions) {
    this.app = new App({ token: opts.botToken, appToken: opts.appToken, socketMode: true });
  }

  async connect(): Promise<void> {
    this.app.message(async ({ message }) => {
      const msg = normalizeSlackMessage(message as RawSlackMessage);
      if (msg) this.messageCb?.(msg);
    });
    this.app.action(/^approve:|^reject:/, async ({ ack, body, respond }) => {
      await ack();
      const action = (body as { actions?: Array<{ value?: string }> }).actions?.[0];
      if (action?.value) this.replyCb?.(action.value);
      await respond({ text: '处理中…', replace_original: false }).catch(() => undefined);
    });
    await this.app.start(0); // Socket Mode 不需要端口；start(0) 仅建立连接
    this.connected = true;
    console.log('[slack] 已连接 Slack（Socket Mode）');
  }

  async send(chatId: string, payload: OutboundPayload): Promise<void> {
    await this.app.client.chat.postMessage({
      channel: chatId,
      text: payload.text,
      blocks: slackBlocks(payload.text, payload.buttons ?? []) as never,
    });
  }

  onMessage(cb: (msg: NormalizedMessage) => void): void { this.messageCb = cb; }
  onReply(cb: (buttonId: string) => void): void { this.replyCb = cb; }
  status(): { connected: boolean } { return { connected: this.connected }; }
}
