import { describe, expect, it, vi } from 'vitest';
import { createDshRuntime, imageMediaTypeFrom, type DshRuntime } from '../src/dsh-runtime.js';

/** 最小可用的 Cordis ctx 替身：agents(create/resume) + on(event) + get(subagents)。 */
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
      get: (key: string) => (key === 'subagents' ? { start: async () => ({}) } : undefined),
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

  it('无显式 model 时从 agentDefaultModel.currentSelection() 解析默认模型', async () => {
    const { ctx, created } = fakeCtx({
      get: (key: string) =>
        key === 'agentDefaultModel'
          ? { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) }
          : key === 'subagents' ? { start: async () => ({}) } : undefined,
    });
    const runtime = createDshRuntime(ctx, {});
    await runtime.ensureAgent('dsh:cli:cli:local');
    expect((created[0].agentOptions as { provider: string }).provider).toBe('deepseek');
    expect((created[0].agentOptions as { model: string }).model).toBe('deepseek-chat');
  });

  it('spawnSubagent 经 ctx.get(subagents) 调用（不经 inject 的属性访问）', async () => {
    const started: Array<{ provider: string; request: unknown }> = [];
    const { ctx } = fakeCtx({
      get: (key: string) =>
        key === 'subagents' ? { start: async (provider: string, request: unknown) => { started.push({ provider, request }); } } : undefined,
    });
    const runtime = createDshRuntime(ctx, {});
    const res = await runtime.spawnSubagent({ label: '调研', prompt: '调研竞品' });
    expect(res.taskId).toMatch(/^sub-/);
    expect(started[0].provider).toBe('spawn');
    expect(started[0].request).toMatchObject({ label: '调研', prompt: [{ type: 'text', text: '调研竞品' }] });
  });

  it('buildUserMessage 产出 {content, source}', async () => {
    const { ctx } = fakeCtx();
    const runtime = createDshRuntime(ctx, {});
    const msg = await runtime.buildUserMessage('hi') as { content: unknown[]; source: { kind: string } };
    expect(msg.content).toEqual([{ type: 'text', text: 'hi' }]);
    expect(msg.source.kind).toBe('user');
  });

  it('buildUserMessage 带 image media 且 attachments 服务不可用时降级为纯文本', async () => {
    const { ctx } = fakeCtx(); // 默认 get() 不提供 attachments
    const runtime = createDshRuntime(ctx, {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const msg = await runtime.buildUserMessage('看图', { kind: 'image', url: 'https://x/y.png' }) as { content: Array<{ type: string }> };
    expect(msg.content).toEqual([{ type: 'text', text: '看图' }]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('buildUserMessage 带 image media：下载 → saveImage → ImageBlock', async () => {
    const saved: Array<{ data: Uint8Array; mediaType: string }> = [];
    const { ctx } = fakeCtx({
      get: (key: string) =>
        key === 'attachments'
          ? {
              saveImage: async (req: { data: Uint8Array; mediaType: string }) => {
                saved.push(req);
                return { attachmentId: 'att-1', mediaType: req.mediaType, bytes: req.data.length, width: 10, height: 10, name: 'chat-image' };
              },
            }
          : key === 'subagents' ? { start: async () => ({}) } : undefined,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }));
    try {
      const runtime = createDshRuntime(ctx, {});
      const msg = await runtime.buildUserMessage('看图', { kind: 'image', url: 'https://x/y.png' }) as {
        content: Array<{ type: string; attachment?: unknown }>;
      };
      expect(msg.content).toHaveLength(2);
      expect(msg.content[1]).toMatchObject({ type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 3 } });
      expect(saved).toHaveLength(1);
      expect(saved[0].mediaType).toBe('image/png');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('buildUserMessage 带 image media：下载失败降级为纯文本', async () => {
    const { ctx } = fakeCtx({
      get: (key: string) =>
        key === 'attachments'
          ? { saveImage: async () => ({ attachmentId: 'att-1', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }) }
          : key === 'subagents' ? { start: async () => ({}) } : undefined,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    try {
      const runtime = createDshRuntime(ctx, {});
      const msg = await runtime.buildUserMessage('看图', { kind: 'image', url: 'https://x/y.png' }) as { content: Array<{ type: string }> };
      expect(msg.content).toEqual([{ type: 'text', text: '看图' }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('imageMediaTypeFrom 由 MIME 或 URL 扩展名解析图片类型', () => {
    expect(imageMediaTypeFrom('image/png', undefined)).toBe('image/png');
    expect(imageMediaTypeFrom('image/jpeg', undefined)).toBe('image/jpeg');
    expect(imageMediaTypeFrom('IMAGE/WEBP', undefined)).toBe('image/webp');
    expect(imageMediaTypeFrom(undefined, 'https://x/y.png')).toBe('image/png');
    expect(imageMediaTypeFrom(undefined, 'https://x/y.JPG?token=abc')).toBe('image/jpeg');
    expect(imageMediaTypeFrom('text/plain', 'https://x/y.gif')).toBe('image/gif');
    expect(imageMediaTypeFrom(undefined, 'https://x/y.bmp')).toBeNull();
    expect(imageMediaTypeFrom('application/pdf', undefined)).toBeNull();
    expect(imageMediaTypeFrom(undefined, 'https://x/noext')).toBeNull();
  });

  it('buildUserMessage 带 voice media 时文本末尾追加降级提示', async () => {
    const { ctx } = fakeCtx();
    const runtime = createDshRuntime(ctx, {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const msg = await runtime.buildUserMessage('', { kind: 'voice', url: 'https://x/v.ogg' }) as { content: Array<{ type: string; text: string }> };
    expect(msg.content).toEqual([{ type: 'text', text: '\n[收到语音消息，暂不支持转写]' }]);
    warn.mockRestore();
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
