import { randomUUID } from 'node:crypto';
import { ProtocolServer, sessionKey, type ProtocolHandlers, type ServerEvent } from '@dsh-overdrive/sdk';

export function createMockDsh(opts: { token: string; version?: string }): ProtocolServer {
  let server!: ProtocolServer;
  server = new ProtocolServer({
    token: opts.token,
    version: opts.version,
    handlers: makeMockHandlers((ev) => server.emit(ev)),
  });
  return server;
}

function makeMockHandlers(emit: (ev: ServerEvent) => void): ProtocolHandlers {
  const pendingApprovals = new Map<string, (decision: 'approve' | 'reject') => void>();

  return {
    async upsertSession(req) {
      return { sessionId: sessionKey(req.platform, req.channel, req.user) };
    },

    async sendMessage(sessionId, req) {
      const runId = randomUUID();
      emit({ type: 'agent.status', sessionId, ts: Date.now(), status: 'busy' });
      emit({ type: 'trajectory.step', sessionId, ts: Date.now(), step: { kind: 'thought', label: '分析消息' } });
      emit({ type: 'trajectory.step', sessionId, ts: Date.now(), step: { kind: 'tool', label: 'mock.tool: echo', detail: req.text } });
      emit({ type: 'message.delta', sessionId, ts: Date.now(), text: '…' });

      if (req.text.toLowerCase().includes('dangerous')) {
        const reqId = randomUUID();
        pendingApprovals.set(reqId, (decision) => {
          const text = decision === 'approve' ? `✅ 已执行: ${req.text}` : `🚫 已拒绝: ${req.text}`;
          emit({ type: 'message.complete', sessionId, ts: Date.now(), text });
          emit({ type: 'agent.status', sessionId, ts: Date.now(), status: 'idle' });
        });
        emit({
          type: 'approval.request', sessionId, ts: Date.now(), reqId,
          summary: `执行危险操作: ${req.text}`, timeoutMs: 120_000,
        });
        return { runId };
      }

      setTimeout(() => {
        emit({ type: 'message.complete', sessionId, ts: Date.now(), text: `Mock agent received: ${req.text}` });
        emit({ type: 'agent.status', sessionId, ts: Date.now(), status: 'idle' });
      }, 50);
      return { runId };
    },

    async resolveApproval(reqId, decision) {
      const resolve = pendingApprovals.get(reqId);
      if (!resolve) return { ok: false };
      pendingApprovals.delete(reqId);
      resolve(decision);
      return { ok: true };
    },

    async createTask(req) {
      const taskId = randomUUID();
      setTimeout(() => {
        emit({ type: 'task.done', sessionId: req.sessionId, ts: Date.now(), taskId, ok: true });
      }, 50);
      return { taskId };
    },
  };
}
