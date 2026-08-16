# dsh-overdrive M2b 实施计划：国际平台适配器（WhatsApp / Telegram / Discord / Slack）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 4 个国际消息平台适配器（WhatsApp Baileys、Telegram grammY、Discord discord.js、Slack Bolt Socket Mode），并让 Gateway 支持多适配器并发。每平台做到：接收文本消息 → 注入 DSH agent → 回复回传 → 审批按钮（平台原生或编号文本）。

**Architecture:** 复用既有 `Adapter` 接口（`id/connect/send/onMessage/onReply`）。每个适配器的**平台原始数据 → NormalizedMessage**、**OutboundPayload → 平台消息/按钮**拆成纯函数（可单测）；真实 SDK 连接代码保持薄层（连上、转发、回传）。Gateway 主程序按 `GATEWAY_ADAPTERS` 环境变量装载多个适配器，会话键天然按 `adapter.id` 区分，路由/审批/白名单逻辑零改动。

**Tech Stack:** TypeScript (strict, NodeNext)、`@whiskeysockets/baileys@^6.0.1` + `qrcode-terminal` + `pino`、`grammy@^1.45.0`、`discord.js@^14.27.0`、`@slack/bolt`（Socket Mode）、vitest、既有 `@dsh-overdrive/sdk` 与 gateway 骨架。

**Scope 说明（重要）：**
- 本计划 = M2b（国际 4 平台）。中文平台（飞书/钉钉/企业微信）是 M3 计划；语音/图片/流式渲染（`message.delta` 实时渲染）是 M4；Web 控制台扫码是 M5。
- **WhatsApp 审批按钮用"编号文本回复"**（正文列出 1/2 选项，用户回复数字）——Baileys 的 nativeFlowMessage 交互按钮在 6.x 里响应载荷形态不稳，为避免不可验证的假设，M2b 用最可靠的编号回复；原生交互按钮留到 M4 作为增强。
- Telegram/Discord/Slack 用平台原生按钮（inline keyboard / action row / actions block），点击回传按钮 id → `resolveApproval`。
- **真实平台交互无法在 CI 自动验证**（需要真实 token/扫码）。测试策略：纯转换函数全量单测 + 真实连接只做类型检查 + 每平台**手工验收清单**（计划 Task 7 产出 `docs/smoke-platforms.md`）。这不是占位——是明确的验收路径。

---

## File Structure（本计划新增/修改）

```
packages/gateway/
├── package.json                 # 修改：新增 4 平台 SDK 依赖
├── src/
│   ├── adapter.ts               # 不变（Adapter 契约已够用）
│   ├── config.ts                # 新增：env → 适配器配置解析 + createAdapter 注册表
│   ├── index.ts                 # 修改：多适配器装载 + 错误兜底
│   └── adapters/
│       ├── cli.ts               # 不变
│       ├── whatsapp.ts          # 新增（含纯函数 normalize/buildNumberedReply）
│       ├── telegram.ts          # 新增（含纯函数 normalize/buttonRows）
│       ├── discord.ts           # 新增（含纯函数 normalize/discordComponents）
│       └── slack.ts             # 新增（含纯函数 normalize/slackBlocks）
└── test/
    ├── config.test.ts           # 新增
    ├── adapters.whatsapp.test.ts
    ├── adapters.telegram.test.ts
    ├── adapters.discord.test.ts
    ├── adapters.slack.test.ts
    └── multi.test.ts            # 新增：多适配器装载（FakeAdapter）
docs/smoke-platforms.md          # 新增：各平台手工验收清单
README.md                        # 修改：M2b 状态
```

---

## Task 1: 平台依赖 + 适配器配置解析与注册表

**Files:**
- Modify: `packages/gateway/package.json`
- Create: `packages/gateway/src/config.ts`
- Create: `packages/gateway/test/config.test.ts`

- [ ] **Step 1: 更新 `packages/gateway/package.json`**

```json
{
  "name": "@dsh-overdrive/gateway",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "build": "tsc" },
  "dependencies": {
    "@dsh-overdrive/sdk": "0.1.0",
    "@slack/bolt": "^4.0.0",
    "@whiskeysockets/baileys": "^6.0.1",
    "discord.js": "^14.27.0",
    "grammy": "^1.45.0",
    "pino": "^9.0.0",
    "qrcode-terminal": "^0.12.0"
  },
  "devDependencies": {
    "@types/qrcode-terminal": "^0.12.2"
  }
}
```

- [ ] **Step 2: 安装并确认解析**

```bash
cd <workspace>
npm install
npm ls @whiskeysockets/baileys grammy discord.js @slack/bolt
```
Expected: 4 个包全部解析成功。若 `@slack/bolt@^4.0.0` 不存在（npm view @slack/bolt versions 确认），降到 `^3.0.0` 并继续——两者 API（App/token/appToken/socketMode/message/action/client.chat）一致。若 baileys 解析到 7.0.0-rc，检查 `npm ls`，确保锁在 6.x（可用 `npm i -D @whiskeysockets/baileys@^6.0.1` 强制）。

- [ ] **Step 3: 写失败测试 `test/config.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createAdapter, parseAdapterIds, type AdapterEnv } from '../src/config.js';

describe('parseAdapterIds', () => {
  it('逗号分隔 + 去空格 + 去空项', () => {
    expect(parseAdapterIds('cli, whatsapp, telegram,')).toEqual(['cli', 'whatsapp', 'telegram']);
  });
  it('缺省为 cli', () => {
    expect(parseAdapterIds('')).toEqual(['cli']);
  });
});

describe('createAdapter 注册表', () => {
  it('cli 恒可用', () => {
    const a = createAdapter('cli', {});
    expect(a.id).toBe('cli');
  });
  it('未知适配器抛错', () => {
    expect(() => createAdapter('nope', {})).toThrow(/unknown adapter/);
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

```bash
npx vitest run packages/gateway/test/config.test.ts
```
Expected: FAIL（`../src/config.js` 不存在）。

- [ ] **Step 5: 写 `src/config.ts`**

```ts
import type { Adapter } from './adapter.js';
import { CliAdapter } from './adapters/cli.js';
import { WhatsAppAdapter } from './adapters/whatsapp.js';
import { TelegramAdapter } from './adapters/telegram.js';
import { DiscordAdapter } from './adapters/discord.js';
import { SlackAdapter } from './adapters/slack.js';

/** 平台适配器需要的全部环境变量（缺省为 undefined = 不启用该平台）。 */
export interface AdapterEnv {
  whatsappDataDir?: string;
  telegramBotToken?: string;
  discordBotToken?: string;
  slackBotToken?: string;
  slackAppToken?: string;
}

export function parseAdapterIds(raw: string): string[] {
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return ids.length > 0 ? ids : ['cli'];
}

/** 按 id 创建适配器实例；依赖注入 env 便于测试。 */
export function createAdapter(id: string, env: AdapterEnv): Adapter {
  switch (id) {
    case 'cli':
      return new CliAdapter();
    case 'whatsapp':
      return new WhatsAppAdapter({ authDir: env.whatsappDataDir ?? 'data/whatsapp' });
    case 'telegram':
      if (!env.telegramBotToken) throw new Error('telegram 适配器需要 TELEGRAM_BOT_TOKEN');
      return new TelegramAdapter({ token: env.telegramBotToken });
    case 'discord':
      if (!env.discordBotToken) throw new Error('discord 适配器需要 DISCORD_BOT_TOKEN');
      return new DiscordAdapter({ token: env.discordBotToken });
    case 'slack':
      if (!env.slackBotToken || !env.slackAppToken) throw new Error('slack 适配器需要 SLACK_BOT_TOKEN 与 SLACK_APP_TOKEN');
      return new SlackAdapter({ botToken: env.slackBotToken, appToken: env.slackAppToken });
    default:
      throw new Error(`unknown adapter: ${id}`);
  }
}

/** 从 process.env 读适配器配置。 */
export function adapterEnvFromProcess(env: NodeJS.ProcessEnv = process.env): AdapterEnv {
  return {
    whatsappDataDir: env.WHATSAPP_DATA_DIR,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    discordBotToken: env.DISCORD_BOT_TOKEN,
    slackBotToken: env.SLACK_BOT_TOKEN,
    slackAppToken: env.SLACK_APP_TOKEN,
  };
}
```

> **说明：** `createAdapter` 使用**静态导入**（本包是 `type: module` ESM，运行时没有 `require`）。代价是所有平台 SDK 都会被加载——它们都是 gateway 的 dependencies，无副作用；未启用的平台只是不 `connect()`。

- [ ] **Step 6: 跑测试确认通过 + 提交**

```bash
npx vitest run packages/gateway/test/config.test.ts
git add packages/gateway/package.json package-lock.json packages/gateway/src/config.ts packages/gateway/test/config.test.ts
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "feat(gateway): 平台依赖 + 适配器注册表（config/createAdapter）"
```
Expected: 3 个测试全 PASS，commit 成功。

---

## Task 2: WhatsApp 适配器（Baileys 6.x，扫码配对）

**Files:**
- Create: `packages/gateway/src/adapters/whatsapp.ts`
- Create: `packages/gateway/test/adapters.whatsapp.test.ts`

- [ ] **Step 1: 写失败测试 `test/adapters.whatsapp.test.ts`（纯函数）**

```ts
import { describe, expect, it } from 'vitest';
import { buildNumberedReply, matchNumberedReply, normalizeWhatsAppMessage } from '../src/adapters/whatsapp.js';

describe('normalizeWhatsAppMessage', () => {
  it('文本消息 → NormalizedMessage（chatId=JID, userId=发送者）', () => {
    const raw = {
      key: { remoteJid: '60123@s.whatsapp.net', participant: undefined },
      message: { conversation: 'hello' },
      messageType: 'conversation',
    };
    const out = normalizeWhatsAppMessage(raw);
    expect(out?.kind).toBe('message');
    expect(out?.msg).toMatchObject({ chatId: '60123@s.whatsapp.net', userId: '60123@s.whatsapp.net', text: 'hello' });
  });

  it('群聊用 participant 作 userId', () => {
    const raw = {
      key: { remoteJid: 'group@g.us', participant: '60123@s.whatsapp.net' },
      message: { extendedTextMessage: { text: 'hi' } },
      messageType: 'extendedTextMessage',
    };
    const out = normalizeWhatsAppMessage(raw);
    expect(out?.msg.userId).toBe('60123@s.whatsapp.net');
    expect(out?.msg.chatId).toBe('group@g.us');
  });

  it('非文本消息返回 null', () => {
    expect(normalizeWhatsAppMessage({ key: { remoteJid: 'x' }, message: { imageMessage: {} } })).toBeNull();
    expect(normalizeWhatsAppMessage({ key: { remoteJid: 'x' }, message: {} })).toBeNull();
  });
});

describe('buildNumberedReply / matchNumberedReply（审批按钮的编号文本方案）', () => {
  it('生成 1/2 编号选项', () => {
    const text = buildNumberedReply('⚠️ 需要批准：删除文件', [
      { id: 'approve:r1', label: '✅ 同意' },
      { id: 'reject:r1', label: '🚫 拒绝' },
    ]);
    expect(text).toContain('1) ✅ 同意');
    expect(text).toContain('2) 🚫 拒绝');
  });

  it('回复数字能匹配回按钮 id', () => {
    const buttons = [
      { id: 'approve:r1', label: '✅ 同意' },
      { id: 'reject:r1', label: '🚫 拒绝' },
    ];
    expect(matchNumberedReply('1', buttons)?.id).toBe('approve:r1');
    expect(matchNumberedReply('2', buttons)?.id).toBe('reject:r1');
    expect(matchNumberedReply('9', buttons)).toBeUndefined();
    expect(matchNumberedReply('同意', buttons)).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/gateway/test/adapters.whatsapp.test.ts
```
Expected: FAIL（`../src/adapters/whatsapp.js` 不存在）。

- [ ] **Step 3: 写 `src/adapters/whatsapp.ts`**

```ts
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
  type AnyMessageContent,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
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
      await this.sock.sendMessage(chatId, { text } as AnyMessageContent);
      return;
    }
    await this.sock.sendMessage(chatId, { text: payload.text } as AnyMessageContent);
  }

  onMessage(cb: (msg: NormalizedMessage) => void): void { this.messageCb = cb; }
  onReply(cb: (buttonId: string) => void): void { this.replyCb = cb; }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run packages/gateway/test/adapters.whatsapp.test.ts
```
Expected: 3 组测试全 PASS。

- [ ] **Step 5: 类型检查 + 提交**

```bash
npm run build
git add packages/gateway/src/adapters/whatsapp.ts packages/gateway/test/adapters.whatsapp.test.ts
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "feat(gateway): WhatsApp 适配器（Baileys 扫码 + 编号审批按钮）"
```
Expected: tsc 通过（若 Baileys 6.x 类型与计划代码有出入，以实际类型为准微调——例如 `AnyMessageContent` 从何处导出、`WASocket` 泛型参数——不改行为）。

---

## Task 3: Telegram 适配器（grammY）

**Files:**
- Create: `packages/gateway/src/adapters/telegram.ts`
- Create: `packages/gateway/test/adapters.telegram.test.ts`

- [ ] **Step 1: 写失败测试 `test/adapters.telegram.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { buttonRows, normalizeTelegramMessage } from '../src/adapters/telegram.js';

describe('normalizeTelegramMessage', () => {
  it('文本消息 → NormalizedMessage（chatId/userId 字符串化）', () => {
    const ctx = { chat: { id: 12345 }, from: { id: 678 }, message: { text: 'hello' } };
    const out = normalizeTelegramMessage(ctx as never);
    expect(out).toMatchObject({ chatId: '12345', userId: '678', text: 'hello' });
  });
  it('无文本返回 null', () => {
    expect(normalizeTelegramMessage({ chat: { id: 1 }, from: { id: 2 }, message: { photo: [] } } as never)).toBeNull();
  });
});

describe('buttonRows（InlineKeyboard 数据）', () => {
  it('按钮 → [label, id] 行', () => {
    expect(buttonRows([
      { id: 'approve:r1', label: '✅ 同意' },
      { id: 'reject:r1', label: '🚫 拒绝' },
    ])).toEqual([
      ['✅ 同意', 'approve:r1'],
      ['🚫 拒绝', 'reject:r1'],
    ]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/gateway/test/adapters.telegram.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 写 `src/adapters/telegram.ts`**

```ts
import { Bot, InlineKeyboard } from 'grammy';
import type { Adapter, NormalizedMessage, OutboundButton, OutboundPayload } from '../adapter.js';

// ── 纯函数 ────────────────────────────────────────────────────

export interface RawTelegramMessage {
  chat?: { id?: number | string };
  from?: { id?: number | string };
  message?: { text?: string };
}

export function normalizeTelegramMessage(raw: RawTelegramMessage): NormalizedMessage | null {
  const text = raw.message?.text;
  if (!text || raw.chat?.id === undefined || raw.from?.id === undefined) return null;
  return {
    chatId: String(raw.chat.id),
    userId: String(raw.from.id),
    text,
  };
}

export function buttonRows(buttons: OutboundButton[]): Array<[string, string]> {
  return buttons.map((b) => [b.label, b.id]);
}

// ── 适配器 ────────────────────────────────────────────────────

export interface TelegramAdapterOptions { token: string; }

export class TelegramAdapter implements Adapter {
  readonly id = 'telegram';
  private readonly bot: Bot;
  private messageCb?: (msg: NormalizedMessage) => void;
  private replyCb?: (buttonId: string) => void;

  constructor(opts: TelegramAdapterOptions) {
    this.bot = new Bot(opts.token);
  }

  async connect(): Promise<void> {
    await this.bot.api.getMe(); // 校验 token
    this.bot.on('message', (ctx) => {
      const msg = normalizeTelegramMessage(ctx as never);
      if (msg) this.messageCb?.(msg);
    });
    this.bot.on('callback_query:data', async (ctx) => {
      const data = ctx.callbackQuery.data;
      await ctx.answerCallbackQuery().catch(() => undefined);
      this.replyCb?.(data);
    });
    this.bot.catch((err) => console.error('[telegram]', err));
    void this.bot.start(); // 长轮询（自托管无需 webhook）
  }

  async send(chatId: string, payload: OutboundPayload): Promise<void> {
    if (payload.buttons?.length) {
      const kb = new InlineKeyboard();
      for (const [label, id] of buttonRows(payload.buttons)) kb.text(label, id);
      await this.bot.api.sendMessage(chatId, payload.text, { reply_markup: kb });
      return;
    }
    await this.bot.api.sendMessage(chatId, payload.text);
  }

  onMessage(cb: (msg: NormalizedMessage) => void): void { this.messageCb = cb; }
  onReply(cb: (buttonId: string) => void): void { this.replyCb = cb; }
}
```

- [ ] **Step 4: 跑测试确认通过 + 类型检查 + 提交**

```bash
npx vitest run packages/gateway/test/adapters.telegram.test.ts
npm run build
git add packages/gateway/src/adapters/telegram.ts packages/gateway/test/adapters.telegram.test.ts
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "feat(gateway): Telegram 适配器（grammY 长轮询 + inline 审批按钮）"
```
Expected: 2 组测试 PASS；tsc 通过（grammY 类型以实际为准微调，不改行为）。

---

## Task 4: Discord 适配器（discord.js 14）

**Files:**
- Create: `packages/gateway/src/adapters/discord.ts`
- Create: `packages/gateway/test/adapters.discord.test.ts`

- [ ] **Step 1: 写失败测试 `test/adapters.discord.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { discordComponents, normalizeDiscordMessage } from '../src/adapters/discord.js';

describe('normalizeDiscordMessage', () => {
  it('文本消息 → NormalizedMessage', () => {
    const raw = { channelId: '111', author: { id: '222', bot: false }, content: 'hello' };
    const out = normalizeDiscordMessage(raw);
    expect(out).toMatchObject({ chatId: '111', userId: '222', text: 'hello' });
  });
  it('bot 消息返回 null', () => {
    expect(normalizeDiscordMessage({ channelId: '1', author: { id: '2', bot: true }, content: 'x' })).toBeNull();
  });
});

describe('discordComponents（按钮 action row 数据）', () => {
  it('按钮 → discord components 结构', () => {
    const comps = discordComponents([
      { id: 'approve:r1', label: '✅ 同意' },
      { id: 'reject:r1', label: '🚫 拒绝' },
    ]);
    expect(comps).toEqual([{
      type: 1,
      components: [
        { type: 2, custom_id: 'approve:r1', label: '✅ 同意', style: 1 },
        { type: 2, custom_id: 'reject:r1', label: '🚫 拒绝', style: 1 },
      ],
    }]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/gateway/test/adapters.discord.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 写 `src/adapters/discord.ts`**

```ts
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
}

export function normalizeDiscordMessage(raw: RawDiscordMessage): NormalizedMessage | null {
  if (!raw.channelId || !raw.author?.id || raw.author.bot) return null;
  if (!raw.content) return null;
  return { chatId: raw.channelId, userId: raw.author.id, text: raw.content };
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
  private messageCb?: (msg: NormalizedMessage) => void;
  private replyCb?: (buttonId: string) => void;

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
    this.client.once(Events.ClientReady, () => console.log('[discord] 已连接 Discord'));
    this.client.on(Events.MessageCreate, (m: Message) => {
      const msg = normalizeDiscordMessage(m as never);
      if (msg) this.messageCb?.(msg);
    });
    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isButton()) return;
      const button = interaction as ButtonInteraction;
      await button.deferUpdate().catch(() => undefined);
      this.replyCb?.(button.customId);
    });
  }

  async send(chatId: string, payload: OutboundPayload): Promise<void> {
    const channel = await this.client.channels.fetch(chatId);
    if (!channel || !('send' in channel)) {
      console.error(`[discord] 无法向 ${chatId} 发送（channel 不可用）`);
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
  onReply(cb: (buttonId: string) => void): void { this.replyCb = cb; }
}
```

- [ ] **Step 4: 跑测试确认通过 + 类型检查 + 提交**

```bash
npx vitest run packages/gateway/test/adapters.discord.test.ts
npm run build
git add packages/gateway/src/adapters/discord.ts packages/gateway/test/adapters.discord.test.ts
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "feat(gateway): Discord 适配器（discord.js 14 + 按钮审批）"
```
Expected: 2 组测试 PASS；tsc 通过（discord.js 类型以实际为准微调，不改行为）。

---

## Task 5: Slack 适配器（Bolt Socket Mode）

**Files:**
- Create: `packages/gateway/src/adapters/slack.ts`
- Create: `packages/gateway/test/adapters.slack.test.ts`

- [ ] **Step 1: 写失败测试 `test/adapters.slack.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { normalizeSlackMessage, slackBlocks } from '../src/adapters/slack.js';

describe('normalizeSlackMessage', () => {
  it('文本消息 → NormalizedMessage', () => {
    const raw = { channel: 'C123', user: 'U456', text: 'hello', subtype: undefined };
    const out = normalizeSlackMessage(raw);
    expect(out).toMatchObject({ chatId: 'C123', userId: 'U456', text: 'hello' });
  });
  it('bot 自己的消息（subtype=bot_message）返回 null', () => {
    expect(normalizeSlackMessage({ channel: 'C1', user: 'U2', text: 'x', subtype: 'bot_message' })).toBeNull();
  });
});

describe('slackBlocks', () => {
  it('纯文本 → 一个 section', () => {
    const blocks = slackBlocks('hi', []);
    expect(blocks).toEqual([{ type: 'section', text: { type: 'mrkdwn', text: 'hi' } }]);
  });
  it('带按钮 → section + actions', () => {
    const blocks = slackBlocks('需要批准', [
      { id: 'approve:r1', label: '✅ 同意' },
      { id: 'reject:r1', label: '🚫 拒绝' },
    ]);
    expect(blocks[1]).toMatchObject({
      type: 'actions',
      elements: [
        { type: 'button', value: 'approve:r1', text: { type: 'plain_text', text: '✅ 同意' } },
        { type: 'button', value: 'reject:r1', text: { type: 'plain_text', text: '🚫 拒绝' } },
      ],
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/gateway/test/adapters.slack.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 写 `src/adapters/slack.ts`**

```ts
import { App } from '@slack/bolt';
import type { Adapter, NormalizedMessage, OutboundButton, OutboundPayload } from '../adapter.js';

// ── 纯函数 ────────────────────────────────────────────────────

export interface RawSlackMessage {
  channel?: string;
  user?: string;
  text?: string;
  subtype?: string;
  bot_id?: string;
}

export function normalizeSlackMessage(raw: RawSlackMessage): NormalizedMessage | null {
  if (!raw.channel || !raw.user || raw.subtype === 'bot_message' || raw.bot_id) return null;
  if (!raw.text) return null;
  return { chatId: raw.channel, userId: raw.user, text: raw.text };
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
  private readonly app: App;
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
}
```

- [ ] **Step 4: 跑测试确认通过 + 类型检查 + 提交**

```bash
npx vitest run packages/gateway/test/adapters.slack.test.ts
npm run build
git add packages/gateway/src/adapters/slack.ts packages/gateway/test/adapters.slack.test.ts
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "feat(gateway): Slack 适配器（Bolt Socket Mode + actions 审批按钮）"
```
Expected: 2 组测试 PASS；tsc 通过（Bolt 类型以实际为准微调，不改行为）。

---

## Task 6: Gateway 多适配器装配

**Files:**
- Modify: `packages/gateway/src/index.ts`
- Create: `packages/gateway/test/multi.test.ts`

- [ ] **Step 1: 写失败测试 `test/multi.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { wireAdapter } from '../src/index.js';
import { GatewayClient } from '@dsh-overdrive/sdk';
import type { Adapter, NormalizedMessage, OutboundPayload } from '../src/adapter.js';

/** 可编程 FakeAdapter：验证 wiring 逻辑（白名单/会话键/错误兜底）。 */
class FakeAdapter implements Adapter {
  readonly id: string;
  readonly sent: Array<{ chatId: string; payload: OutboundPayload }> = [];
  private messageCb?: (msg: NormalizedMessage) => void;
  private replyCb?: (buttonId: string) => void;
  constructor(id: string) { this.id = id; }
  async connect(): Promise<void> {}
  async send(chatId: string, payload: OutboundPayload): Promise<void> { this.sent.push({ chatId, payload }); }
  onMessage(cb: (msg: NormalizedMessage) => void): void { this.messageCb = cb; }
  onReply(cb: (buttonId: string) => void): void { this.replyCb = cb; }
  /** 测试助手 */
  emit(msg: NormalizedMessage): void { this.messageCb?.(msg); }
  click(buttonId: string): void { this.replyCb?.(buttonId); }
}

/** 假 DSH：记录调用。 */
function fakeClient() {
  const upserts: Array<{ platform: string; channel: string; user: string }> = [];
  const messages: Array<{ sessionId: string; text: string }> = [];
  const approvals: Array<{ reqId: string; decision: string }> = [];
  const client = {
    upsertSession: async (req: { platform: string; channel: string; user: string }) => {
      upserts.push(req);
      return { sessionId: `${req.platform}:${req.channel}:${req.user}` };
    },
    sendMessage: async (sessionId: string, req: { text: string }) => {
      messages.push({ sessionId, text: req.text });
      return { runId: 'r1' };
    },
    resolveApproval: async (reqId: string, decision: 'approve' | 'reject') => {
      approvals.push({ reqId, decision });
      return { ok: true };
    },
  } as unknown as GatewayClient;
  return { client, upserts, messages, approvals };
}

describe('wireAdapter（多适配器装配核心）', () => {
  it('白名单拦截并回错误文本', async () => {
    const adapter = new FakeAdapter('telegram');
    const { client } = fakeClient();
    await wireAdapter(adapter, client, { allowlist: ['telegram:111:222'] });

    adapter.emit({ chatId: '999', userId: '999', text: 'hi' });
    expect(adapter.sent[0].payload.text).toContain('⛔');
  });

  it('白名单内消息 → upsert + sendMessage', async () => {
    const adapter = new FakeAdapter('telegram');
    const { client, upserts, messages } = fakeClient();
    await wireAdapter(adapter, client, { allowlist: ['telegram:111:222'] });

    adapter.emit({ chatId: '111', userId: '222', text: 'hello' });
    expect(upserts).toEqual([{ platform: 'telegram', channel: '111', user: '222' }]);
    expect(messages).toEqual([{ sessionId: 'telegram:111:222', text: 'hello' }]);
  });

  it('按钮点击 → resolveApproval', async () => {
    const adapter = new FakeAdapter('discord');
    const { client, approvals } = fakeClient();
    await wireAdapter(adapter, client, { allowlist: [] });

    adapter.click('approve:r1');
    expect(approvals).toEqual([{ reqId: 'r1', decision: 'approve' }]);
  });

  it('DSH 调用失败 → 回错误文本（不崩溃）', async () => {
    const adapter = new FakeAdapter('slack');
    const client = {
      upsertSession: async () => { throw new Error('dsh down'); },
    } as unknown as GatewayClient;
    await wireAdapter(adapter, client, { allowlist: [] });

    adapter.emit({ chatId: 'C1', userId: 'U1', text: 'hi' });
    expect(adapter.sent[0].payload.text).toContain('❌');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/gateway/test/multi.test.ts
```
Expected: FAIL（`wireAdapter` 不存在）。

- [ ] **Step 3: 重构 `src/index.ts`（提取 wireAdapter + 多适配器 main）**

把 `main()` 里的单适配器接线逻辑提取为可测的 `wireAdapter(adapter, client, opts)`，main 遍历 `GATEWAY_ADAPTERS` 装载：

```ts
import { GatewayClient, type ServerEvent } from '@dsh-overdrive/sdk';
import type { Adapter, OutboundPayload } from './adapter.js';
import { Allowlist, buildSessionKey } from './session.js';
import { adapterEnvFromProcess, createAdapter, parseAdapterIds } from './config.js';
import { CliAdapter } from './adapters/cli.js';

// …… planOutbound 保持不变（事件 → 平台输出）……

export interface WireOptions {
  allowlist: string[];
}

/** 单个适配器的接线：白名单 → upsert → sendMessage；按钮 → resolveApproval；错误兜底。 */
export async function wireAdapter(
  adapter: Adapter,
  client: GatewayClient,
  opts: WireOptions,
): Promise<void> {
  const allow = new Allowlist(opts.allowlist);
  const chatIds = new Map<string, string>();

  adapter.onMessage(async (msg) => {
    const key = buildSessionKey(adapter.id, msg);
    try {
      if (!allow.allows(key)) {
        await adapter.send(msg.chatId, { text: '⛔ 你不在白名单里。' });
        return;
      }
      chatIds.set(key, msg.chatId);
      await client.upsertSession({ platform: adapter.id, channel: msg.chatId, user: msg.userId });
      await client.sendMessage(key, { text: msg.text, media: msg.media });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await adapter.send(msg.chatId, { text: `❌ 出错了：${message}` }).catch(() => undefined);
    }
  });

  adapter.onReply(async (buttonId) => {
    try {
      const idx = buttonId.indexOf(':');
      if (idx < 0) return;
      const action = buttonId.slice(0, idx) as 'approve' | 'reject';
      const reqId = buttonId.slice(idx + 1);
      if ((action === 'approve' || action === 'reject') && reqId) {
        await client.resolveApproval(reqId, action);
      }
    } catch (error) {
      console.error(`[gateway] resolveApproval 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  const chatIdFor = (sessionId: string): string => {
    const known = chatIds.get(sessionId);
    if (known) return known;
    return sessionId.split(':')[1] ?? sessionId;
  };

  await client.connect((ev) => {
    const out = planOutbound(ev);
    if (out) void adapter.send(chatIdFor(ev.sessionId), out.payload).catch(() => undefined);
  });
}

async function main(): Promise<void> {
  const dshBaseUrl = process.env.DSH_BASE_URL ?? 'http://127.0.0.1:3191';
  const dshToken = process.env.DSH_TOKEN ?? 'dev-token';
  const allowlist = (process.env.ALLOWLIST ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const adapterIds = parseAdapterIds(process.env.GATEWAY_ADAPTERS ?? 'cli');
  const env = adapterEnvFromProcess();

  const client = new GatewayClient(dshBaseUrl, dshToken);
  await client.health(); // 确认 DSH 侧（或 mock）活着

  const adapters: Adapter[] = adapterIds.map((id) => createAdapter(id, env));
  for (const adapter of adapters) {
    await adapter.connect();
    await wireAdapter(adapter, client, { allowlist });
    console.log(`[gateway] ${adapter.id} 适配器已就绪`);
  }

  process.stdout.write(`[gateway] 就绪（适配器: ${adapterIds.join(', ')}）。Ctrl+C 退出。\n`);
}

if (process.argv[1]?.endsWith('index.js')) void main();

// 保留 CLI 的直接导入（E2E 用）
export { CliAdapter };
```

> **注意：** `planOutbound` 的既有定义必须原样保留在文件中（本文件顶部），本任务只改 `main()` 与新增 `wireAdapter`/`WireOptions` 导出。E2E（`test/e2e.mjs`）依赖 `[gateway] 就绪` 文本与 CLI 适配器行为，勿破坏。

- [ ] **Step 4: 跑测试确认通过 + 全量回归 + E2E**

```bash
npx vitest run packages/gateway/test/multi.test.ts
npx vitest run
npm run build
npm run e2e
```
Expected: multi 4 个测试 PASS；全量 PASS；E2E 三条路径仍 PASS（CLI 回归不受影响）。

- [ ] **Step 5: 提交**

```bash
git add packages/gateway/src/index.ts packages/gateway/test/multi.test.ts
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "feat(gateway): 多适配器装配（wireAdapter + GATEWAY_ADAPTERS 环境变量）"
```

---

## Task 7: 手工验收清单 + README 收尾

**Files:**
- Create: `docs/smoke-platforms.md`
- Modify: `README.md`

- [ ] **Step 1: 写 `docs/smoke-platforms.md`（各平台手工验收步骤）**

内容模板（逐平台填写可执行的验收步骤，含凭据获取指引）：

```markdown
# 平台手工验收清单（M2b）

> 前提：`npm run build` 通过；DSH 侧（mock 或真实 dsh+gateway-core）已在跑。
> 启动 gateway：`GATEWAY_ADAPTERS=<ids> ... node packages/gateway/dist/index.js`

## Telegram（最易验证，推荐先做）

1. 在 @BotFather 创建 bot，拿 token：`TELEGRAM_BOT_TOKEN=<token>`
2. 启动：`$env:GATEWAY_ADAPTERS='telegram'; $env:TELEGRAM_BOT_TOKEN='<token>'; $env:ALLOWLIST='telegram:<你的chatId>:<你的userId>'`
3. 给自己 bot 发 "你好"，确认收到 agent 回复
4. 触发审批：发一条含 "dangerous" 的消息（mock 会触发），确认收到【同意/拒绝】inline 按钮，点击后收到执行/拒绝结果

## WhatsApp

1. `$env:GATEWAY_ADAPTERS='whatsapp'; $env:WHATSAPP_DATA_DIR='data/whatsapp'`
2. 启动后终端出现二维码，用 WhatsApp「设置 → 已连接设备 → 扫描」
3. 给自己的号码发 "你好"；`ALLOWLIST='whatsapp:<你的JID>:<你的JID>'`（JID 形如 `60123@s.whatsapp.net`）
4. 审批：发 "dangerous xxx"，确认收到编号选项，回复 "1"/"2" 验证

## Discord

1. Developer Portal 建应用 → Bot → 拿 token；勾选 Message Content Intent
2. `$env:GATEWAY_ADAPTERS='discord'; $env:DISCORD_BOT_TOKEN='<token>'`
3. 私信 bot 或把 bot 拉进服务器发消息；`ALLOWLIST='discord:<频道ID>:<用户ID>'`
4. 审批按钮：点击【同意/拒绝】验证

## Slack

1. api.slack.com 建 App → Socket Mode 开启（拿 app-token `xapp-...`）→ OAuth 安装（拿 bot-token `xoxb-...`），订阅 `message.channels`/`message.im`
2. `$env:GATEWAY_ADAPTERS='slack'; $env:SLACK_BOT_TOKEN='xoxb-...'; $env:SLACK_APP_TOKEN='xapp-...'`
3. 私信 bot；`ALLOWLIST='slack:<频道ID>:<用户ID>'`
4. 审批按钮：点击验证

## 通用检查

- [ ] 普通消息往返（平台 → agent → 平台）
- [ ] 审批按钮/编号回复往返
- [ ] 白名单外用户收到 ⛔
- [ ] 重启 gateway 后 WhatsApp 免重新扫码（auth 目录持久化）
```

- [ ] **Step 2: 更新 README 进度段**

在 `## 当前进度（M2 完成）` 下新增：

```markdown
- ✅ M2b：国际平台适配器（WhatsApp 扫码 / Telegram / Discord / Slack），多适配器并发
- 📋 平台手工验收清单：`docs/smoke-platforms.md`
```

并把 `⏳ 平台适配器（WhatsApp/Telegram/…）见 M2b 计划` 一行删除。

- [ ] **Step 3: 最终全量验证 + 提交**

```bash
npx vitest run
npm run build
npm run e2e
git add docs/smoke-platforms.md README.md
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "docs: M2b 平台手工验收清单 + README 更新"
git log --oneline
```
Expected: 全量 PASS、E2E PASS；git log 显示本计划全部 commit。

---

## Self-Review 结果

- **Spec 覆盖：** 设计文档 §5 组件（gateway 适配器）、§7 数据流（平台 → 会话 → 事件 → 平台）、§8 安全（白名单/审批默认拒绝）——T2-T6 全覆盖；§11 首发平台（WhatsApp/Telegram/Discord/Slack）——T2-T5；§13 M2——本计划。
- **占位符扫描：** 无 TBD/TODO；四个适配器的"手工验收"是明确的测试策略与验收路径（计划 Task 7 产出文档），非占位。Baileys 7.0-rc 与 Bolt 版本号有明确备选与验证步骤（T1 Step 2）。
- **类型一致性：** `Adapter`/`NormalizedMessage`/`OutboundPayload`/`OutboundButton` 沿用既有契约；`wireAdapter` 签名与 multi 测试一致；`planOutbound` 原样保留；会话键按 `adapter.id` 前缀天然隔离。
- **风险暴露：** WhatsApp 审批按钮采用编号文本方案（M2b 内可验证）；若验收发现 Baileys 6.x 的 `AnyMessageContent`/`interactive` 需调整，改动集中在 `send()` 一个方法内。discord.js 的 `MessageContent` intent 与 Discord 开发者后台配置在验收清单中已注明。
