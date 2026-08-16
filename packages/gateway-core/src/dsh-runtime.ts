import type { Context } from '@deepseek-ai/cordis';
import {
  installModelSelection,
  type Agent,
  type ModelSelection,
  type ModelSelectionRef,
} from '@deepseek-ai/dsh-agent';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { DshSessionEvent } from './derive.js';

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';

/** 协议层透传的媒体引用（与 SDK SendMessageRequest.media 同构）。 */
export interface MediaRef {
  kind: 'voice' | 'image' | 'video' | 'file';
  url?: string;
  mime?: string;
  caption?: string;
}

/** DSH approval/request 载荷的结构化外形（harness-lark 同款声明，见其 feishu-approval.ts）。 */
export interface ApprovalRequestLike {
  readonly agent: { session: { header: { id: string } } };
  readonly toolName: string;
  readonly callId?: string;
  readonly reason?: string;
  readonly signal?: AbortSignal;
}

export interface AgentLike {
  sessionId: string;
  followup(msg: unknown): void;
  inject(msg: unknown): void;
  /** 可选：释放 agent 底层资源（会话重置 /new 时调用）。 */
  dispose?: () => Promise<void>;
}

/** gateway-core 桥接依赖的 DSH 最小面。测试用 Fake 实现，运行时由 ctx 提供。 */
export interface DshRuntime {
  ensureAgent(sessionId: string): Promise<AgentLike>;
  buildUserMessage(text: string, media?: MediaRef): unknown;
  onSessionEvent(cb: (sessionId: string, event: DshSessionEvent) => void): void;
  onApprovalRequest(
    cb: (req: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>,
  ): void;
  spawnSubagent(req: { label: string; prompt: string }): Promise<{ taskId: string }>;
  /** 可选：销毁 agent 实例并清空 live 映射（会话重置）。 */
  destroyAgent?(sessionId: string): Promise<void>;
}

export interface DshRuntimeOptions {
  cwd?: string;
  sessionPrefix?: string;
  model?: { provider?: string; model?: string };
}

/**
 * 把 Cordis ctx 翻译成 DshRuntime。
 * 会话生命周期遵循 harness-lark 已验证的模式：先 resume（撞 live 短暂重试），
 * 失败（未持久化）则 create。模型选择与 agent preset 挂载与 harness-lark 对齐。
 */
export function createDshRuntime(ctx: Context, opts: DshRuntimeOptions = {}): DshRuntime {
  const agents = ctx.agents;
  const prefix = opts.sessionPrefix ?? 'dsh';
  const live = new Map<string, AgentLike>();

  /** 解析模型选择：显式配置优先，否则用部署默认模型（agentDefaultModel，Web UI 配置的模型路由）。 */
  function resolveModelSelection(): ModelSelection | undefined {
    if (opts.model?.provider && opts.model?.model) {
      return { provider: opts.model.provider, model: opts.model.model };
    }
    const defaultModel = (ctx as unknown as { get?: (key: string) => unknown }).get?.('agentDefaultModel') as
      | { currentSelection?: () => ModelSelection }
      | undefined;
    if (defaultModel?.currentSelection) {
      const selection = defaultModel.currentSelection();
      if (selection) return selection;
    }
    return undefined;
  }

  async function ensureAgent(sessionId: string): Promise<AgentLike> {
    const existing = live.get(sessionId);
    if (existing) return existing;

    const selection = resolveModelSelection();
    const agentOptions = selection === undefined ? undefined : { provider: selection.provider, model: selection.model };
    const selectionRef: ModelSelectionRef = { current: selection, assembled: undefined };

    const setup = async (agentCtx: Context): Promise<void> => {
      // 模型选择必须安装，否则 loop 没有 provider/model 路由（M0 报告 §7.1）。
      if (selection !== undefined) installModelSelection(agentCtx, selectionRef);
      // 挂载部署默认 agent preset（与 Web 创建的会话同款工具集），失败不阻断。
      const presets = (agentCtx as unknown as { get?: (key: string) => unknown }).get?.('agentPresets');
      if (presets && typeof presets === 'object' && 'mount' in presets) {
        await (presets as { mount: (c: Context) => Promise<unknown> }).mount(agentCtx).catch(() => undefined);
      }
    };

    let handle: { agent: Agent; dispose: () => Promise<void> } | undefined;
    const LIVE_COLLISION_RETRIES = 3;
    const LIVE_COLLISION_DELAY_MS = 1000;
    for (let attempt = 0; attempt < LIVE_COLLISION_RETRIES; attempt++) {
      try {
        handle = await agents.resume({ resumeSessionId: SessionId(sessionId), agentOptions, setup });
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/while it is live|already exists/.test(message)) break; // 未持久化 → 走 create
        await new Promise((r) => setTimeout(r, LIVE_COLLISION_DELAY_MS));
      }
    }
    if (!handle) {
      handle = await agents.create({
        sessionId: SessionId(sessionId),
        meta: { cwd: opts.cwd ?? process.cwd() },
        agentOptions,
        setup,
      });
    }

    const entry: AgentLike = {
      sessionId,
      followup: (msg) => handle!.agent.followup(msg as Parameters<Agent['followup']>[0]),
      inject: (msg) => handle!.agent.inject(msg as Parameters<Agent['inject']>[0]),
      dispose: () => handle!.dispose(),
    };
    live.set(sessionId, entry);
    return entry;
  }

  /** 销毁 agent 实例并清空 live 映射；不存在则无操作。 */
  async function destroyAgent(sessionId: string): Promise<void> {
    const entry = live.get(sessionId);
    if (!entry) return;
    live.delete(sessionId);
    await entry.dispose?.();
  }

  return {
    ensureAgent,
    destroyAgent,

    buildUserMessage(text, media) {
      const content: Array<{ type: 'text'; text: string }> = [{ type: 'text', text }];
      if (media?.kind === 'image' && media.url) {
        // dsh-llm rc.6 的 ImageBlock 需要持久 attachment 引用（ctx.attachments.saveImage 落盘真实字节），
        // 仅凭 URL 无法构造合法 content block → 按计划降级为纯文本 + warn（多模态接入留 M5 后）。
        console.warn(`[gateway-core] 图片消息降级为文本（ImageBlock 需 attachment 引用，URL 直连暂不支持）: ${media.url}`);
      } else if (media?.kind === 'voice') {
        content[0] = { type: 'text', text: `${text}\n[收到语音消息，暂不支持转写]` };
        console.warn('[gateway-core] 收到语音消息，暂不支持转写；请发文字');
      }
      return createUserMessage({ content, source: { kind: 'user' } });
    },

    onSessionEvent(cb) {
      ctx.on(
        'session/event',
        ((session: { header: { id: string } }, event: DshSessionEvent) => {
          const sessionId = String(session.header.id);
          if (!sessionId.startsWith(`${prefix}:`)) return;
          cb(sessionId, event);
        }) as never,
      );
    },

    onApprovalRequest(cb) {
      ctx.on(
        'approval/request' as never,
        ((req: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>) => {
          const sessionId = req.agent.session.header.id;
          if (!sessionId.startsWith(`${prefix}:`)) return next();
          return cb(req, next);
        }) as never,
        { prepend: true } as never,
      );
    },

    async spawnSubagent(req) {
      const subagents = (ctx as unknown as { subagents?: { start: (provider: string, request: unknown) => Promise<unknown> } }).subagents;
      const taskId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (!subagents) throw new Error('subagents 服务不可用（部署未安装 provider）');
      await subagents.start('spawn', {
        label: req.label,
        prompt: [{ type: 'text', text: req.prompt }],
      });
      return { taskId };
    },
  };
}
