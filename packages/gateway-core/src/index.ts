import { Context } from '@deepseek-ai/cordis';
import { ProtocolServer, type ProtocolHandlers } from '@dsh-overdrive/sdk';
import { DshBridge } from './bridge.js';
import { createDshRuntime } from './dsh-runtime.js';
import { toDshSessionId } from './keys.js';
import { createNativeBridge } from './native.js';
import {
  TelegramNativeDriver,
  telegramCommand,
  telegramHelpText,
} from './drivers/telegram.js';

export const name = 'dsh-overdrive-gateway-core';

/** 依赖注入：agents 是桥接的硬依赖；subagents 按需探测（不 inject，避免无 provider 的部署加载失败）。 */
export const inject = ['agents'];

export interface GatewayCoreConfig {
  /** 旧外部 gateway 模式共享 token（DSH_OVERDRIVE_TOKEN）。 */
  token?: string;
  port?: number;
  sessionPrefix?: string;
  cwd?: string;
  model?: { provider?: string; model?: string };
  approvalTimeoutMs?: number;
  /** 进程内原生模式：Telegram bot token（缺省回落 DSH_TELEGRAM_TOKEN）。 */
  telegramToken?: string;
  telegramAllowedUserIds?: number[];
  telegramAllowAllUsers?: boolean;
}

export interface GatewayCoreHandle {
  server?: ProtocolServer;
  ready?: Promise<{ port: number }>;
  bridge?: DshBridge;
  /** 已启动的进程内原生平台（如 ['telegram']）。 */
  native: string[];
  disabled?: true;
}

/**
 * DSH 插件入口。
 *
 * 两种工作形态（可并存，过渡期）：
 * 1) 进程内原生（推荐，P1 起）：平台 token 就绪即在该进程内直接驱动
 *    ctx.agents 会话，无需外部 gateway/自研协议。
 * 2) 旧模式：配置 DSH_OVERDRIVE_TOKEN 后开 ProtocolServer 供外部 gateway 连接。
 *
 * 任何配置缺失都**不抛异常**：插件以禁用态加载并告警，绝不影响 profile 启动。
 */
export function apply(ctx: Context, rawConfig: GatewayCoreConfig = {}): GatewayCoreHandle {
  const cwd = rawConfig.cwd;
  const sessionPrefix = rawConfig.sessionPrefix ?? 'dsh';
  const stopFns: Array<() => void> = [];
  const native: string[] = [];

  // —— 进程内原生：Telegram（有 token 即启动；无效/失败仅告警）——
  const telegramToken = rawConfig.telegramToken ?? process.env.DSH_TELEGRAM_TOKEN;
  if (telegramToken) {
    try {
      const driver = new TelegramNativeDriver({
        token: telegramToken,
        allowedUserIds: rawConfig.telegramAllowedUserIds,
        allowAllUsers: rawConfig.telegramAllowAllUsers,
      });
      const bridge = createNativeBridge(ctx, { driver, cwd, sessionPrefix, model: rawConfig.model });
      void driver
        .start(async (m) => {
          const cmd = telegramCommand(m.text);
          if (cmd === '/help') {
            void driver.send({ channel: m.channel, user: m.user }, { kind: 'complete', text: telegramHelpText });
            return;
          }
          if (cmd === '/new' || cmd === '/clear') {
            await bridge.runtime.destroyAgent?.(toDshSessionId(driver.platform, m.channel, m.user, sessionPrefix));
            void driver.send(
              { channel: m.channel, user: m.user },
              { kind: 'complete', text: cmd === '/new' ? '🆕 已开启新会话' : '🧹 已重置当前会话' },
            );
            return;
          }
          await bridge.handleUserMessage({ channel: m.channel, user: m.user }, m.text, m.media);
        })
        .catch((error) => {
          console.warn(
            `[dsh-overdrive-gateway-core] telegram 原生启动失败（token 无效？）：${error instanceof Error ? error.message : String(error)}`,
          );
        });
      stopFns.push(() => driver.stop());
      native.push('telegram');
      console.log('[dsh-overdrive-gateway-core] telegram 原生桥接已启动（进程内，无外部 gateway）');
    } catch (error) {
      console.warn(
        `[dsh-overdrive-gateway-core] telegram 原生初始化失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // —— 旧模式：外部 gateway 的协议服务端（仅当显式配置 token）——
  const token = rawConfig.token ?? process.env.DSH_OVERDRIVE_TOKEN;
  let server: ProtocolServer | undefined;
  let ready: Promise<{ port: number }> | undefined;
  let bridge: DshBridge | undefined;
  if (token) {
    const port = rawConfig.port ?? 3192;
    const approvalTimeoutMs = rawConfig.approvalTimeoutMs ?? 120_000;
    const handlers = {} as ProtocolHandlers;
    server = new ProtocolServer({ token, handlers, version: '0.1.0' });
    const runtime = createDshRuntime(ctx, { cwd, sessionPrefix, model: rawConfig.model });
    bridge = new DshBridge(server, runtime, { approvalTimeoutMs, cwd });
    Object.assign(handlers, bridge.handlers());
    bridge.start();
    ready = server.listen(port).then((p) => ({ port: p }));
    stopFns.push(() => {
      bridge?.dispose();
      void server?.close();
    });
    console.log(`[dsh-overdrive-gateway-core] loaded, protocol server on 127.0.0.1:${port} (token: ***)`);
  }

  if (native.length === 0 && !token) {
    console.warn(
      '[dsh-overdrive-gateway-core] 未配置任何桥接（插件保持加载，不影响 dsh 其它功能）。\n' +
        '  进程内原生模式（推荐）：设置环境变量 DSH_TELEGRAM_TOKEN=<bot token> 后重启，即可直接在 DSH 里聊 Telegram。\n' +
        '  旧外部 gateway 模式：设置 DSH_OVERDRIVE_TOKEN=<token>（与 gateway 相同）。',
    );
    return { native, disabled: true as const };
  }

  if (stopFns.length > 0) {
    ctx.effect(() => () => {
      for (const stop of stopFns) stop();
    });
  }

  return { server, ready, bridge, native };
}
