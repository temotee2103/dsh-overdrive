import { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import { ProtocolServer, type ProtocolHandlers } from '@dsh-overdrive/sdk';
import { DshBridge } from './bridge.js';
import { createDshRuntime } from './dsh-runtime.js';
import { toDshSessionId } from './keys.js';
import { createNativeBridge } from './native.js';
import { describeRemindDelay, parseRemindCommand } from './commands.js';
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

/** 配置 schema（对齐 apply 默认值；供 DSH 设置面/校验使用）。 */
export const Config: Schema<GatewayCoreConfig> = Schema.object({
  token: Schema.string().default(''),
  port: Schema.number().default(3192),
  sessionPrefix: Schema.string().default('dsh'),
  cwd: Schema.string().default(''),
  model: Schema.object({
    provider: Schema.string().default(''),
    model: Schema.string().default(''),
  }).default({ provider: '', model: '' }),
  approvalTimeoutMs: Schema.number().default(120000),
  telegramToken: Schema.string().default(''),
  telegramAllowedUserIds: Schema.array(Schema.number()).default([]),
  telegramAllowAllUsers: Schema.boolean().default(false),
});

/** DSH 设置页命名空间（小写 kebab；设置 → Plugins 区按此显示）。 */
export const OVERDRIVE_SETTINGS_NAMESPACE = 'overdrive';

/** 设置页表单 schema：非技术用户在此配置（保存后需重启生效）。 */
export const OverdriveUiSettingsSchema: Schema<{
  telegramToken: string;
  telegramAllowedUserIds: number[];
  telegramAllowAllUsers: boolean;
  sessionPrefix: string;
  approvalTimeoutMs: number;
}> = Schema.object({
  telegramToken: Schema.string().default(''),
  telegramAllowedUserIds: Schema.array(Schema.number()).default([]),
  telegramAllowAllUsers: Schema.boolean().default(false),
  sessionPrefix: Schema.string().default('dsh'),
  approvalTimeoutMs: Schema.number().default(120000),
});

/** 设置页用户值的外形（读写都在 DSH 设置服务）。 */
export interface OverdriveUiSettings {
  telegramToken?: string;
  telegramAllowedUserIds?: number[];
  telegramAllowAllUsers?: boolean;
  sessionPrefix?: string;
  approvalTimeoutMs?: number;
}

/** 纯函数：telegram 启动参数解析链 = 设置页(UI) > patch config > 环境变量。 */
export function resolveTelegramOptions(opts: {
  ui?: Partial<OverdriveUiSettings>;
  config?: GatewayCoreConfig;
  env?: NodeJS.ProcessEnv;
}): { token: string; allowedUserIds?: number[]; allowAllUsers?: boolean } | undefined {
  const { ui, config, env } = opts;
  const token = ui?.telegramToken?.trim() || config?.telegramToken?.trim() || env?.DSH_TELEGRAM_TOKEN?.trim() || undefined;
  if (!token) return undefined;
  return {
    token,
    allowedUserIds: ui?.telegramAllowedUserIds?.length
      ? ui.telegramAllowedUserIds
      : config?.telegramAllowedUserIds,
    allowAllUsers: ui?.telegramAllowAllUsers ?? config?.telegramAllowAllUsers,
  };
}

export interface GatewayCoreHandle {
  server?: ProtocolServer;
  ready?: Promise<{ port: number }>;
  bridge?: DshBridge;
  /** 已启动的进程内原生平台（如 ['telegram']）。 */
  native: string[];
  /** 是否成功注册 DSH 设置页命名空间。 */
  settingsRegistered?: boolean;
  disabled?: true;
}

interface TelegramOverrides {
  token: string;
  allowedUserIds?: number[];
  allowAllUsers?: boolean;
}

/**
 * DSH 插件入口。
 *
 * 1) 进程内原生（推荐）：telegram token 就绪即在本进程内驱动 ctx.agents 会话。
 *    token 来源链：DSH 设置页(overdrive) > patch config > DSH_TELEGRAM_TOKEN。
 * 2) 旧模式（legacy）：DSH_OVERDRIVE_TOKEN + 外部 gateway 协议服务端。
 *
 * 任意缺失都不抛异常：禁用态加载 + 告警，绝不影响 profile 启动。
 */
export function apply(ctx: Context, rawConfig: GatewayCoreConfig = {}): GatewayCoreHandle {
  const cwd = rawConfig.cwd;
  const sessionPrefix = rawConfig.sessionPrefix ?? 'dsh';
  const stopFns: Array<() => void> = [];
  const native: string[] = [];
  const reminderTimers = new Set<ReturnType<typeof setTimeout>>();

  // —— 注册 DSH 设置页命名空间（有 settings 服务才注册；失败仅告警）——
  let settingsRegistered = false;
  let uiSettings: Partial<OverdriveUiSettings> | undefined;
  try {
    const get = (ctx as unknown as { get?: (key: string) => unknown }).get?.bind(ctx);
    const settings = get?.('settings') as
      | { register?: (ns: unknown, schema: unknown, opts?: unknown) => { get?: () => Partial<OverdriveUiSettings> } }
      | undefined;
    if (settings?.register) {
      const scope = settings.register(settingsNamespace(OVERDRIVE_SETTINGS_NAMESPACE), OverdriveUiSettingsSchema, {
        applies: 'restart',
      });
      uiSettings = scope.get?.();
      settingsRegistered = true;
      console.log('[dsh-overdrive-gateway-core] 已注册设置项：DSH 设置 → Plugins → overdrive（保存后重启生效）');
    }
  } catch (error) {
    console.warn(
      `[dsh-overdrive-gateway-core] 设置项注册跳过：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const telegram = resolveTelegramOptions({ ui: uiSettings, config: rawConfig, env: process.env });
  if (telegram) {
    startNativeTelegram(ctx, rawConfig, {
      telegram,
      sessionPrefix,
      cwd,
      reminderTimers,
      onStart: (p) => {
        native.push(p);
        console.log('[dsh-overdrive-gateway-core] telegram 原生桥接已启动（进程内，无外部 gateway）');
      },
      onStop: (stop) => stopFns.push(stop),
    });
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
        '  配置方式：在 DSH 设置 → Plugins → overdrive 填入 Telegram Bot Token（最省心）；\n' +
        '  或设置环境变量 DSH_TELEGRAM_TOKEN=<bot token> 后重启。\n' +
        '  旧外部 gateway 模式：DSH_OVERDRIVE_TOKEN=<token>。',
    );
    return { native, settingsRegistered, disabled: true as const };
  }

  if (stopFns.length > 0) {
    ctx.effect(() => () => {
      for (const stop of stopFns) stop();
    });
  }

  return { server, ready, bridge, native, settingsRegistered };
}

/** 启动进程内原生 telegram 桥接（含 /remind /trace /help /new /clear 与审批回投）。 */
function startNativeTelegram(
  ctx: Context,
  rawConfig: GatewayCoreConfig,
  opts: {
    telegram: TelegramOverrides;
    sessionPrefix: string;
    cwd?: string;
    reminderTimers: Set<ReturnType<typeof setTimeout>>;
    onStart: (platform: string) => void;
    onStop: (stop: () => void) => void;
  },
): void {
  try {
    const driver = new TelegramNativeDriver({
      token: opts.telegram.token,
      allowedUserIds: opts.telegram.allowedUserIds,
      allowAllUsers: opts.telegram.allowAllUsers,
    });
    const bridge = createNativeBridge(ctx, {
      driver,
      cwd: opts.cwd,
      sessionPrefix: opts.sessionPrefix,
      model: rawConfig.model,
      approvalTimeoutMs: rawConfig.approvalTimeoutMs,
    });
    void driver
      .start(async (m) => {
        const remind = parseRemindCommand(m.text);
        if (remind) {
          const timer = setTimeout(() => {
            opts.reminderTimers.delete(timer);
            void driver.send(
              { channel: m.channel, user: m.user },
              { kind: 'complete', text: `⏰ 提醒：${remind.prompt}` },
            );
          }, remind.delayMs);
          opts.reminderTimers.add(timer);
          void driver.send(
            { channel: m.channel, user: m.user },
            { kind: 'complete', text: `已设置提醒（${describeRemindDelay(remind.delayMs)} 后）：${remind.prompt}` },
          );
          return;
        }
        if (m.text.trim() === '/trace') {
          const steps = bridge.trajectoryOf({ channel: m.channel, user: m.user });
          const body = steps.length > 0
            ? `🧭 最近轨迹：\n${steps.map((s) => `  · ${s}`).join('\n')}`
            : '（该会话暂无工具轨迹）';
          void driver.send({ channel: m.channel, user: m.user }, { kind: 'complete', text: body });
          return;
        }
        const cmd = telegramCommand(m.text);
        if (cmd === '/help') {
          void driver.send({ channel: m.channel, user: m.user }, { kind: 'complete', text: telegramHelpText });
          return;
        }
        if (cmd === '/new' || cmd === '/clear') {
          await bridge.runtime.destroyAgent?.(
            toDshSessionId(driver.platform, m.channel, m.user, opts.sessionPrefix),
          );
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
    opts.onStop(() => {
      driver.stop();
      for (const t of opts.reminderTimers) clearTimeout(t);
      opts.reminderTimers.clear();
    });
    opts.onStart('telegram');
  } catch (error) {
    console.warn(
      `[dsh-overdrive-gateway-core] telegram 原生初始化失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
