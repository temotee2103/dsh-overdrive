import { Context } from '@deepseek-ai/cordis';
import { ProtocolServer, type ProtocolHandlers } from '@dsh-overdrive/sdk';
import { DshBridge } from './bridge.js';
import { createDshRuntime } from './dsh-runtime.js';

export const name = 'dsh-overdrive-gateway-core';

/** 依赖注入：agents 是桥接的硬依赖；subagents 按需探测（不 inject，避免无 provider 的部署加载失败）。 */
export const inject = ['agents'];

export interface GatewayCoreConfig {
  token?: string;
  port?: number;
  sessionPrefix?: string;
  cwd?: string;
  model?: { provider?: string; model?: string };
  approvalTimeoutMs?: number;
}

/**
 * DSH 插件入口。组装 ProtocolServer + DshRuntime + DshBridge：
 * 协议层（HTTP/WS）由 SDK 提供，桥接逻辑见 bridge.ts。
 * 返回 `{ server, ready }` 供测试与上层复用。
 */
export function apply(ctx: Context, rawConfig: GatewayCoreConfig = {}) {
  const token = rawConfig.token ?? 'dev-token';
  const port = rawConfig.port ?? 3192;
  const approvalTimeoutMs = rawConfig.approvalTimeoutMs ?? 120_000;

  const handlers = {} as ProtocolHandlers;
  const server = new ProtocolServer({ token, handlers, version: '0.1.0' });
  const runtime = createDshRuntime(ctx, {
    cwd: rawConfig.cwd,
    sessionPrefix: rawConfig.sessionPrefix,
    model: rawConfig.model,
  });
  const bridge = new DshBridge(server, runtime, { approvalTimeoutMs });
  Object.assign(handlers, bridge.handlers());
  bridge.start();

  const ready = server.listen(port).then((p) => ({ port: p }));
  ctx.effect(() => () => {
    bridge.dispose(); // 清理 cron 调度循环定时器
    void server.close();
  });

  console.log(`[dsh-overdrive-gateway-core] loaded, protocol server on 127.0.0.1:${port} (token: ${token === 'dev-token' ? 'dev-token' : '***'})`);
  return { server, ready, bridge };
}
