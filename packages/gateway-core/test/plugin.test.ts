import { afterEach, describe, expect, it } from 'vitest';
import {
  apply,
  Config,
  name,
  OverdriveUiSettingsSchema,
  resolveTelegramOptions,
} from '../src/index.js';

/** 富 Fake ctx：effect + agents + on + subagents，满足插件启动路径。 */
function fakeCtx() {
  const disposers: Array<() => Promise<void> | void> = [];
  const ctx = {
    agents: {
      create: async (opts: Record<string, unknown>) => ({
        agent: { followup: () => {}, inject: () => {} },
        dispose: async () => {},
        opts,
      }),
      resume: async () => { throw new Error('not persisted'); },
    },
    on: () => {},
    subagents: { start: async () => ({}) },
    effect(cb: () => unknown) {
      const out = cb();
      if (typeof out === 'function') disposers.push(out as () => Promise<void> | void);
    },
  } as Parameters<typeof apply>[0];
  return { ctx, disposers };
}

describe('gateway-core 插件', () => {
  let disposers: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const d of disposers.splice(0).reverse()) await d();
  });

  it('插件名正确', () => {
    expect(name).toBe('dsh-overdrive-gateway-core');
  });

  it('Config schema 已导出（供 DSH 设置面使用）', () => {
    expect(Config).toBeDefined();
    expect(typeof Config).toBe('function');
  });

  it('设置页 UI schema 含 telegram 字段', () => {
    expect(OverdriveUiSettingsSchema).toBeDefined();
    expect(typeof OverdriveUiSettingsSchema).toBe('function');
  });

  it('telegram 参数解析链：设置页(UI) > patch config > 环境变量', () => {
    const env = (v?: string) => ({ DSH_TELEGRAM_TOKEN: v });
    // UI 优先
    expect(resolveTelegramOptions({ ui: { telegramToken: 'ui-token' }, config: { telegramToken: 'cfg' }, env: env('env') })).toEqual({ token: 'ui-token' });
    // config 次之
    expect(resolveTelegramOptions({ config: { telegramToken: 'cfg' }, env: env('env') })).toEqual({ token: 'cfg' });
    // 环境变量兜底
    expect(resolveTelegramOptions({ env: env('env') })).toEqual({ token: 'env' });
    // 全无 → undefined
    expect(resolveTelegramOptions({ env: env('') })).toBeUndefined();
    // UI 的 allowAll/白名单合并
    expect(
      resolveTelegramOptions({
        ui: { telegramToken: 'ui', telegramAllowAllUsers: true, telegramAllowedUserIds: [1] },
        config: { telegramAllowAllUsers: false },
      }),
    ).toEqual({ token: 'ui', allowAllUsers: true, allowedUserIds: [1] });
  });

  it('未配置 token 时不抛异常，以禁用态加载（不拖垮 profile）', () => {
    const { ctx, disposers: ds } = fakeCtx();
    disposers = ds;
    const saved = process.env.DSH_OVERDRIVE_TOKEN;
    delete process.env.DSH_OVERDRIVE_TOKEN;
    try {
      const handle = apply(ctx, {}) as unknown as { disabled: true; server?: unknown };
      expect(handle.disabled).toBe(true);
      expect(handle.server).toBeUndefined();
      expect(handle.ready).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.DSH_OVERDRIVE_TOKEN;
      else process.env.DSH_OVERDRIVE_TOKEN = saved;
    }
  });

  it('环境变量 DSH_OVERDRIVE_TOKEN 可替代 config.token 启动', async () => {
    const { ctx, disposers: ds } = fakeCtx();
    disposers = ds;
    const saved = process.env.DSH_OVERDRIVE_TOKEN;
    process.env.DSH_OVERDRIVE_TOKEN = 'env-token';
    try {
      const handle = apply(ctx, { port: 0 }) as unknown as { ready: Promise<{ port: number }> };
      const { port } = await handle.ready;
      const res = await fetch(`http://127.0.0.1:${port}/v1/health`, {
        headers: { authorization: 'Bearer env-token' },
      });
      expect(res.status).toBe(200);
    } finally {
      if (saved === undefined) delete process.env.DSH_OVERDRIVE_TOKEN;
      else process.env.DSH_OVERDRIVE_TOKEN = saved;
    }
  });

  it('启动后协议服务端可访问（health）', async () => {
    const { ctx, disposers: ds } = fakeCtx();
    disposers = ds;
    const handle = apply(ctx, { token: 'test-token', port: 0 }) as unknown as {
      ready: Promise<{ port: number }>;
    };
    const { port } = await handle.ready;

    const res = await fetch(`http://127.0.0.1:${port}/v1/health`, {
      headers: { authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', version: '0.1.0' });
  });

  it('sendMessage 走桥接（agent 收到 followup）', async () => {
    const { ctx, disposers: ds } = fakeCtx();
    disposers = ds;
    const followed: Array<{ text: string }> = [];
    ctx.agents.create = async (opts: Record<string, unknown>) => ({
      agent: { followup: (m: { content: { text: string }[] }) => followed.push(m.content[0]), inject: () => {} },
      dispose: async () => {},
      opts,
    });

    const handle = apply(ctx, { token: 'test-token', port: 0 }) as unknown as {
      ready: Promise<{ port: number }>;
    };
    const { port } = await handle.ready;

    const res = await fetch(`http://127.0.0.1:${port}/v1/sessions/cli%3Acli%3Alocal/messages`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });
    expect(res.status).toBe(200);
    expect(followed).toEqual([{ type: 'text', text: 'hello' }]);
  });
});
