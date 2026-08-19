import { afterEach, describe, expect, it } from 'vitest';
import { ProtocolServer, type ProtocolHandlers } from '../src/server.js';
import { GatewayClient } from '../src/client.js';
import type { ServerEvent } from '../src/protocol.js';

const TOKEN = 'test-token';

describe('GatewayClient', () => {
  let server: ProtocolServer | undefined;
  let port = 0;

  async function start(): Promise<GatewayClient> {
    const emit = (ev: ServerEvent): void => server!.emit(ev);
    const handlers: ProtocolHandlers = {
      async upsertSession(req) { return { sessionId: `${req.platform}:${req.channel}:${req.user}` }; },
      async sendMessage(sessionId) {
        emit({ type: 'agent.status', sessionId, ts: Date.now(), status: 'busy' });
        emit({ type: 'message.complete', sessionId, ts: Date.now(), text: 'pong' });
        emit({ type: 'agent.status', sessionId, ts: Date.now(), status: 'idle' });
        return { runId: 'run-1' };
      },
      async resolveApproval(_reqId, decision) { return { ok: decision === 'approve' }; },
      async createTask() { return { taskId: 'task-1' }; },
      async listTasks() { return { tasks: [{ id: 'cron-1', schedule: '0 8 * * *', prompt: '每日汇报', sessionId: 'cli:cli:local' }] }; },
      async removeTask(taskId) { return { ok: taskId === 'cron-1' }; },
      async resetSession() { return { ok: true }; },
    };
    server = new ProtocolServer({ token: TOKEN, handlers });
    port = await server.listen(0);
    return new GatewayClient(`http://127.0.0.1:${port}`, TOKEN);
  }

  afterEach(async () => { await server?.close(); server = undefined; });

  it('health / upsert / send / resolve 全链路', async () => {
    const client = await start();
    expect(await client.health()).toMatchObject({ status: 'ok' });

    const s = await client.upsertSession({ platform: 'cli', channel: 'cli', user: 'local' });
    expect(s.sessionId).toBe('cli:cli:local');

    const run = await client.sendMessage(s.sessionId, { text: 'hi' });
    expect(run.runId).toBe('run-1');

    const ok = await client.resolveApproval('req-1', 'reject');
    expect(ok.ok).toBe(false);
  });

  it('WS 订阅到服务端事件', async () => {
    const client = await start();
    const events: ServerEvent[] = [];
    await client.connect((ev) => events.push(ev));
    await client.sendMessage('cli:cli:local', { text: 'hi' });
    await new Promise((r) => setTimeout(r, 100));
    expect(events.some((e) => e.type === 'message.complete' && e.text === 'pong')).toBe(true);
  });

  it('resetSession 调用 /v1/sessions/:id/reset', async () => {
    const client = await start();
    const res = await client.resetSession('cli:cli:local');
    expect(res).toEqual({ ok: true });
  });

  it('listTasks 列出 cron 任务', async () => {
    const client = await start();
    const res = await client.listTasks();
    expect(res.tasks).toEqual([
      { id: 'cron-1', schedule: '0 8 * * *', prompt: '每日汇报', sessionId: 'cli:cli:local' },
    ]);
  });

  it('removeTask 删除存在的任务并如实报告缺失', async () => {
    const client = await start();
    expect(await client.removeTask('cron-1')).toEqual({ ok: true });
    expect(await client.removeTask('cron-missing')).toEqual({ ok: false });
  });

  it('错误 token 抛错', async () => {
    await start(); // 自包含：不依赖前序测试留下的服务器/端口
    const bad = new GatewayClient(`http://127.0.0.1:${port}`, 'wrong');
    await expect(bad.health()).rejects.toThrow(/unauthorized/);
  });
});
