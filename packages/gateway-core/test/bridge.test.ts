import { afterEach, describe, expect, it } from 'vitest';
import { DshBridge } from '../src/bridge.js';
import type { ApprovalOutcome, ApprovalRequestLike, DshRuntime, MediaRef } from '../src/dsh-runtime.js';
import { ProtocolServer, type ProtocolHandlers, type ServerEvent } from '@dsh-overdrive/sdk';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOKEN = 'test-token';

class FakeRuntime implements DshRuntime {
  followed: Array<{ sessionId: string; msg: unknown }> = [];
  ensured = new Set<string>();
  destroyed: string[] = [];
  sessionCb?: (sessionId: string, event: { type: string; data: Record<string, unknown> }) => void;
  approvalCb?: (req: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>;
  subagentCalls: Array<{ label: string; prompt: string }> = [];

  async ensureAgent(sessionId: string) {
    this.ensured.add(sessionId);
    return {
      sessionId,
      followup: (msg: unknown) => this.followed.push({ sessionId, msg }),
      inject: () => {},
    };
  }
  buildUserMessage(text: string, media?: MediaRef) {
    return Promise.resolve({
      content: [
        { type: 'text', text },
        ...(media?.kind === 'image' && media.url ? [{ type: 'image', url: media.url }] : []),
      ],
      source: { kind: 'user' },
    });
  }
  onSessionEvent(cb: (sessionId: string, event: { type: string; data: Record<string, unknown> }) => void) { this.sessionCb = cb; }
  onApprovalRequest(cb: (req: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>) { this.approvalCb = cb; }
  async spawnSubagent(req: { label: string; prompt: string }) { this.subagentCalls.push(req); return { taskId: 'sub-1' }; }
  async destroyAgent(sessionId: string) { this.destroyed.push(sessionId); }

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
  afterEach(async () => { ctx?.bridge.dispose(); await ctx?.server.close(); });

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

  it('DSH 推送 assistant/message → 协议 message.complete（sessionId 转协议键）', async () => {
    ctx = await setup();
    ctx.runtime.push('dsh:cli:cli:local', 'assistant/message', {
      message: { content: [{ type: 'text', text: '结果' }] },
    });
    const ev = ctx.events.find((e) => e.type === 'message.complete');
    expect(ev).toBeDefined();
    // 真机验证发现的 bug：DSH 事件 sessionId 带 `dsh:` 前缀，协议事件必须用协议键
    expect((ev as { sessionId: string }).sessionId).toBe('cli:cli:local');
    expect((ev as { text: string }).text).toBe('结果');
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

  it('createTask(subagent) 委托 runtime.spawnSubagent', async () => {
    ctx = await setup();
    const res = await ctx.handlers.createTask!({ sessionId: 'cli:cli:local', kind: 'subagent', prompt: '调研' });
    expect(res.taskId).toBe('sub-1');
    expect(ctx.runtime.subagentCalls[0].prompt).toBe('调研');
    expect(ctx.runtime.subagentCalls[0].label).toBe('调研');
  });

  it('createTask(cron) 注册成功且返回 cron- taskId', async () => {
    ctx = await setup();
    const res = await ctx.handlers.createTask!({ sessionId: 'cli:cli:local', kind: 'cron', prompt: '每日汇报', schedule: '0 8 * * *' });
    expect(res.taskId).toMatch(/^cron-/);
  });

  it('createTask(cron) 非法 schedule 抛错（缺字段 / 越界）', async () => {
    ctx = await setup();
    await expect(
      ctx.handlers.createTask!({ sessionId: 'cli:cli:local', kind: 'cron', prompt: '汇报', schedule: '0 8 *' }),
    ).rejects.toThrow(/cron/);
    await expect(
      ctx.handlers.createTask!({ sessionId: 'cli:cli:local', kind: 'cron', prompt: '汇报', schedule: '60 8 * * *' }),
    ).rejects.toThrow(/cron/);
  });

  it('createTask(cron) 缺 schedule 抛错', async () => {
    ctx = await setup();
    await expect(
      ctx.handlers.createTask!({ sessionId: 'cli:cli:local', kind: 'cron', prompt: '汇报' }),
    ).rejects.toThrow(/schedule/);
  });

  it('cron 用唯一 id 作键：相同 prompt 可注册多个且互不覆盖', async () => {
    ctx = await setup();
    const a = await ctx.handlers.createTask!({ sessionId: 'cli:cli:local', kind: 'cron', prompt: '每日汇报', schedule: '0 8 * * *' });
    const b = await ctx.handlers.createTask!({ sessionId: 'cli:cli:local', kind: 'cron', prompt: '每日汇报', schedule: '0 9 * * *' });
    expect(a.taskId).not.toBe(b.taskId);
    const listed = await ctx.handlers.listTasks!();
    expect(listed.tasks).toHaveLength(2);
    expect(listed.tasks.map((t) => t.prompt)).toEqual(['每日汇报', '每日汇报']);
    expect(listed.tasks.map((t) => t.schedule).sort()).toEqual(['0 8 * * *', '0 9 * * *']);
  });

  it('listTasks 返回 id/schedule/prompt/sessionId；removeTask 按 id 删除', async () => {
    ctx = await setup();
    const res = await ctx.handlers.createTask!({ sessionId: 'cli:cli:local', kind: 'cron', prompt: '日报', schedule: '0 8 * * *' });
    const listed = await ctx.handlers.listTasks!();
    expect(listed.tasks[0]).toMatchObject({
      id: res.taskId,
      schedule: '0 8 * * *',
      prompt: '日报',
      sessionId: 'cli:cli:local',
      nextRunAt: expect.any(String),
    });
    expect(await ctx.handlers.removeTask!(res.taskId)).toEqual({ ok: true });
    expect(await ctx.handlers.listTasks!()).toEqual({ tasks: [] });
    expect(await ctx.handlers.removeTask!('cron-missing')).toEqual({ ok: false });
  });

  it('sendMessage 带 media 时 buildUserMessage 收到 media（image → content block）', async () => {
    ctx = await setup();
    await ctx.handlers.sendMessage!('cli:cli:local', { text: '看图', media: { kind: 'image', url: 'https://x/y.png' } });
    expect(ctx.runtime.followed).toHaveLength(1);
    expect(ctx.runtime.followed[0].msg).toMatchObject({
      content: [
        { type: 'text', text: '看图' },
        { type: 'image', url: 'https://x/y.png' },
      ],
      source: { kind: 'user' },
    });
  });

  it('sendMessage 带 voice media 时透传（降级文本由 runtime 负责）', async () => {
    ctx = await setup();
    await ctx.handlers.sendMessage!('cli:cli:local', { text: '', media: { kind: 'voice', url: 'https://x/v.ogg' } });
    expect(ctx.runtime.followed[0].msg).toMatchObject({ content: [{ type: 'text', text: '' }] });
  });

  it('resetSession 调 runtime.destroyAgent（协议会话键 → dsh 会话 id）', async () => {
    ctx = await setup();
    await ctx.handlers.resetSession!('cli:cli:local');
    expect(ctx.runtime.destroyed).toEqual(['dsh:cli:cli:local']);
  });

  it('一次性 cron 任务（once，/remind）触发后自动移除', async () => {
    const runtime = new FakeRuntime();
    const events: ServerEvent[] = [];
    const handlers = {} as ProtocolHandlers;
    const server = new ProtocolServer({ token: TOKEN, handlers, version: '0.1.0' });
    const bridge = new DshBridge(server, runtime, { approvalTimeoutMs: 60_000, cronLoopIntervalMs: 50 });
    Object.assign(handlers, bridge.handlers());
    bridge.start();
    server.onEvent((ev) => events.push(ev));
    await server.listen(0);
    try {
      const now = new Date();
      const schedule = `${now.getMinutes()} ${now.getHours()} * * *`;
      const res = await handlers.createTask!({ sessionId: 'cli:cli:local', kind: 'cron', prompt: '⏰ 提醒：喝水', schedule, once: true });
      expect(res.taskId).toMatch(/^cron-/);
      // 等一个调度周期触发（50ms 间隔，给 500ms 余量）
      await new Promise((r) => setTimeout(r, 500));
      const listed = await handlers.listTasks!();
      expect(listed.tasks).toEqual([]); // 一次性任务已移除
      expect(runtime.followed).toHaveLength(1); // 触发了一次 followup
      expect(String(runtime.followed[0].msg).length).toBeGreaterThan(0);
    } finally {
      bridge.dispose();
      await server.close();
    }
  });

  it('turn/end 后自动发送工作目录新文件（file.created 事件，base64）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-bridge-autosend-'));
    const runtime = new FakeRuntime();
    const events: ServerEvent[] = [];
    const handlers = {} as ProtocolHandlers;
    const server = new ProtocolServer({ token: TOKEN, handlers, version: '0.1.0' });
    const bridge = new DshBridge(server, runtime, { approvalTimeoutMs: 60_000, cwd: dir });
    Object.assign(handlers, bridge.handlers());
    bridge.start();
    server.onEvent((ev) => events.push(ev));
    await server.listen(0);
    try {
      writeFileSync(join(dir, 'gen.png'), 'png-bytes');
      runtime.push('dsh:cli:cli:local', 'turn/end', {});
      await new Promise((r) => setTimeout(r, 50));
      const ev = events.find((e) => e.type === 'file.created') as { type: 'file.created'; name: string; kind: string; data: string } | undefined;
      expect(ev).toBeDefined();
      expect(ev!.name).toBe('gen.png');
      expect(ev!.kind).toBe('image');
      expect(Buffer.from(ev!.data, 'base64').toString()).toBe('png-bytes');
      // 同一文件不会重复发送（seen 去重）
      runtime.push('dsh:cli:cli:local', 'turn/end', {});
      await new Promise((r) => setTimeout(r, 50));
      const count = events.filter((e) => e.type === 'file.created').length;
      expect(count).toBe(1);
    } finally {
      bridge.dispose();
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
