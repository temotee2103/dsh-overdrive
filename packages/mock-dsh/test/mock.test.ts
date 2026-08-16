import { afterEach, describe, expect, it } from 'vitest';
import { createMockDsh } from '../src/index.js';
import { GatewayClient, type ServerEvent } from '@dsh-overdrive/sdk';

const TOKEN = 'dev-token';

describe('mock-dsh', () => {
  let server: ReturnType<typeof createMockDsh> | undefined;
  let port = 0;

  async function start(): Promise<GatewayClient> {
    server = createMockDsh({ token: TOKEN });
    port = await server.listen(0);
    return new GatewayClient(`http://127.0.0.1:${port}`, TOKEN);
  }

  afterEach(async () => { await server?.close(); server = undefined; });

  it('普通消息 → busy → 轨迹 → complete', async () => {
    const client = await start();
    const events: ServerEvent[] = [];
    await client.connect((ev) => events.push(ev));
    await client.sendMessage('cli:cli:local', { text: 'hello' });
    await new Promise((r) => setTimeout(r, 200));

    const types = events.map((e) => e.type);
    expect(types).toContain('agent.status');
    expect(types).toContain('trajectory.step');
    expect(types).toContain('message.complete');
    const done = events.find((e) => e.type === 'message.complete');
    expect(done && 'text' in done && done.text).toBe('Mock agent received: hello');
  });

  it('包含 dangerous 的消息触发审批流，拒绝后不执行', async () => {
    const client = await start();
    const events: ServerEvent[] = [];
    await client.connect((ev) => events.push(ev));
    await client.sendMessage('cli:cli:local', { text: 'dangerous rm -rf' });
    await new Promise((r) => setTimeout(r, 100));

    const req = events.find((e) => e.type === 'approval.request') as
      { type: 'approval.request'; reqId: string; summary: string } | undefined;
    expect(req).toBeDefined();
    expect(req!.summary).toContain('dangerous');

    const ok = await client.resolveApproval(req!.reqId, 'reject');
    expect(ok.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    const done = events.find((e) => e.type === 'message.complete') as
      { type: 'message.complete'; text: string } | undefined;
    expect(done!.text).toContain('拒绝');
  });
});
