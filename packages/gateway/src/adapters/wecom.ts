import { createHash, createDecipheriv, createCipheriv, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Adapter, NormalizedMessage, OutboundButton, OutboundPayload } from '../adapter.js';
import { PendingButtons } from '../pending-buttons.js';

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
  private connected = false;
  private messageCb?: (msg: NormalizedMessage) => void;
  private replyCb?: (buttonId: string) => void;
  private readonly pendingButtons = new PendingButtons();
  /** access_token 缓存：企业微信 token 有效期 7200s，且有获取频率限制，必须复用。 */
  private tokenCache?: { token: string; expiresAt: number };

  constructor(private readonly opts: WeComAdapterOptions) {}

  async connect(): Promise<void> {
    this.server = createServer((req, res) => void this.route(req, res));
    await new Promise<void>((resolve) => this.server!.listen(this.opts.callbackPort, '0.0.0.0', () => resolve()));
    this.connected = true;
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
      const button = this.pendingButtons.match(normalized.chatId, normalized.text);
      if (button) {
        this.replyCb?.(button.id);
        return;
      }
      this.messageCb?.(normalized);
    }
  }

  async send(chatId: string, payload: OutboundPayload): Promise<void> {
    if (payload.buttons?.length) this.pendingButtons.set(chatId, payload.buttons);
    const text = buildNumberedText(payload.text, payload.buttons ?? []);
    const token = await this.fetchAccessToken();
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`, {
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
  }

  private async fetchAccessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) return this.tokenCache.token;
    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(this.opts.corpId)}&corpsecret=${encodeURIComponent(this.opts.secret)}`;
    const data = (await fetch(url).then((r) => r.json())) as { access_token?: string; errcode?: number };
    if (!data.access_token) throw new Error(`企业微信 token 获取失败: ${data.errcode}`);
    // 官方有效期 7200s；留 200s 余量，避免临界过期
    this.tokenCache = { token: data.access_token, expiresAt: Date.now() + 7_000_000 };
    return data.access_token;
  }

  onMessage(cb: (msg: NormalizedMessage) => void): void { this.messageCb = cb; }
  onReply(cb: (buttonId: string) => void): void { this.replyCb = cb; }
  status(): { connected: boolean } { return { connected: this.connected }; }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
