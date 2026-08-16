import { afterEach, describe, expect, it } from 'vitest';
import { DshBridge } from '../src/bridge.js';
import type { ApprovalOutcome, ApprovalRequestLike, DshRuntime } from '../src/dsh-runtime.js';
import { ProtocolServer, type ProtocolHandlers, type ServerEvent } from '@dsh-overdrive/sdk';

const TOKEN = 'test-token';

class FakeRuntime implements DshRuntime {
  followed: Array<{ sessionId: string; msg: { text: string } }> = [];
  ensured = new Set<string>();
  sessionCb?: (sessionId: string, event: { type: string; data: Record<string, unknown> }) => void;
  approvalCb?: (req: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>;
  subagentCalls: Array<{ label: string; prompt: string }> = [];

  async ensureAgent(sessionId: string) {
    this.ensured.add(sessionId);
    return {
      sessionId,
      followup: (msg: { text: string }) => this.followed.push({ sessionId, msg }),
      inject: () => {},
    };
  }
  buildUserMessage(text: string) { return { content: [{ type: 'text', text }], source: { kind: 'user' } }; }
  onSessionEvent(cb: (sessionId: string, event: { type: string; data: Record<string, unknown> }) => void) { this.sessionCb = cb; }
  onApprovalRequest(cb: (req: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>) { this.approvalCb = cb; }
  async spawnSubagent(req: { label: string; prompt: string }) { this.subagentCalls.push(req); return { taskId: 'sub-1' }; }

  push(sessionId: string, type: string, data: Record<string, unknown> = {}): void {
    this.sessionCb?.(sessionId, { type, data });
  }
  askApproval(req: { agent: { session: { header: { id: string } } }; toolName: string }): Promise<string> {
    if (!this.approvalCb) throw new Error('approvalCb 未注册');
    return this.approvalCb(req, async () => 'unavailable');
  }
}

async function setup(): Promise<{
  server: ProtocolServer; runtime: FakeRuntime; bridge: DshBridge;
  handlers: ProtocolHandlers; events: ServerEvent[]; port: number;
}> {
  const runtime = new FakeRuntime();
  const events: ServerEvent[] = [];
  const handlers = {} as ProtocolHandlers;
  const server = new ProtocolServer({ token: TOKEN, handlers, version: '0.1.0' });
  const bridge = new DshBridge(server, runtime, { approvalTimeoutMs: 60_000 });
  Object.assign(handlers, bridge.handlers());
  bridge.start();
  server.onEvent((ev) => events.push(ev));
  const port = await server.listen(0);
  return { server, runtime, bridge, handlers, events, port };
}

describe('DshBridge', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  afterEach(async () => { await ctx?.server.close(); });

  it('upsertSession 确保 agent 存在并返回协议会话键', async () => {
    ctx = await setup();
    const res = await ctx.handlers.upsertSession!({ platform: 'cli', channel: 'cli', user: 'local' });
    expect(res.sessionId).toBe('cli:cli:local');
    expect(ctx.runtime.ensured.has('dsh:cli:cli:local')).toBe(true);
  });

  it('sendMessage 用 followup 注入用户消息', async () => {
    ctx = await setup();
    await ctx.handlers.sendMessage!('cli:cli:local', { text: 'hello' });
    expect(ctx.runtime.followed).toHaveLength(1);
    expect(ctx.runtime.followed[0].sessionId).toBe('dsh:cli:cli:local');
    expect(ctx.runtime.followed[0].msg).toEqual({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } });
  });

  it('DSH 推送 assistant/message → 协议 message.complete', async () => {
    ctx = await setup();
    ctx.runtime.push('dsh:cli:cli:local', 'assistant/message', {
      message: { content: [{ type: 'text', text: '结果' }] },
    });
    expect(ctx.events.some((e) => e.type === 'message.complete' && e.text === '结果')).toBe(true);
  });

  it('审批流：DSH 询问 → 协议 approval.request；resolve approve → allowed-once', async () => {
    ctx = await setup();
    const outcomePromise = ctx.runtime.askApproval({
      agent: { session: { header: { id: 'dsh:cli:cli:local' } } },
      toolName: 'bash',
    });
    const req = ctx.events.find((e) => e.type === 'approval.request') as
      { type: 'approval.request'; reqId: string; summary: string } | undefined;
    expect(req).toBeDefined();
    expect(req!.summary).toContain('bash');

    const ok = await ctx.handlers.resolveApproval!(req!.reqId, 'approve');
    expect(ok.ok).toBe(true);
    await expect(outcomePromise).resolves.toBe('allowed-once');
  });

  it('审批拒绝 → rejected', async () => {
    ctx = await setup();
    const outcomePromise = ctx.runtime.askApproval({
      agent: { session: { header: { id: 'dsh:cli:cli:local' } } },
      toolName: 'bash',
    });
    const req = ctx.events.find((e) => e.type === 'approval.request') as { reqId: string } | undefined;
    await ctx.handlers.resolveApproval!(req!.reqId, 'reject');
    await expect(outcomePromise).resolves.toBe('rejected');
  });

  it('createTask(subagent) 委托 runtime.spawnSubagent；cron 抛错', async () => {
    ctx = await setup();
    const res = await ctx.handlers.createTask!({ sessionId: 'cli:cli:local', kind: 'subagent', prompt: '调研' });
    expect(res.taskId).toBe('sub-1');
    expect(ctx.runtime.subagentCalls[0].prompt).toBe('调研');

    await expect(
      ctx.handlers.createTask!({ sessionId: 'cli:cli:local', kind: 'cron', prompt: '每日', schedule: '0 8 * * *' }),
    ).rejects.toThrow(/cron/);
  });
});
