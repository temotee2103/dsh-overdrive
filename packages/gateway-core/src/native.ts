import type { Context } from '@deepseek-ai/cordis';
import {
  createDshRuntime,
  type ApprovalOutcome,
  type DshRuntime,
  type DshRuntimeOptions,
  type MediaRef,
} from './dsh-runtime.js';
import { extractAssistantText, type DshSessionEvent } from './derive.js';
import { fromDshSessionId, toDshSessionId } from './keys.js';

/**
 * 进程内原生桥接接缝（P0 起，进程内化迁移）。
 *
 * 与旧架构的区别：不再经 ProtocolServer + 外部 gateway，而是平台 driver
 * 直接在 DSH 进程内驱动 ctx.agents 会话。会话 id 沿用
 * `dsh:<platform>:<channel>:<user>`（keys.ts）。
 * 审批（P2-b）：DSH approval/request → driver 'approval' 载荷；用户回复
 * 「批准/拒绝」类关键词由 handleUserMessage 解析并解决；超时自动取消。
 */

/** 平台 driver 收到的出站载荷（由 DSH 会话事件/审批请求派生）。 */
export type NativeOutbound =
  | { kind: 'status'; status: 'busy' | 'idle' }
  | { kind: 'delta'; text: string }
  | { kind: 'complete'; text: string }
  | { kind: 'trajectory'; step: { kind: 'tool' | 'thought' | 'note'; label: string } }
  | { kind: 'approval'; summary: string; timeoutMs: number };

/** 一个平台驱动的抽象面：平台连接 + 把载荷发给会话的 (channel,user)。 */
export interface NativeDriver {
  /** 平台名（进会话 key，如 'telegram'/'feishu'/'cli'）。 */
  readonly platform: string;
  /** 发送一条出站载荷到该会话；实现方负责分片/排版/按钮。 */
  send(to: { channel: string; user: string }, outbound: NativeOutbound): Promise<void> | void;
}

/** NativeBridge 构造参数：runtime 选项 + 平台 driver。 */
export interface NativeBridgeOptions extends DshRuntimeOptions {
  driver: NativeDriver;
  /** 审批等待超时（毫秒），默认 120s。 */
  approvalTimeoutMs?: number;
}

export interface NativeBridge {
  /**
   * 入站：用户消息。若该会话有待决审批且文本命中「批准/拒绝」，则解决审批
   * 并返回 true（不转发给 agent）；否则转发给 agent 并返回 false。
   */
  handleUserMessage(
    to: { channel: string; user: string },
    text: string,
    media?: MediaRef,
  ): Promise<boolean>;
  /** 访问底层 runtime（测试/高级扩展用）。 */
  readonly runtime: DshRuntime;
}

/** DSH SessionEvent → NativeOutbound 的纯函数映射（与 deriveProtocolEvents 同语义，但不依赖 SDK 类型）。 */
export function deriveNativeOutbound(event: DshSessionEvent): NativeOutbound[] {
  switch (event.type) {
    case 'turn/start':
      return [{ kind: 'status', status: 'busy' }];
    case 'turn/end':
      return [{ kind: 'status', status: 'idle' }];
    case 'assistant/chunk': {
      const chunk = event.data.chunk as { type?: string; text?: string } | undefined;
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.length > 0) {
        return [{ kind: 'delta', text: chunk.text }];
      }
      return [];
    }
    case 'assistant/message': {
      const text = extractAssistantText(event);
      if (!text) return [];
      return [{ kind: 'complete', text }];
    }
    case 'tool/call': {
      const name = typeof event.data.name === 'string' ? event.data.name : 'unknown';
      return [{ kind: 'trajectory', step: { kind: 'tool', label: name } }];
    }
    default:
      return [];
  }
}

/** 会话事件里该会话的 (channel,user)，供 driver 回投；非网关前缀返回 null。 */
export function outboundTarget(
  sessionId: string,
  prefix = 'dsh',
): { channel: string; user: string } | null {
  try {
    const { platform: _platform, channel, user } = fromDshSessionId(sessionId, prefix);
    return { channel, user };
  } catch {
    return null;
  }
}

/** 审批回复关键词（对齐旧 bridge 的文字审批：批准/拒绝）。 */
const APPROVE_RE = /^(批准|同意|确认|好的|可以|允许|yes|ok)(?![a-z])/i;
const REJECT_RE = /^(拒绝|不同意|取消|不要|否|驳回|no)(?![a-z])/i;

/** 纯函数：文本是否命中「批准」回复。 */
export function isApproveReply(text: string): boolean {
  const t = text.trim();
  return APPROVE_RE.test(t) || t === '1';
}

/** 纯函数：文本是否命中「拒绝」回复。 */
export function isRejectReply(text: string): boolean {
  const t = text.trim();
  return REJECT_RE.test(t) || t === '0';
}

interface PendingApproval {
  resolve: (outcome: ApprovalOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
}

/**
 * 创建进程内原生桥接：入站消息 → runtime.ensureAgent/followup；
 * runtime 的 session/event → deriveNativeOutbound → driver.send；
 * approval/request → driver 'approval' + 入站关键词解析。
 */
export function createNativeBridge(ctx: Context, options: NativeBridgeOptions): NativeBridge {
  const runtime = createDshRuntime(ctx, {
    cwd: options.cwd,
    sessionPrefix: options.sessionPrefix,
    model: options.model,
  });
  const driver = options.driver;
  const prefix = options.sessionPrefix ?? 'dsh';
  const approvalTimeoutMs = options.approvalTimeoutMs ?? 120_000;
  const pendingApprovals = new Map<string, PendingApproval>();

  runtime.onSessionEvent((sessionId, event) => {
    const target = outboundTarget(sessionId, prefix);
    if (!target) return; // 非本网关注入的会话（如 Web 创建的）不在此桥接
    for (const outbound of deriveNativeOutbound(event)) {
      try {
        void driver.send(target, outbound);
      } catch (error) {
        console.warn(
          `[gateway-core] ${driver.platform} 出站发送失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  });

  runtime.onApprovalRequest((req, next) => {
    const sessionId = req.agent.session.header.id;
    const target = outboundTarget(sessionId, prefix);
    if (!target) return next(); // 非网关会话交给默认处理

    return new Promise<ApprovalOutcome>((resolve) => {
      const timer = setTimeout(() => {
        const pending = pendingApprovals.get(sessionId);
        if (pending && !pending.settled) {
          pending.settled = true;
          pendingApprovals.delete(sessionId);
          resolve('cancelled');
        }
      }, approvalTimeoutMs);
      pendingApprovals.set(sessionId, {
        timer,
        settled: false,
        resolve: (outcome) => {
          const pending = pendingApprovals.get(sessionId);
          if (!pending || pending.settled) return;
          pending.settled = true;
          clearTimeout(pending.timer);
          pendingApprovals.delete(sessionId);
          resolve(outcome);
        },
      });
      const summary = req.reason ?? `是否允许执行工具调用「${req.toolName}」？`;
      try {
        void driver.send(target, { kind: 'approval', summary, timeoutMs: approvalTimeoutMs });
      } catch (error) {
        console.warn(
          `[gateway-core] ${driver.platform} 审批请求发送失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  });

  return {
    runtime,
    async handleUserMessage(to, text, media) {
      const dshSessionId = toDshSessionId(driver.platform, to.channel, to.user, prefix);
      const pending = pendingApprovals.get(dshSessionId);
      if (pending && !pending.settled) {
        if (isApproveReply(text)) {
          pending.resolve('allowed-once');
          return true;
        }
        if (isRejectReply(text)) {
          pending.resolve('rejected');
          return true;
        }
      }
      const agent = await runtime.ensureAgent(dshSessionId);
      agent.followup(await runtime.buildUserMessage(text, media));
      return false;
    },
  };
}
