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
  // 安全边界：不允许内置默认 token（评审意见 #1191-3）。必须显式配置，否则拒绝启动。
  const token = rawConfig.token ?? process.env.DSH_OVERDRIVE_TOKEN;
  if (!token) {
    throw new Error('gateway-core 需要配置 token（config.token 或环境变量 DSH_OVERDRIVE_TOKEN）；未配置拒绝启动');
  }
  const port = rawConfig.port ?? 3192;
  const approvalTimeoutMs = rawConfig.approvalTimeoutMs ?? 120_000;

  const handlers = {} as ProtocolHandlers;
  const server = new ProtocolServer({ token, handlers, version: '0.1.0' });
  const runtime = createDshRuntime(ctx, {
    cwd: rawConfig.cwd,
    sessionPrefix: rawConfig.sessionPrefix,
    model: rawConfig.model,
  });
  const bridge = new DshBridge(server, runtime, { approvalTimeoutMs, cwd: rawConfig.cwd });
  Object.assign(handlers, bridge.handlers());
  bridge.start();

  const ready = server.listen(port).then((p) => ({ port: p }));
  ctx.effect(() => () => {
    bridge.dispose(); // 清理 cron 调度循环定时器
    void server.close();
  });

  console.log(`[dsh-overdrive-gateway-core] loaded, protocol server on 127.0.0.1:${port} (token: ***)`);
  return { server, ready, bridge };
}
