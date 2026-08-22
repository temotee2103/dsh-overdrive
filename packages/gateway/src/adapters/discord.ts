import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  type ButtonInteraction,
  type Message,
} from 'discord.js';
import type { Adapter, NormalizedMessage, OutboundButton, OutboundPayload } from '../adapter.js';

// ── 纯函数 ────────────────────────────────────────────────────

export interface RawDiscordMessage {
  channelId?: string;
  author?: { id?: string; bot?: boolean };
  content?: string;
  attachments?: Array<{ url?: string; contentType?: string }>;
}

/** 纯函数：取第一条附件的下载 URL（attachments.first().url）；无附件返回 undefined。 */
export function discordAttachmentUrl(raw: RawDiscordMessage): string | undefined {
  return raw.attachments?.[0]?.url;
}

type MediaKind = 'voice' | 'image' | 'video' | 'file';

function mediaKindFromMime(mime?: string): MediaKind {
  if (mime?.startsWith('image/')) return 'image';
  if (mime?.startsWith('audio/')) return 'voice';
  if (mime?.startsWith('video/')) return 'video';
  return 'file';
}

export function normalizeDiscordMessage(raw: RawDiscordMessage): NormalizedMessage | null {
  if (!raw.channelId || !raw.author?.id || raw.author.bot) return null;
  const text = raw.content ?? '';
  const url = discordAttachmentUrl(raw);
  if (!text && !url) return null;
  const out: NormalizedMessage = { chatId: raw.channelId, userId: raw.author.id, text };
  if (url) out.media = { kind: mediaKindFromMime(raw.attachments?.[0]?.contentType), url };
  return out;
}

export function discordComponents(buttons: OutboundButton[]): Array<{ type: 1; components: unknown[] }> {
  return [{
    type: 1,
    components: buttons.map((b) => ({
      type: 2,
      custom_id: b.id,
      label: b.label,
      style: 1, // ButtonStyle.Primary
    })),
  }];
}

// ── 适配器 ────────────────────────────────────────────────────

export interface DiscordAdapterOptions { token: string; }

export class DiscordAdapter implements Adapter {
  readonly id = 'discord';
  private readonly client: Client;
  private connected = false;
  private messageCb?: (msg: NormalizedMessage) => void;
  private replyCb?: (buttonId: string, sender: { chatId: string; userId: string }) => void;

  constructor(opts: DiscordAdapterOptions) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
    void opts.token;
    this.client.login(opts.token).catch((e) => console.error('[discord] 登录失败:', e));
  }

  async connect(): Promise<void> {
    this.client.once(Events.ClientReady, () => { this.connected = true; console.log('[discord] 已连接 Discord'); });
    this.client.on(Events.MessageCreate, (m: Message) => {
      const msg = normalizeDiscordMessage(m as never);
      if (msg) this.messageCb?.(msg);
    });
    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isButton()) return;
      const button = interaction as ButtonInteraction;
      await button.deferUpdate().catch(() => undefined);
      this.replyCb?.(button.customId, {
        chatId: button.channelId,
        userId: button.user.id,
      });
    });
  }

  async send(chatId: string, payload: OutboundPayload): Promise<void> {
    const channel = await this.client.channels.fetch(chatId);
    if (!channel || !('send' in channel)) {
      console.error(`[discord] 无法向 ${chatId} 发送（channel 不可用）`);
      return;
    }
    if (payload.media) {
      await (channel as { send: (o: unknown) => Promise<unknown> }).send({
        content: payload.text,
        files: [payload.media.path],
      });
      return;
    }
    if (payload.buttons?.length) {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        payload.buttons.map((b) =>
          new ButtonBuilder().setCustomId(b.id).setLabel(b.label).setStyle(ButtonStyle.Primary),
        ),
      );
      await (channel as { send: (o: unknown) => Promise<unknown> }).send({ content: payload.text, components: [row] });
      return;
    }
    await (channel as { send: (o: unknown) => Promise<unknown> }).send(payload.text);
  }

  onMessage(cb: (msg: NormalizedMessage) => void): void { this.messageCb = cb; }
  onReply(cb: (buttonId: string, sender: { chatId: string; userId: string }) => void): void { this.replyCb = cb; }
  status(): { connected: boolean } { return { connected: this.connected }; }
}
