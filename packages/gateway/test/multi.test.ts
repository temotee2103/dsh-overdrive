import { describe, expect, it } from 'vitest';
import { wireAdapter } from '../src/index.js';
import { GatewayClient } from '@dsh-overdrive/sdk';
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
});
