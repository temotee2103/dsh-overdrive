import { describe, expect, it } from 'vitest';
import { createDshRuntime, type DshRuntime } from '../src/dsh-runtime.js';

/** 最小可用的 Cordis ctx 替身：agents(create/resume) + on(event) + subagents。 */
function fakeCtx(overrides: Record<string, unknown> = {}) {
  const created: Array<Record<string, unknown>> = [];
  const resumed: Array<Record<string, unknown>> = [];
  const handlers = new Map<string, (payload: unknown, ...rest: unknown[]) => unknown>();
  const fakeAgent = { followup: () => {}, inject: () => {} };
  return {
    ctx: {
      agents: {
        create: async (opts: Record<string, unknown>) => { created.push(opts); return { agent: fakeAgent, dispose: async () => {} }; },
        resume: async () => { throw new Error('not persisted'); },
      },
      on: (event: string, cb: (payload: unknown, ...rest: unknown[]) => unknown) => { handlers.set(event, cb); },
      subagents: { start: async () => ({}) },
      ...overrides,
    } as Parameters<typeof createDshRuntime>[0],
    created,
    resumed,
    handlers,
  };
}

describe('createDshRuntime', () => {
  it('ensureAgent 首次走 create，二次命中缓存', async () => {
    const { ctx, created, resumed } = fakeCtx();
    const runtime = createDshRuntime(ctx, { cwd: 'C:/work' });

    const a1 = await runtime.ensureAgent('dsh:cli:cli:local');
    const a2 = await runtime.ensureAgent('dsh:cli:cli:local');
    expect(a1).toBe(a2);
    expect(created).toHaveLength(1);
    expect(resumed).toHaveLength(0);
    expect(created[0].sessionId).toBe('dsh:cli:cli:local');
    expect((created[0].meta as { cwd: string }).cwd).toBe('C:/work');
  });

  it('配置 model 时 agentOptions 带上 provider/model', async () => {
    const { ctx, created } = fakeCtx();
    const runtime = createDshRuntime(ctx, { model: { provider: 'deepseek', model: 'deepseek-chat' } });
    await runtime.ensureAgent('dsh:cli:cli:local');
    expect((created[0].agentOptions as { provider: string }).provider).toBe('deepseek');
    expect((created[0].agentOptions as { model: string }).model).toBe('deepseek-chat');
  });

  it('destroyAgent 调 dispose 并清空 live（再次 ensureAgent 重新 create）', async () => {
    const { ctx, created } = fakeCtx();
    let disposed = 0;
    ctx.agents.create = async (opts: Record<string, unknown>) => {
      created.push(opts);
      return {
        agent: { followup: () => {}, inject: () => {} },
        dispose: async () => { disposed++; },
      };
    };
    const runtime = createDshRuntime(ctx, { cwd: 'C:/work' });
    await runtime.ensureAgent('dsh:cli:cli:local');
    await runtime.destroyAgent?.('dsh:cli:cli:local');
    expect(disposed).toBe(1);
    expect(created).toHaveLength(1);

    // live 已清空 → 二次 ensureAgent 走 create 而非命中缓存
    await runtime.ensureAgent('dsh:cli:cli:local');
    expect(created).toHaveLength(2);
  });

  it('buildUserMessage 产出 {content, source}', () => {
    const { ctx } = fakeCtx();
    const runtime = createDshRuntime(ctx, {});
    const msg = runtime.buildUserMessage('hi') as { content: unknown[]; source: { kind: string } };
    expect(msg.content).toEqual([{ type: 'text', text: 'hi' }]);
    expect(msg.source.kind).toBe('user');
  });

  it('onSessionEvent 只回调本网关前缀的会话', () => {
    const { ctx, handlers } = fakeCtx();
    const runtime = createDshRuntime(ctx, { sessionPrefix: 'dsh' });
    const seen: string[] = [];
    runtime.onSessionEvent((sessionId) => { seen.push(sessionId); });

    const cb = handlers.get('session/event') as (session: { header: { id: string } }, event: unknown) => void;
    cb({ header: { id: 'dsh:cli:cli:local' } }, { type: 'turn/start', data: {} });
    cb({ header: { id: 'lark:1:2' } }, { type: 'turn/start', data: {} });
    expect(seen).toEqual(['dsh:cli:cli:local']);
  });

  it('onApprovalRequest 只应答本网关前缀的会话，其余委托 next', async () => {
    const { ctx, handlers } = fakeCtx();
    const runtime = createDshRuntime(ctx, { sessionPrefix: 'dsh' });
    const answered: string[] = [];
    runtime.onApprovalRequest((req, next) => {
      answered.push(req.agent.session.header.id);
      return Promise.resolve('allowed-once' as const);
    });

    const cb = handlers.get('approval/request') as (
      req: { agent: { session: { header: { id: string } } } },
      next: () => Promise<string>,
    ) => Promise<string>;

    const own = await cb({ agent: { session: { header: { id: 'dsh:cli:cli:local' } } }, toolName: 'bash' }, async () => 'unavailable');
    expect(own).toBe('allowed-once');

    let delegated = false;
    const other = await cb({ agent: { session: { header: { id: 'lark:1:2' } } }, toolName: 'bash' }, async () => {
      delegated = true;
      return 'unavailable';
    });
    expect(delegated).toBe(true);
    expect(other).toBe('unavailable');
    expect(answered).toEqual(['dsh:cli:cli:local']);
  });
});
