import { Context } from '@deepseek-ai/cordis';
import { ProtocolServer, type ProtocolHandlers } from '@dsh-overdrive/sdk';

export const name = 'dsh-overdrive-gateway-core';

export interface GatewayCoreConfig {
  token?: string;
  port?: number;
}

/**
 * DSH 插件入口（Cordis 函数式插件）。
 * M1 雏形：只暴露协议服务端，handler 全部打日志占位；
 * 真正的 sessions/轨迹/审批桥接在 M0 报告（docs/interface-report.md §7）确认后于下一计划实现。
 */
export function apply(ctx: Context, config: GatewayCoreConfig = {}) {
  const token = config.token ?? 'dev-token';
  const port = config.port ?? 3192;

  const handlers: ProtocolHandlers = {
    async upsertSession(req) {
      console.log(`[gateway-core] upsertSession ${req.platform}:${req.channel}:${req.user}`);
      return { sessionId: `${req.platform}:${req.channel}:${req.user}` };
    },
    async sendMessage(sessionId, req) {
      console.log(`[gateway-core] sendMessage ${sessionId}: ${req.text}`);
      return { runId: 'mock-run' };
    },
    async resolveApproval(reqId, decision) {
      console.log(`[gateway-core] resolveApproval ${reqId} → ${decision}`);
      return { ok: true };
    },
    async createTask(req) {
      console.log(`[gateway-core] createTask ${req.kind}: ${req.prompt}`);
      return { taskId: 'mock-task' };
    },
  };

  const server = new ProtocolServer({ token, handlers, version: '0.1.0' });
  const ready = server.listen(port).then((p) => ({ port: p }));

  ctx.effect(() => () => server.close());

  return { server, ready };
}
