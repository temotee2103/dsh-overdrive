import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { Adapter } from './adapter.js';
import type { GatewayClient } from '@dsh-overdrive/sdk';

export interface StatusServerOptions {
  adapters: Adapter[];
  client: GatewayClient;
  version: string;
}

/**
 * 健康控制台：GET / 与 /console 返回静态页，GET /api/status 返回 DSH 健康 + 适配器状态。
 *
 * console.html 读取路径说明（与 dist 产物核对过）：
 * - src 运行（vitest）：import.meta.url = packages/gateway/src/status.ts → ../web/console.html = packages/gateway/web/console.html
 * - dist 运行（node packages/gateway/dist/index.js）：import.meta.url = packages/gateway/dist/status.js → ../web/console.html = packages/gateway/web/console.html
 * - npm 安装（@dsh-overdrive/gateway）：console.html 随包分发，两种形态均可命中。
 */
export function createStatusServer(opts: StatusServerOptions): {
  server: Server;
  listen(port: number): Promise<number>;
  close(): Promise<void>;
} {
  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/status') {
      let dsh: { status: string } | { error: string };
      try {
        dsh = await opts.client.health();
      } catch (error) {
        dsh = { error: error instanceof Error ? error.message : String(error) };
      }
      const adapters = opts.adapters.map((a) => ({
        id: a.id,
        connected: a.status?.().connected ?? null,
      }));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ version: opts.version, dsh, adapters }));
      return;
    }
    if (url.pathname === '/' || url.pathname === '/console') {
      const html = await readFile(
        fileURLToPath(new URL('../web/console.html', import.meta.url)),
        'utf8',
      ).catch(() => '<h1>console.html not found</h1>');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  return {
    server: http,
    listen: (port: number) =>
      new Promise<number>((resolve) =>
        http.listen(port, '0.0.0.0', () => resolve((http.address() as { port: number }).port)),
      ),
    close: () => new Promise<void>((resolve) => http.close(() => resolve())),
  };
}
