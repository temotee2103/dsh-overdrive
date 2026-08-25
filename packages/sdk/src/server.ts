import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  HealthResponse, ListTasksResponse, RemoveTaskResponse, ResetSessionResponse, ResolveApprovalResponse,
  SendMessageRequest, SendMessageResponse, ServerEvent,
  TaskResponse, UpsertSessionResponse,
} from './protocol.js';

export interface ProtocolHandlers {
  upsertSession(req: { platform: string; channel: string; user: string }): Promise<UpsertSessionResponse>;
  sendMessage(sessionId: string, req: SendMessageRequest): Promise<SendMessageResponse>;
  resolveApproval(reqId: string, decision: 'approve' | 'reject'): Promise<ResolveApprovalResponse>;
  createTask(req: { sessionId: string; kind: 'subagent' | 'cron'; prompt: string; schedule?: string; once?: boolean; timeZone?: string }): Promise<TaskResponse>;
  listTasks(): Promise<ListTasksResponse>;
  removeTask(taskId: string): Promise<RemoveTaskResponse>;
  resetSession(sessionId: string): Promise<ResetSessionResponse>;
}

export interface ProtocolServerOptions {
  token: string;
  handlers: ProtocolHandlers;
  version?: string;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export class ProtocolServer {
  readonly http: HttpServer;
  readonly version: string;
  private readonly wss: WebSocketServer;
  private readonly token: string;
  private readonly handlers: ProtocolHandlers;
  private readonly listeners = new Set<(ev: ServerEvent) => void>();

  constructor(opts: ProtocolServerOptions) {
    this.token = opts.token;
    this.handlers = opts.handlers;
    this.version = opts.version ?? '0.1.0';
    this.http = createServer((req, res) => void this.route(req, res));
    this.wss = new WebSocketServer({ noServer: true });
    this.http.on('upgrade', (req, socket, head) => {
      if (!this.authenticate(req)) {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
    });
  }

  /** 返回实际监听端口（port=0 时为随机端口）。 */
  listen(port: number, host = '127.0.0.1'): Promise<number> {
    return new Promise((resolve) => {
      this.http.listen(port, host, () => resolve((this.http.address() as AddressInfo).port));
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      // 先强制断开所有 WS 客户端，否则 wss.close() 会一直等待客户端自行关闭。
      for (const client of this.wss.clients) client.terminate();
      this.wss.close(() => this.http.close(() => resolve()));
    });
  }

  emit(ev: ServerEvent): void {
    const line = JSON.stringify(ev);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(line);
    }
    for (const cb of this.listeners) cb(ev);
  }

  onEvent(cb: (ev: ServerEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private authenticate(req: IncomingMessage): boolean {
    return (req.headers.authorization ?? '') === `Bearer ${this.token}`;
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.authenticate(req)) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      const send = (status: number, body: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };

      if (req.method === 'GET' && parts[0] === 'v1' && parts[1] === 'health' && parts.length === 2) {
        send(200, { status: 'ok', version: this.version } satisfies HealthResponse);
        return;
      }
      if (req.method === 'POST' && parts[0] === 'v1' && parts[1] === 'sessions' && parts.length === 2) {
        const body = (await readJson(req)) as { platform: string; channel: string; user: string };
        send(200, await this.handlers.upsertSession(body));
        return;
      }
      if (req.method === 'POST' && parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] && parts[3] === 'messages') {
        const body = (await readJson(req)) as SendMessageRequest;
        send(200, await this.handlers.sendMessage(decodeURIComponent(parts[2]), body));
        return;
      }
      if (req.method === 'POST' && parts[0] === 'v1' && parts[1] === 'approvals' && parts[2] && parts[3] === 'resolve') {
        const body = (await readJson(req)) as { decision: 'approve' | 'reject' };
        send(200, await this.handlers.resolveApproval(decodeURIComponent(parts[2]), body.decision));
        return;
      }
      if (req.method === 'POST' && parts[0] === 'v1' && parts[1] === 'tasks' && parts.length === 2) {
        const body = (await readJson(req)) as { sessionId: string; kind: 'subagent' | 'cron'; prompt: string; schedule?: string; once?: boolean; timeZone?: string };
        send(200, await this.handlers.createTask(body));
        return;
      }
      if (req.method === 'GET' && parts[0] === 'v1' && parts[1] === 'tasks' && parts.length === 2) {
        send(200, await this.handlers.listTasks());
        return;
      }
      if (req.method === 'DELETE' && parts[0] === 'v1' && parts[1] === 'tasks' && parts[2] && parts.length === 3) {
        send(200, await this.handlers.removeTask(decodeURIComponent(parts[2])));
        return;
      }
      if (req.method === 'POST' && parts[0] === 'v1' && parts[1] === 'sessions' && parts[2] && parts[3] === 'reset') {
        send(200, await this.handlers.resetSession(decodeURIComponent(parts[2])));
        return;
      }
      send(404, { error: 'not found' });
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'internal error' }));
    }
  }
}
