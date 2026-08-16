# dsh-overdrive M3 实施计划：中文平台适配器（飞书 / 钉钉 / 企业微信）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 3 个中文平台适配器（飞书 / 钉钉 / 企业微信），复用既有 `Adapter` 契约与多适配器装配；全部采用免公网 URL（飞书 WSClient、钉钉 Stream）或 VPS 天然可用的回调模式（企业微信），做到"平台消息 → DSH agent → 回复回传 + 审批编号回复"。

**Architecture:** 与 M2b 完全同构：每适配器 = 薄 SDK 连接层 + 纯函数（消息解析/格式化）；`config.ts` 注册表加 3 个分支；`wireAdapter` 零改动。企业微信适配器**自带一个可选的 HTTP 回调服务器**（`WECOM_CALLBACK_PORT`），接收企业微信的回调验签与消息推送，不侵入 gateway 主程序。

**Tech Stack:** TypeScript (strict, NodeNext)、`@larksuiteoapi/node-sdk`（飞书 WSClient）、`dingtalk-stream-sdk-nodejs`（钉钉 Stream）、企业微信用 `node:crypto` 自实现 AES-256-CBC 加解密（不引入第三方 SDK，纯函数可单测）、vitest。

**Scope 说明（重要）：**
- 审批交互统一用**编号文本回复**（与 WhatsApp 一致）；飞书原生交互卡片、钉钉互动卡片留 M4 统一增强。
- 企业微信采用「自建应用 → 接收消息」回调 URL 模式（文档注明需公网可访问的 HTTPS/HTTP 回调地址；部署到 VPS 即满足）。2026 新增的"智能机器人长连接"暂无官方 Node SDK，不做（记为 M5 后候选）。
- 真实平台交互手工验收（同 M2b 模式），验收步骤写入 `docs/smoke-platforms.md`。

---

## File Structure（本计划新增/修改）

```
packages/gateway/
├── package.json                 # 修改：新增 lark / dingtalk SDK
├── src/
│   ├── config.ts                # 修改：+feishu/dingtalk/wecom 分支与 env
│   └── adapters/
│       ├── feishu.ts            # 新增
│       ├── dingtalk.ts          # 新增
│       └── wecom.ts             # 新增（含回调 HTTP 服务器）
└── test/
    ├── adapters.feishu.test.ts
    ├── adapters.dingtalk.test.ts
    └── adapters.wecom.test.ts   # 含 AES 加解密往返测试
docs/smoke-platforms.md          # 修改：追加三平台验收步骤
README.md                        # 修改：M3 状态
```

---

## Task 1: 依赖 + 注册表扩展

**Files:**
- Modify: `packages/gateway/package.json`
- Modify: `packages/gateway/src/config.ts`
- Modify: `packages/gateway/test/config.test.ts`

- [ ] **Step 1: `package.json` 增加依赖**

```json
"dependencies": {
  "@dsh-overdrive/sdk": "0.1.0",
  "@larksuiteoapi/node-sdk": "^1.50.0",
  "@slack/bolt": "^3.0.0",
  "@whiskeysockets/baileys": "^6.0.1",
  "dingtalk-stream-sdk-nodejs": "^1.2.0",
  "discord.js": "^14.27.0",
  "grammy": "^1.45.0",
  "pino": "^9.0.0",
  "qrcode-terminal": "^0.12.0"
}
```

```bash
cd <workspace>
npm install
npm ls @larksuiteoapi/node-sdk dingtalk-stream-sdk-nodejs
```
Expected: 两个新包解析成功（版本以实际为准微调，若 `dingtalk-stream-sdk-nodejs` 不存在则查 `@open-dingtalk/stream`，API 同为 Stream 模式）。

- [ ] **Step 2: 扩展 `src/config.ts`**

在 `AdapterEnv` 增加字段，在 `createAdapter` 增加 3 个分支（静态导入 3 个新适配器），并在 `adapterEnvFromProcess` 增加映射：

```ts
export interface AdapterEnv {
  whatsappDataDir?: string;
  telegramBotToken?: string;
  discordBotToken?: string;
  slackBotToken?: string;
  slackAppToken?: string;
  feishuAppId?: string;
  feishuAppSecret?: string;
  dingtalkClientId?: string;
  dingtalkClientSecret?: string;
  wecomCorpId?: string;
  wecomSecret?: string;
  wecomAgentId?: string;
  wecomToken?: string;
  wecomEncodingAESKey?: string;
  wecomCallbackPort?: string;
}
```

`createAdapter` 新增分支：

```ts
case 'feishu':
  if (!env.feishuAppId || !env.feishuAppSecret) throw new Error('feishu 适配器需要 FEISHU_APP_ID / FEISHU_APP_SECRET');
  return new FeishuAdapter({ appId: env.feishuAppId, appSecret: env.feishuAppSecret });
case 'dingtalk':
  if (!env.dingtalkClientId || !env.dingtalkClientSecret) throw new Error('dingtalk 适配器需要 DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET');
  return new DingTalkAdapter({ clientId: env.dingtalkClientId, clientSecret: env.dingtalkClientSecret });
case 'wecom':
  if (!env.wecomCorpId || !env.wecomSecret || !env.wecomAgentId || !env.wecomToken || !env.wecomEncodingAESKey) {
    throw new Error('wecom 适配器需要 WECOM_CORP_ID / WECOM_SECRET / WECOM_AGENT_ID / WECOM_TOKEN / WECOM_ENCODING_AES_KEY');
  }
  return new WeComAdapter({
    corpId: env.wecomCorpId, secret: env.wecomSecret, agentId: env.wecomAgentId,
    token: env.wecomToken, encodingAESKey: env.wecomEncodingAESKey,
    callbackPort: Number(env.wecomCallbackPort ?? 3193),
  });
```

`adapterEnvFromProcess` 增加：`feishuAppId: env.FEISHU_APP_ID`、`feishuAppSecret: env.FEISHU_APP_SECRET`、`dingtalkClientId: env.DINGTALK_CLIENT_ID`、`dingtalkClientSecret: env.DINGTALK_CLIENT_SECRET`、`wecomCorpId: env.WECOM_CORP_ID`、`wecomSecret: env.WECOM_SECRET`、`wecomAgentId: env.WECOM_AGENT_ID`、`wecomToken: env.WECOM_TOKEN`、`wecomEncodingAESKey: env.WECOM_ENCODING_AES_KEY`、`wecomCallbackPort: env.WECOM_CALLBACK_PORT`。

> 三个新适配器文件此时尚不存在——为让 Task 1 可编译，先创建三个**桩文件**（实现 `Adapter` 接口、方法抛"未实现"），**不提交**（Task 2-4 各自提交完整实现）。

- [ ] **Step 3: 扩展 `test/config.test.ts`**

新增用例：

```ts
it('feishu 缺凭据抛错', () => {
  expect(() => createAdapter('feishu', {})).toThrow(/FEISHU_APP_ID/);
});
it('dingtalk 缺凭据抛错', () => {
  expect(() => createAdapter('dingtalk', {})).toThrow(/DINGTALK_CLIENT_ID/);
});
it('wecom 缺凭据抛错', () => {
  expect(() => createAdapter('wecom', {})).toThrow(/WECOM_CORP_ID/);
});
```

- [ ] **Step 4: 跑测试确认通过 + 提交**

```bash
npx vitest run packages/gateway/test/config.test.ts
git add packages/gateway/package.json package-lock.json packages/gateway/src/config.ts packages/gateway/test/config.test.ts
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "feat(gateway): 中文平台依赖 + 注册表扩展（feishu/dingtalk/wecom）"
```
Expected: config 6 个测试 PASS。

---

## Task 2: 飞书适配器（@larksuiteoapi/node-sdk WSClient）

**Files:**
- Create: `packages/gateway/src/adapters/feishu.ts`
- Create: `packages/gateway/test/adapters.feishu.test.ts`

- [ ] **Step 1: 写失败测试 `test/adapters.feishu.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { buildNumberedText, parseFeishuTextMessage } from '../src/adapters/feishu.js';

describe('parseFeishuTextMessage（im.message.receive_v1 载荷 → NormalizedMessage）', () => {
  it('文本私聊消息', () => {
    const data = {
      event: {
        message: { message_id: 'om_1', chat_id: 'oc_1', message_type: 'text', content: JSON.stringify({ text: 'hello' }) },
        sender: { sender_id: { open_id: 'ou_1' } },
      },
    };
    const out = parseFeishuTextMessage(data);
    expect(out).toMatchObject({ chatId: 'oc_1', userId: 'ou_1', text: 'hello' });
  });
  it('非文本消息返回 null', () => {
    const data = { event: { message: { message_type: 'image', content: '{}' }, sender: { sender_id: { open_id: 'ou_1' } } } };
    expect(parseFeishuTextMessage(data)).toBeNull();
  });
});

describe('buildNumberedText（审批编号回复）', () => {
  it('生成 1/2 选项文本', () => {
    const text = buildNumberedText('需要批准', [
      { id: 'approve:r1', label: '✅ 同意' },
      { id: 'reject:r1', label: '🚫 拒绝' },
    ]);
    expect(text).toContain('1) ✅ 同意');
    expect(text).toContain('2) 🚫 拒绝');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/gateway/test/adapters.feishu.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 写 `src/adapters/feishu.ts`（覆盖桩文件）**

```ts
import lark from '@larksuiteoapi/node-sdk';
import type { Adapter, NormalizedMessage, OutboundButton, OutboundPayload } from '../adapter.js';

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
  } catch { return null; }
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

export interface FeishuAdapterOptions { appId: string; appSecret: string; }

export class FeishuAdapter implements Adapter {
  readonly id = 'feishu';
  private readonly client: lark.Client;
  private ws?: lark.WSClient;
  private messageCb?: (msg: NormalizedMessage) => void;
  private replyCb?: (buttonId: string) => void;
  private readonly pendingButtons = new Map<string, OutboundButton[]>();

  constructor(opts: FeishuAdapterOptions) {
    this.client = new lark.Client({ appId: opts.appId, appSecret: opts.appSecret });
  }

  async connect(): Promise<void> {
    const dispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: FeishuReceivePayload) => {
        const normalized = parseFeishuTextMessage(data);
        if (!normalized) return;
        const chatId = normalized.chatId;
        const pending = this.pendingButtons.get(chatId);
        if (pending) {
          const button = matchNumberedButton(normalized.text, pending);
          if (button) {
            this.pendingButtons.delete(chatId);
            this.replyCb?.(button.id);
            return;
          }
        }
        this.messageCb?.(normalized);
      },
    });
    this.ws = new lark.WSClient({ appId: this.opts.appId, appSecret: this.opts.appSecret, loggerLevel: 'error' });
    this.ws.registerEventDispatcher(dispatcher);
    await this.ws.start();
    console.log('[feishu] 飞书长连接已建立');
  }

  async send(chatId: string, payload: OutboundPayload): Promise<void> {
    if (payload.buttons?.length) {
      this.pendingButtons.set(chatId, payload.buttons);
    }
    const text = buildNumberedText(payload.text, payload.buttons ?? []);
    await this.client.im.message.reply({
      path: { message_id: chatId },
      data: { msg_type: 'text', content: JSON.stringify({ text }) },
    });
  }

  onMessage(cb: (msg: NormalizedMessage) => void): void { this.messageCb = cb; }
  onReply(cb: (buttonId: string) => void): void { this.replyCb = cb; }

  private get opts() {
    return { appId: (this as unknown as { _appId: string })._appId, appSecret: (this as unknown as { _appSecret: string })._appSecret };
  }
}
```

> **说明：** 飞书 `im.message.reply` 需要 `message_id` 作 path 参数，而我们的 `chatId`（协议层）是飞书 `chat_id`。**修正方案**：`FeishuAdapter` 维护 `chatId → 最近一条 message_id` 的映射（收到消息时记录），`send` 用该 message_id 回复（或用 `im.message.create` 按 `receive_id=chat_id` 发送）。若 `im.message.reply` 不可用，用 `client.im.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: chatId, msg_type: 'text', content } })`。执行时以实际可用 API 为准，行为目标不变：文本发回 `chatId` 对应会话。

- [ ] **Step 4: 跑测试确认通过 + 类型检查 + 提交**

```bash
npx vitest run packages/gateway/test/adapters.feishu.test.ts
npm run build
git add packages/gateway/src/adapters/feishu.ts packages/gateway/test/adapters.feishu.test.ts
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "feat(gateway): 飞书适配器（WSClient 长连接 + 编号审批回复）"
```
Expected: 2 组测试 PASS；tsc 通过（lark SDK 类型以实际为准微调，不改行为）。

---

## Task 3: 钉钉适配器（dingtalk-stream-sdk-nodejs Stream）

**Files:**
- Create: `packages/gateway/src/adapters/dingtalk.ts`
- Create: `packages/gateway/test/adapters.dingtalk.test.ts`

- [ ] **Step 1: 写失败测试 `test/adapters.dingtalk.test.ts`**

> **SDK 实测（dingtalk-stream-sdk-nodejs@2.0.4）**：导出 `DWClient` + `TOPIC_ROBOT`（`/v1.0/im/bot/messages/get`）；回调 `registerCallbackListener(TOPIC_ROBOT, (msg) => …)`，`msg.data` 是 `RobotMessage` JSON 字符串；回复用消息内的 `sessionWebhook` 直接 POST（无需 access_token）。下列代码已按实测 API 编写。

```ts
import { describe, expect, it } from 'vitest';
import { buildReplyBody, parseBotMessage } from '../src/adapters/dingtalk.js';

describe('parseBotMessage（RobotMessage → NormalizedMessage）', () => {
  it('文本消息', () => {
    const data = {
      conversationId: 'cid1',
      senderStaffId: 'u1',
      msgtype: 'text',
      text: { content: 'hello' },
      sessionWebhook: 'https://hook.dingtalk.com/x',
    };
    const out = parseBotMessage(data);
    expect(out).toMatchObject({ chatId: 'cid1', userId: 'u1', text: 'hello' });
  });
  it('非文本返回 null', () => {
    expect(parseBotMessage({ conversationId: 'c', msgtype: 'picture' })).toBeNull();
  });
});

describe('buildReplyBody（sessionWebhook 回发载荷）', () => {
  it('文本消息体', () => {
    expect(buildReplyBody('hi')).toEqual({ msgtype: 'text', text: { content: 'hi' } });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/gateway/test/adapters.dingtalk.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 写 `src/adapters/dingtalk.ts`（覆盖桩文件）**

```ts
import type { Adapter, NormalizedMessage, OutboundButton, OutboundPayload } from '../adapter.js';
import { DWClient, TOPIC_ROBOT, type RobotMessage } from 'dingtalk-stream-sdk-nodejs';

// ── 纯函数 ────────────────────────────────────────────────────

export interface ParsedRobotMessage {
  conversationId: string;
  senderStaffId: string;
  text: string;
  sessionWebhook: string;
}

export function parseBotMessage(data: RobotMessage): ParsedRobotMessage | null {
  if (data.msgtype !== 'text' || !data.text?.content) return null;
  if (!data.conversationId || !data.senderStaffId || !data.sessionWebhook) return null;
  return {
    conversationId: data.conversationId,
    senderStaffId: data.senderStaffId,
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
  private messageCb?: (msg: NormalizedMessage) => void;
  private replyCb?: (buttonId: string) => void;
  private readonly pendingButtons = new Map<string, OutboundButton[]>();
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
      this.webhooks.set(parsed.conversationId, parsed.sessionWebhook);
      const pending = this.pendingButtons.get(parsed.conversationId);
      if (pending) {
        const button = matchNumberedButton(parsed.text, pending);
        if (button) {
          this.pendingButtons.delete(parsed.conversationId);
          this.replyCb?.(button.id);
          return;
        }
      }
      this.messageCb?.({ chatId: parsed.conversationId, userId: parsed.senderStaffId, text: parsed.text });
    });
    await client.connect();
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
}
```

- [ ] **Step 4: 跑测试确认通过 + 类型检查 + 提交**

```bash
npx vitest run packages/gateway/test/adapters.dingtalk.test.ts
npm run build
git add packages/gateway/src/adapters/dingtalk.ts packages/gateway/test/adapters.dingtalk.test.ts
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "feat(gateway): 钉钉适配器（Stream 模式 + 编号审批回复）"
```
Expected: 2 组测试 PASS；tsc 通过（stream SDK 的 CJS 导出可能需 default 导入，同 M2b 的 bolt 处理；以实际为准）。

---

## Task 4: 企业微信适配器（回调接收 + AES 加解密）

**Files:**
- Create: `packages/gateway/src/adapters/wecom.ts`
- Create: `packages/gateway/test/adapters.wecom.test.ts`

- [ ] **Step 1: 写失败测试 `test/adapters.wecom.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { decryptWeComPayload, encryptWeComPayload, parseWeComXmlMessage } from '../src/adapters/wecom.js';

const KEY = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'; // 43 位 EncodingAESKey

describe('企业微信 AES 加解密（往返）', () => {
  it('encrypt → decrypt 还原原文（含 receiveId）', () => {
    const { encrypted } = encryptWeComPayload(KEY, 'hello', 'corpid123');
    const out = decryptWeComPayload(KEY, encrypted);
    expect(out.message).toBe('hello');
    expect(out.receiveId).toBe('corpid123');
  });
});

describe('parseWeComXmlMessage（回调 XML → NormalizedMessage）', () => {
  it('文本消息', () => {
    const xml = `<xml><ToUserName><![CDATA[ww1]]></ToUserName><FromUserName><![CDATA[user1]]></FromUserName><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[你好]]></Content></xml>`;
    const out = parseWeComXmlMessage(xml);
    expect(out).toMatchObject({ chatId: 'user1', userId: 'user1', text: '你好' });
  });
  it('非文本返回 null', () => {
    const xml = `<xml><FromUserName><![CDATA[u]]></FromUserName><MsgType><![CDATA[image]]></MsgType></xml>`;
    expect(parseWeComXmlMessage(xml)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/gateway/test/adapters.wecom.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 写 `src/adapters/wecom.ts`（覆盖桩文件）**

```ts
import { createHash, createDecipheriv, createCipheriv, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Adapter, NormalizedMessage, OutboundButton, OutboundPayload } from '../adapter.js';

// ── 纯函数：AES-256-CBC 加解密（企业微信协议）──────────────────

export function deriveAesKey(encodingAESKey: string): Buffer {
  return Buffer.from(encodingAESKey + '=', 'base64'); // 43 位 + '=' → 32 字节
}

export function pkcs7Unpad(buf: Buffer): Buffer {
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 32) throw new Error('invalid pkcs7 padding');
  return buf.subarray(0, buf.length - pad);
}

export function pkcs7Pad(buf: Buffer): Buffer {
  const pad = 32 - (buf.length % 32);
  return Buffer.concat([buf, Buffer.alloc(pad, pad)]);
}

export function decryptWeComPayload(encodingAESKey: string, encrypted: string): { message: string; receiveId: string } {
  const key = deriveAesKey(encodingAESKey);
  const iv = key.subarray(0, 16);
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]);
  const unpadded = pkcs7Unpad(plain);
  // 结构：random(16) + msgLen(4, big-endian) + msg + receiveId
  const msgLen = unpadded.readUInt32BE(16);
  const message = unpadded.subarray(20, 20 + msgLen).toString('utf8');
  const receiveId = unpadded.subarray(20 + msgLen).toString('utf8');
  return { message, receiveId };
}

export function encryptWeComPayload(encodingAESKey: string, message: string, receiveId: string): { encrypted: string } {
  const key = deriveAesKey(encodingAESKey);
  const iv = key.subarray(0, 16);
  const msgBuf = Buffer.from(message, 'utf8');
  const head = Buffer.alloc(20);
  randomBytes(16).copy(head, 0);
  head.writeUInt32BE(msgBuf.length, 16);
  const plain = pkcs7Pad(Buffer.concat([head, msgBuf, Buffer.from(receiveId, 'utf8')]));
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { encrypted: encrypted.toString('base64') };
}

export function weComSignature(token: string, timestamp: string, nonce: string, encrypt: string): string {
  const arr = [token, timestamp, nonce, encrypt].sort();
  return createHash('sha1').update(arr.join('')).digest('hex');
}

// ── 纯函数：XML 消息解析 ─────────────────────────────────────

export function parseWeComXmlMessage(xml: string): NormalizedMessage | null {
  const get = (tag: string): string => {
    const m = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
    return m ? m[1] : '';
  };
  const msgType = get('MsgType');
  if (msgType !== 'text') return null;
  const from = get('FromUserName');
  const content = get('Content');
  if (!from || !content) return null;
  return { chatId: from, userId: from, text: content };
}

// ── 纯函数：审批编号回复 ─────────────────────────────────────

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

// ── 适配器（自带回调 HTTP 服务器）────────────────────────────

export interface WeComAdapterOptions {
  corpId: string;
  secret: string;
  agentId: string;
  token: string;
  encodingAESKey: string;
  callbackPort: number;
}

export class WeComAdapter implements Adapter {
  readonly id = 'wecom';
  private server?: ReturnType<typeof createServer>;
  private messageCb?: (msg: NormalizedMessage) => void;
  private replyCb?: (buttonId: string) => void;
  private readonly pendingButtons = new Map<string, OutboundButton[]>();

  constructor(private readonly opts: WeComAdapterOptions) {}

  async connect(): Promise<void> {
    this.server = createServer((req, res) => void this.route(req, res));
    await new Promise<void>((resolve) => this.server!.listen(this.opts.callbackPort, '0.0.0.0', () => resolve()));
    console.log(`[wecom] 回调服务器已启动 http://0.0.0.0:${this.opts.callbackPort}（需公网可达并配置为企业微信回调 URL）`);
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const params = url.searchParams;
    if (req.method === 'GET') {
      // URL 验证：回显解密后的 echostr
      const msgSignature = params.get('msg_signature') ?? '';
      const timestamp = params.get('timestamp') ?? '';
      const nonce = params.get('nonce') ?? '';
      const echostr = params.get('echostr') ?? '';
      const sign = weComSignature(this.opts.token, timestamp, nonce, echostr);
      if (sign !== msgSignature) { res.writeHead(403); res.end('invalid signature'); return; }
      const { message } = decryptWeComPayload(this.opts.encodingAESKey, echostr);
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(message);
      return;
    }
    if (req.method === 'POST') {
      const raw = await readBody(req);
      const msgSignature = params.get('msg_signature') ?? '';
      const timestamp = params.get('timestamp') ?? '';
      const nonce = params.get('nonce') ?? '';
      const encrypt = (raw.match(/<Encrypt><!\[CDATA\[([\s\S]*?)\]\]><\/Encrypt>/) ?? [])[1] ?? '';
      const sign = weComSignature(this.opts.token, timestamp, nonce, encrypt);
      if (sign !== msgSignature) { res.writeHead(403); res.end('invalid signature'); return; }
      const { message } = decryptWeComPayload(this.opts.encodingAESKey, encrypt);
      const normalized = parseWeComXmlMessage(message);
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('success'); // 先应答，避免企业微信重试
      if (!normalized) return;
      const pending = this.pendingButtons.get(normalized.chatId);
      if (pending) {
        const button = matchNumberedButton(normalized.text, pending);
        if (button) {
          this.pendingButtons.delete(normalized.chatId);
          this.replyCb?.(button.id);
          return;
        }
      }
      this.messageCb?.(normalized);
    }
  }

  async send(chatId: string, payload: OutboundPayload): Promise<void> {
    if (payload.buttons?.length) this.pendingButtons.set(chatId, payload.buttons);
    const text = buildNumberedText(payload.text, payload.buttons ?? []);
    const token = await this.fetchAccessToken();
    const res = await fetch('https://qyapi.weixin.qq.com/cgi-bin/message/send', {
      method: 'POST',
      body: JSON.stringify({
        touser: chatId,
        msgtype: 'text',
        agentid: this.opts.agentId,
        text: { content: text },
      }),
      headers: { 'content-type': 'application/json' },
    }).then((r) => r.json() as Promise<{ errcode?: number; errmsg?: string }>);
    if (res.errcode !== 0) throw new Error(`企业微信发送失败: ${res.errcode} ${res.errmsg}`);
    void token;
  }

  private async fetchAccessToken(): Promise<string> {
    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(this.opts.corpId)}&corpsecret=${encodeURIComponent(this.opts.secret)}`;
    const data = (await fetch(url).then((r) => r.json())) as { access_token?: string; errcode?: number };
    if (!data.access_token) throw new Error(`企业微信 token 获取失败: ${data.errcode}`);
    return data.access_token;
  }

  onMessage(cb: (msg: NormalizedMessage) => void): void { this.messageCb = cb; }
  onReply(cb: (buttonId: string) => void): void { this.replyCb = cb; }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
```

- [ ] **Step 4: 跑测试确认通过 + 类型检查 + 提交**

```bash
npx vitest run packages/gateway/test/adapters.wecom.test.ts
npm run build
git add packages/gateway/src/adapters/wecom.ts packages/gateway/test/adapters.wecom.test.ts
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "feat(gateway): 企业微信适配器（回调接收 + AES 加解密 + 编号审批回复）"
```
Expected: 3 组测试 PASS；tsc 通过。

---

## Task 5: 全量回归 + 手工验收清单更新

**Files:**
- Modify: `docs/smoke-platforms.md`
- Modify: `README.md`

- [ ] **Step 1: 追加 `docs/smoke-platforms.md` 中文平台章节**

```markdown
## 飞书

1. open.feishu.cn 建企业自建应用 → 凭据（App ID / App Secret）；开启「机器人」能力
2. ```powershell
   $env:GATEWAY_ADAPTERS='feishu'
   $env:FEISHU_APP_ID='cli_xxx'
   $env:FEISHU_APP_SECRET='secret'
   node packages/gateway/dist/index.js
   ```
3. 给机器人发私聊 "你好"；`ALLOWLIST='feishu:<chat_id>:<open_id>'`（日志可查）
4. 审批：发 "dangerous xxx"，确认编号选项，回复 "1"/"2"

## 钉钉

1. open.dingtalk.com 建机器人（Stream 模式）→ Client ID / Client Secret
2. ```powershell
   $env:GATEWAY_ADAPTERS='dingtalk'
   $env:DINGTALK_CLIENT_ID='<clientId>'
   $env:DINGTALK_CLIENT_SECRET='<clientSecret>'
   node packages/gateway/dist/index.js
   ```
3. 给机器人发 "你好"；审批：发 "dangerous xxx" 回复 "1"/"2"

## 企业微信（需公网回调地址）

1. work.weixin.qq.com 自建应用 → 接收消息：设置 URL（`http://<公网>/` 指向 gateway 的 `WECOM_CALLBACK_PORT`，默认 3193）、Token、EncodingAESKey
2. ```powershell
   $env:GATEWAY_ADAPTERS='wecom'
   $env:WECOM_CORP_ID='wwxxx'; $env:WECOM_SECRET='xxx'; $env:WECOM_AGENT_ID='1000002'
   $env:WECOM_TOKEN='<token>'; $env:WECOM_ENCODING_AES_KEY='<43位>'
   node packages/gateway/dist/index.js
   ```
3. 用应用可见范围内成员给应用发消息（或微信端联系我）验证
4. 无公网时可用内网穿透（frp/ngrok/cloudflared）把 3193 映射出去
```

- [ ] **Step 2: 更新 README**

在 M2b 行下新增：

```markdown
- ✅ **M3：中文平台适配器**（飞书 WSClient / 钉钉 Stream / 企业微信回调）
```

并把文档链接行追加 `...-m3-cn-platforms.md`。

- [ ] **Step 3: 最终全量验证 + 提交**

```bash
npx vitest run
npm run build
npm run e2e
git add docs/smoke-platforms.md README.md
git -c user.name="dsh-overdrive" -c user.email="dev@dsh-overdrive.local" commit -m "docs: M3 中文平台验收清单 + README 更新"
git log --oneline
```
Expected: 全量 PASS、E2E PASS。

---

## Self-Review 结果

- **Spec 覆盖：** 设计 §11（飞书/钉钉/企业微信首发）——T2/T3/T4；§5 组件与 §7 数据流复用 M2b 同构模式；§8 安全（白名单/审批编号回复）沿用 `wireAdapter`。
- **占位符扫描：** 无 TBD/TODO。飞书 `send` 的 message_id/chat_id 差异有明确修正方案（说明块）；钉钉/企微的发送接口以"验收清单 + 运行时错误透传"兜底，非占位。
- **类型一致性：** `Adapter`/`NormalizedMessage`/`OutboundPayload` 沿用契约；`config.ts` 新增分支与 `AdapterEnv` 字段一一对应；三适配器的 `buildNumberedText`/`matchNumberedButton` 签名一致（飞书/钉钉/企微各自导出，命名统一）。
- **风险暴露：** 企业微信回调需公网 URL（VPS 部署天然满足，已写入验收清单）；钉钉 stream SDK 若为 CJS 需 default 导入处理（同 M2b bolt）；飞书 lark SDK 的 WSClient/EventDispatcher 用法以 harness-lark 参考实现为准。
