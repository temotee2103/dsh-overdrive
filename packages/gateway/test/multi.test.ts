import { describe, expect, it } from 'vitest';
import { mediaKindFromPath, remindSchedule, wireAdapter } from '../src/index.js';
import { GatewayClient, type ServerEvent } from '@dsh-overdrive/sdk';
import { MemoryStore, TopicStore } from '../src/memory.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import type { Adapter, NormalizedMessage, OutboundPayload, ReplySender } from '../src/adapter.js';

/** 可编程 FakeAdapter：验证 wiring 逻辑（白名单/会话键/错误兜底）。 */
class FakeAdapter implements Adapter {
  readonly id: string;
  readonly sent: Array<{ chatId: string; payload: OutboundPayload }> = [];
  private messageCb?: (msg: NormalizedMessage) => Promise<void> | void;
  private replyCb?: (buttonId: string, sender: ReplySender) => Promise<void> | void;
  constructor(id: string) { this.id = id; }
  async connect(): Promise<void> {}
  async send(chatId: string, payload: OutboundPayload): Promise<void> { this.sent.push({ chatId, payload }); }
  onMessage(cb: (msg: NormalizedMessage) => void): void { this.messageCb = cb; }
  onReply(cb: (buttonId: string, sender: ReplySender) => void): void { this.replyCb = cb; }
  /** 测试助手：返回处理器 Promise，测试 await 以确保 async 接线（upsert→sendMessage / catch 兜底）跑完 */
  emit(msg: NormalizedMessage): Promise<void> | void { return this.messageCb?.(msg); }
  click(buttonId: string, sender: ReplySender = { chatId: 'C1', userId: 'U1' }): Promise<void> | void {
    return this.replyCb?.(buttonId, sender);
  }
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
    listTasks: async () => ({ tasks: [] }),
    // wireAdapter 末尾会订阅事件流（client.connect），假客户端需实现完整接口
    connect: async () => () => undefined,
  } as unknown as GatewayClient;
  return { client, upserts, messages, approvals };
}

describe('wireAdapter（多适配器装配核心）', () => {
  it('白名单拦截并回错误文本', async () => {
    const adapter = new FakeAdapter('telegram');
    const { client } = fakeClient();
    await wireAdapter(adapter, client, { allowlist: ['telegram:111:222'] });

    await adapter.emit({ chatId: '999', userId: '999', text: 'hi' });
    expect(adapter.sent[0].payload.text).toContain('⛔');
  });

  it('白名单内消息 → upsert + sendMessage', async () => {
    const adapter = new FakeAdapter('telegram');
    const { client, upserts, messages } = fakeClient();
    await wireAdapter(adapter, client, { allowlist: ['telegram:111:222'] });

    await adapter.emit({ chatId: '111', userId: '222', text: 'hello' });
    expect(upserts).toEqual([{ platform: 'telegram', channel: '111', user: '222' }]);
    expect(messages).toEqual([{ sessionId: 'telegram:111:222', text: 'hello' }]);
  });

  it('按钮点击（白名单内）→ resolveApproval', async () => {
    const adapter = new FakeAdapter('discord');
    const { client, approvals } = fakeClient();
    await wireAdapter(adapter, client, { allowlist: ['discord:C1:U1'] });

    await adapter.click('approve:r1', { chatId: 'C1', userId: 'U1' });
    expect(approvals).toEqual([{ reqId: 'r1', decision: 'approve' }]);
  });

  it('按钮点击（白名单外）→ 拒绝批准并回错误文本', async () => {
    const adapter = new FakeAdapter('discord');
    const { client, approvals } = fakeClient();
    await wireAdapter(adapter, client, { allowlist: ['discord:C1:U1'] });

    await adapter.click('approve:r1', { chatId: 'C1', userId: 'EVIL' });
    expect(approvals).toEqual([]); // 未授权用户不能批准
    expect(adapter.sent[0].payload.text).toContain('⛔');
  });

  it('空白名单 fail-closed：点击一律拒绝', async () => {
    const adapter = new FakeAdapter('telegram');
    const { client, approvals } = fakeClient();
    await wireAdapter(adapter, client, { allowlist: [] });

    await adapter.click('reject:r1', { chatId: 'C1', userId: 'U1' });
    expect(approvals).toEqual([]);
  });

  it('DSH 调用失败 → 回错误文本（不崩溃）', async () => {
    const adapter = new FakeAdapter('slack');
    const client = {
      upsertSession: async () => { throw new Error('dsh down'); },
      connect: async () => () => undefined,
    } as unknown as GatewayClient;
    await wireAdapter(adapter, client, { allowlist: [], allowAll: true });

    await adapter.emit({ chatId: 'C1', userId: 'U1', text: 'hi' });
    expect(adapter.sent[0].payload.text).toContain('❌');
  });

  it('相关记忆自动注入到发给 agent 的文本（OpenClaw 式）', async () => {
    const adapter = new FakeAdapter('telegram');
    const { client, messages } = fakeClient();
    const memory = new MemoryStore();
    memory.add('telegram:222', '用户喜欢美式咖啡');
    await wireAdapter(adapter, client, { allowlist: ['telegram:111:222'], memory });

    await adapter.emit({ chatId: '111', userId: '222', text: '帮我点一杯咖啡' });
    expect(messages[0].text).toContain('帮我点一杯咖啡');
    expect(messages[0].text).toContain('📌 相关记忆');
    expect(messages[0].text).toContain('用户喜欢美式咖啡');
  });

  it('无相关记忆时不注入', async () => {
    const adapter = new FakeAdapter('telegram');
    const { client, messages } = fakeClient();
    const memory = new MemoryStore();
    memory.add('telegram:222', '用户喜欢美式咖啡');
    await wireAdapter(adapter, client, { allowlist: ['telegram:111:222'], memory });

    await adapter.emit({ chatId: '111', userId: '222', text: '今天天气如何' });
    expect(messages[0].text).toBe('今天天气如何');
  });

  it('/remember 命令写入记忆并回执', async () => {
    const adapter = new FakeAdapter('telegram');
    const { client } = fakeClient();
    const memory = new MemoryStore();
    await wireAdapter(adapter, client, { allowlist: ['telegram:111:222'], memory });

    await adapter.emit({ chatId: '111', userId: '222', text: '/remember 用户住在杭州' });
    expect(memory.count('telegram:222')).toBe(1);
    expect(adapter.sent[0].payload.text).toContain('已记住');
  });

  it('自动记忆：自我事实消息自动沉淀', async () => {
    const adapter = new FakeAdapter('telegram');
    const { client } = fakeClient();
    const memory = new MemoryStore();
    await wireAdapter(adapter, client, { allowlist: ['telegram:111:222'], memory });

    await adapter.emit({ chatId: '111', userId: '222', text: '你好，我叫小明，我住在杭州' });
    expect(memory.count('telegram:222')).toBe(2);
    expect(memory.list('telegram:222').map((e) => e.text)).toContain('我叫小明');
    expect(memory.list('telegram:222').map((e) => e.text)).toContain('我住在杭州');
  });

  it('persona：每条消息前置人设', async () => {
    const adapter = new FakeAdapter('telegram');
    const { client, messages } = fakeClient();
    await wireAdapter(adapter, client, { allowlist: ['telegram:111:222'], persona: '你是一个毒舌助理' });

    await adapter.emit({ chatId: '111', userId: '222', text: '你好' });
    expect(messages[0].text).toBe('【人设】你是一个毒舌助理\n你好');
  });

  it('file.created 事件：agent 产出的文件自动发回聊天并清理临时文件', async () => {
    const adapter = new FakeAdapter('telegram');
    let onEvent: ((ev: ServerEvent) => void) | undefined;
    const client = {
      upsertSession: async () => ({ sessionId: 'telegram:111:222' }),
      connect: async (cb: (ev: ServerEvent) => void) => { onEvent = cb; return () => {}; },
    } as unknown as GatewayClient;
    await wireAdapter(adapter, client, { allowlist: ['telegram:111:222'] });

    const bytes = Buffer.from('fake-image-bytes');
    onEvent!({
      type: 'file.created', sessionId: 'telegram:111:222', ts: Date.now(),
      name: 'chart.png', kind: 'image', data: bytes.toString('base64'),
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(adapter.sent[0].payload.text).toContain('chart.png');
    expect(adapter.sent[0].payload.media).toMatchObject({ kind: 'image', caption: 'chart.png' });
    expect(existsSync(adapter.sent[0].payload.media!.path)).toBe(false); // 临时文件已清理
  });

  it('群聊提及模式：群聊未提及不响应，提及才响应', async () => {
    const adapter = new FakeAdapter('telegram');
    const { client, messages } = fakeClient();
    await wireAdapter(adapter, client, { allowlist: ['telegram:-100123:222'], requireMention: true, botIdentity: 'mybot' });

    await adapter.emit({ chatId: '-100123', userId: '222', text: '你好' }); // 群聊（负 ID）未提及
    expect(messages).toHaveLength(0);
    await adapter.emit({ chatId: '-100123', userId: '222', text: '@mybot 你好' }); // 提及
    expect(messages).toHaveLength(1);
  });

  it('/context 设置/清除会话主题并注入到消息', async () => {
    const adapter = new FakeAdapter('telegram');
    const { client, messages } = fakeClient();
    const topics = new TopicStore();
    await wireAdapter(adapter, client, { allowlist: ['telegram:111:222'], topics });

    await adapter.emit({ chatId: '111', userId: '222', text: '/context 项目重构' });
    expect(adapter.sent[0].payload.text).toContain('已绑定');
    await adapter.emit({ chatId: '111', userId: '222', text: '帮我写周报' });
    expect(messages[0].text).toBe('【会话主题】项目重构\n帮我写周报');
    await adapter.emit({ chatId: '111', userId: '222', text: '/context off' });
    await adapter.emit({ chatId: '111', userId: '222', text: '你好' });
    expect(messages[1].text).toBe('你好');
  });

  it('/send <path> 读取文件并以媒体载荷发送', async () => {
    const adapter = new FakeAdapter('telegram');
    const { client } = fakeClient();
    const tmp = join(tmpdir(), `dsh-send-test-${Date.now()}.png`);
    writeFileSync(tmp, Buffer.from([1, 2, 3]));
    try {
      await wireAdapter(adapter, client, { allowlist: ['telegram:111:222'] });
      await adapter.emit({ chatId: '111', userId: '222', text: `/send ${tmp}` });
      expect(adapter.sent[0].payload.media).toMatchObject({ kind: 'image', path: tmp });
      expect(adapter.sent[0].payload.text).toContain('📎');
    } finally {
      rmSync(tmp, { force: true });
    }
  });

  it('/send 不存在的文件回错误文本', async () => {
    const adapter = new FakeAdapter('telegram');
    const { client } = fakeClient();
    await wireAdapter(adapter, client, { allowlist: ['telegram:111:222'] });
    await adapter.emit({ chatId: '111', userId: '222', text: '/send /no/such/file.png' });
    expect(adapter.sent[0].payload.text).toContain('❌');
  });

  it('/status 返回适配器/记忆/定时任务概览', async () => {
    const adapter = new FakeAdapter('telegram');
    const { client } = fakeClient();
    const memory = new MemoryStore();
    memory.add('telegram:222', 'x');
    await wireAdapter(adapter, client, { allowlist: ['telegram:111:222'], memory });
    await adapter.emit({ chatId: '111', userId: '222', text: '/status' });
    expect(adapter.sent[0].payload.text).toContain('📊 状态');
    expect(adapter.sent[0].payload.text).toContain('telegram');
    expect(adapter.sent[0].payload.text).toContain('记忆: 1 条');
  });
});

describe('remindSchedule', () => {
  it('相对分钟 → cron 5 字段', () => {
    const now = new Date('2026-08-20T10:05:00');
    expect(remindSchedule(10, null, now)).toBe('15 10 20 8 *');
  });
  it('定点时间 → cron；已过则推到明天', () => {
    const now = new Date('2026-08-20T10:05:00');
    expect(remindSchedule(0, '14:30', now)).toBe('30 14 20 8 *');
    expect(remindSchedule(0, '09:00', now)).toBe('0 9 21 8 *');
  });
});

describe('mediaKindFromPath', () => {
  it('图片/语音/其他文件分类', () => {
    expect(mediaKindFromPath('a.png')).toBe('image');
    expect(mediaKindFromPath('b.JPG')).toBe('image');
    expect(mediaKindFromPath('c.webp')).toBe('image');
    expect(mediaKindFromPath('v.ogg')).toBe('voice');
    expect(mediaKindFromPath('r.pdf')).toBe('file');
    expect(mediaKindFromPath('x.zip')).toBe('file');
  });
});

describe('remindSchedule', () => {
  it('相对分钟 → cron 5 字段', () => {
    const now = new Date('2026-08-20T10:05:00');
    expect(remindSchedule(10, null, now)).toBe('15 10 20 8 *');
  });
  it('定点时间 → cron；已过则推到明天', () => {
    const now = new Date('2026-08-20T10:05:00');
    expect(remindSchedule(0, '14:30', now)).toBe('30 14 20 8 *');
    expect(remindSchedule(0, '09:00', now)).toBe('0 9 21 8 *');
  });
});
