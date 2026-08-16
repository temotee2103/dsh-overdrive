import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { ProtocolServer, type ProtocolHandlers } from '../src/server.js';
import type { ServerEvent } from '../src/protocol.js';

const TOKEN = 'test-token';

function makeHandlers(emit: (ev: ServerEvent) => void): ProtocolHandlers {
  return {
    async upsertSession(req) {
      emit({ type: 'agent.status', sessionId: `${req.platform}:${req.channel}:${req.user}`, ts: Date.now(), status: 'busy' });
      return { sessionId: `${req.platform}:${req.channel}:${req.user}` };
    },
    async sendMessage(sessionId) {
      emit({ type: 'message.complete', sessionId, ts: Date.now(), text: 'pong' });
      return { runId: 'run-1' };
    },
    async resolveApproval(reqId, decision) { return { ok: decision === 'approve' }; },
    async createTask() { return { taskId: 'task-1' }; },
    async resetSession() { return { ok: true }; },
  };
}

describe('ProtocolServer', () => {
  const servers: ProtocolServer[] = [];

  async function startServer(): Promise<{ server: ProtocolServer; port: number; url: string }> {
    const server = new ProtocolServer({ token: TOKEN, handlers: makeHandlers((ev) => server.emit(ev)) });
    servers.push(server);
    const port = await server.listen(0);
    return { server, port, url: `http://127.0.0.1:${port}` };
  }

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  it('health 返回 ok', async () => {
    const { url } = await startServer();
    const res = await fetch(`${url}/v1/health`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });

  it('无 token 返回 401', async () => {
    const { url } = await startServer();
    const res = await fetch(`${url}/v1/health`);
    expect(res.status).toBe(401);
  });

  it('upsertSession 走 handlers', async () => {
    const { url } = await startServer();
    const res = await fetch(`${url}/v1/sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'cli', channel: 'cli', user: 'local' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessionId: 'cli:cli:local' });
  });

  it('sendMessage 与 WS 事件推送', async () => {
    const { server, url } = await startServer();
    const events: ServerEvent[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${(server.http.address() as AddressInfo).port}/v1/events`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    ws.onmessage = (m) => events.push(JSON.parse(String(m.data)) as ServerEvent);
    await new Promise<void>((resolve) => (ws.onopen = () => resolve()));

    const res = await fetch(`${url}/v1/sessions/cli%3Acli%3Alocal/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hi' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runId: 'run-1' });

    await new Promise((r) => setTimeout(r, 100));
    expect(events.some((e) => e.type === 'message.complete')).toBe(true);
    ws.close();
  });

  it('未知路由返回 404', async () => {
    const { url } = await startServer();
    const res = await fetch(`${url}/v1/nope`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(404);
  });

  it('resetSession 走 handlers（POST /v1/sessions/:id/reset）', async () => {
    const { url } = await startServer();
    const res = await fetch(`${url}/v1/sessions/cli%3Acli%3Alocal/reset`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
