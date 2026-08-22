import type { Context } from '@deepseek-ai/cordis';
import {
  installModelSelection,
  type Agent,
  type ModelSelection,
  type ModelSelectionRef,
} from '@deepseek-ai/dsh-agent';
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm';
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

/** dsh-attachment 版本一路径接受的图片类型（结构等价，避免直接依赖传递包的类型）。 */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

const IMAGE_EXT_MAP: Record<string, ImageMediaType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

const IMAGE_MIME_MAP: Record<string, ImageMediaType> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
};

/** 纯函数：由 MIME 或 URL 扩展名解析附件商店接受的图片类型；无法识别返回 null。 */
export function imageMediaTypeFrom(mime?: string, url?: string): ImageMediaType | null {
  if (mime) {
    const normalized = mime.split(';')[0].trim().toLowerCase();
    if (normalized in IMAGE_MIME_MAP) return IMAGE_MIME_MAP[normalized] as ImageMediaType;
  }
  if (url) {
    const match = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url);
    if (match) {
      const ext = match[1].toLowerCase();
      if (ext in IMAGE_EXT_MAP) return IMAGE_EXT_MAP[ext] as ImageMediaType;
    }
  }
  return null;
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
  buildUserMessage(text: string, media?: MediaRef): Promise<unknown>;
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

  /**
   * 下载图片字节并经 attachments 商店落盘，返回 ImageBlock 可用的 attachment 引用。
   * 下载失败 / 类型不支持 / attachments 服务不可用 → 返回 null（调用方降级为文本）。
   */
  async function saveImageFromUrl(
    url: string,
    mime?: string,
  ): Promise<unknown | null> {
    const mediaType = imageMediaTypeFrom(mime, url);
    if (!mediaType) return null;
    const attachments = (ctx as unknown as { get?: (key: string) => unknown }).get?.('attachments') as
      | { saveImage?: (req: { data: Uint8Array; mediaType: string; name?: string }) => Promise<unknown> }
      | undefined;
    if (!attachments?.saveImage) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = new Uint8Array(await res.arrayBuffer());
      return await attachments.saveImage({ data, mediaType, name: 'chat-image' });
    } catch (error) {
      console.warn(`[gateway-core] 图片下载/保存失败: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  return {
    ensureAgent,
    destroyAgent,

    async buildUserMessage(text, media) {
      const content: ContentBlock[] = [{ type: 'text', text }];
      if (media?.kind === 'image' && media.url) {
        // 真实图片：下载 → ctx.attachments.saveImage 落盘 → ImageBlock（M5 后兑现）。
        // 平台 URL 需可匿名下载（Telegram getFile URL 可；Slack url_private / WhatsApp directPath 需平台鉴权，
        // 下载失败时优雅降级为纯文本）。模型是否具备视觉能力由部署决定。
        const ref = await saveImageFromUrl(media.url, media.mime);
        if (ref) {
          content.push({ type: 'image', attachment: ref } as ContentBlock);
        } else {
          console.warn(`[gateway-core] 图片消息降级为文本（下载/类型/attachments 服务不可用）: ${media.url}`);
        }
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
      // 用 ctx.get 访问（inject 之外的服务必须 get，直接取属性会抛
      // "cannot get property without inject"——真机验证发现的 bug）。
      const subagents = (ctx as unknown as { get?: (key: string) => unknown }).get?.('subagents') as
        | { start?: (provider: string, request: unknown) => Promise<unknown> }
        | undefined;
      const taskId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (!subagents?.start) throw new Error('subagents 服务不可用（部署未安装 provider）');
      await subagents.start('spawn', {
        label: req.label,
        prompt: [{ type: 'text', text: req.prompt }],
      });
      return { taskId };
    },
  };
}
