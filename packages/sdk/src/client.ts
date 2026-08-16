import { WebSocket } from 'ws';
import type {
  HealthResponse, ResolveApprovalRequest, ResolveApprovalResponse, SendMessageRequest,
  SendMessageResponse, ServerEvent, TaskRequest, TaskResponse,
  UpsertSessionRequest, UpsertSessionResponse,
} from './protocol.js';

export class GatewayClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `request failed: ${res.status}`);
    return data;
  }

  health(): Promise<HealthResponse> {
    return this.request('GET', '/v1/health');
  }

  upsertSession(req: UpsertSessionRequest): Promise<UpsertSessionResponse> {
    return this.request('POST', '/v1/sessions', req);
  }

  sendMessage(sessionId: string, req: SendMessageRequest): Promise<SendMessageResponse> {
    return this.request('POST', `/v1/sessions/${encodeURIComponent(sessionId)}/messages`, req);
  }

  resolveApproval(reqId: string, decision: 'approve' | 'reject'): Promise<ResolveApprovalResponse> {
    const body = { decision } satisfies ResolveApprovalRequest;
    return this.request('POST', `/v1/approvals/${encodeURIComponent(reqId)}/resolve`, body);
  }

  createTask(req: TaskRequest): Promise<TaskResponse> {
    return this.request('POST', '/v1/tasks', req);
  }

  /** 建立 WS 事件订阅，返回断开函数。 */
  connect(onEvent: (ev: ServerEvent) => void): Promise<() => void> {
    const url = this.baseUrl.replace(/^http/, 'ws') + '/v1/events';
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${this.token}` } });
    return new Promise((resolve, reject) => {
      ws.on('open', () => resolve(() => ws.close()));
      ws.on('error', reject);
      ws.on('message', (data) => {
        try {
          onEvent(JSON.parse(data.toString()) as ServerEvent);
        } catch {
          // 忽略畸形事件，不中断订阅
        }
      });
    });
  }
}
