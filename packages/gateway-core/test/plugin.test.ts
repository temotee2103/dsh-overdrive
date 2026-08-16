import { afterEach, describe, expect, it } from 'vitest';
import { apply, name } from '../src/index.js';

/** 最小可用的 Cordis Context 替身：只实现本插件用到的 effect。 */
function fakeCtx() {
  const disposers: Array<() => Promise<void> | void> = [];
  return {
    ctx: {
      effect(cb: () => unknown) {
        const out = cb();
        if (typeof out === 'function') disposers.push(out as () => Promise<void> | void);
      },
    } as Parameters<typeof apply>[0],
    disposers,
  };
}

describe('gateway-core 插件', () => {
  let disposers: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const d of disposers.splice(0).reverse()) await d();
  });

  it('插件名与协议服务端可启动、health 可访问', async () => {
    expect(name).toBe('dsh-overdrive-gateway-core');

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
});
