import { afterEach, describe, expect, it } from 'vitest';
import { createStatusServer } from '../src/status.js';
import type { Adapter } from '../src/adapter.js';
import { GatewayClient } from '@dsh-overdrive/sdk';

describe('createStatusServer', () => {
  let server: ReturnType<typeof createStatusServer> | undefined;
  let port = 0;
  afterEach(async () => { await server?.close(); server = undefined; });

  async function start(fakeAdapters: Adapter[]): Promise<string> {
    const client = {
      health: async () => ({ status: 'ok' as const, version: '0.1.0' }),
    } as unknown as GatewayClient;
    server = createStatusServer({ adapters: fakeAdapters, client, version: '0.1.0' });
    port = await server.listen(0);
    return `http://127.0.0.1:${port}`;
  }

  it('/api/status 返回 dsh 健康与适配器状态', async () => {
    const url = await start([
      { id: 'telegram', status: () => ({ connected: true }) },
      { id: 'whatsapp', status: () => ({ connected: false }) },
    ] as unknown as Adapter[]);
    const res = await fetch(`${url}/api/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dsh.status).toBe('ok');
    expect(body.adapters).toEqual([
      { id: 'telegram', connected: true },
      { id: 'whatsapp', connected: false },
    ]);
  });

  it('GET / 返回 HTML 控制台页', async () => {
    const url = await start([]);
    const res = await fetch(`${url}/`);
    expect(res.status).toBe(200);
    expect((await res.text())).toContain('dsh-overdrive');
  });
});
