import {
  ProtocolServer,
  parseSessionKey,
  sessionKey,
  type ProtocolHandlers,
  type ServerEvent,
} from '@dsh-overdrive/sdk';
import type { ApprovalOutcome, ApprovalRequestLike, DshRuntime } from './dsh-runtime.js';
import { deriveProtocolEvents } from './derive.js';
import { toDshSessionId } from './keys.js';

export interface BridgeOptions {
  /** 审批超时（毫秒），超时自动拒绝。 */
  approvalTimeoutMs?: number;
}

interface PendingApproval {
  sessionId: string;
  resolve: (outcome: ApprovalOutcome) => void;
  timeout: NodeJS.Timeout;
}

/**
 * 协议层与 DSH 之间的桥：会话 upsert/注入、事件转发（含轨迹派生）、
 * 审批应答（answerer，M0 报告 D5：网关侧自建应答通道）、子任务委托。
 */
export class DshBridge {
  private readonly pendings = new Map<string, PendingApproval>();
  private readonly approvalTimeoutMs: number;

  constructor(
    private readonly server: ProtocolServer,
    private readonly runtime: DshRuntime,
    opts: BridgeOptions = {},
  ) {
    this.approvalTimeoutMs = opts.approvalTimeoutMs ?? 120_000;
  }

  /** 订阅 DSH 事件与审批 waterfall。 */
  start(): void {
    this.runtime.onSessionEvent((sessionId, event) => {
      for (const ev of deriveProtocolEvents(sessionId, event)) this.server.emit(ev);
    });
    this.runtime.onApprovalRequest((req, next) => this.answerApproval(req, next));
  }

  handlers(): ProtocolHandlers {
    return {
      upsertSession: async ({ platform, channel, user }) => {
        await this.runtime.ensureAgent(toDshSessionId(platform, channel, user));
        return { sessionId: sessionKey(platform, channel, user) };
      },
      sendMessage: async (protocolSessionId, req) => {
        const { platform, channel, user } = parseSessionKey(protocolSessionId);
        const agent = await this.runtime.ensureAgent(toDshSessionId(platform, channel, user));
        agent.followup(this.runtime.buildUserMessage(req.text));
        return { runId: `${Date.now()}` };
      },
      resolveApproval: async (reqId, decision) => {
        const pending = this.pendings.get(reqId);
        if (!pending) return { ok: false };
        clearTimeout(pending.timeout);
        this.pendings.delete(reqId);
        pending.resolve(decision === 'approve' ? 'allowed-once' : 'rejected');
        return { ok: true };
      },
      createTask: async (req) => {
        if (req.kind === 'cron') {
          throw new Error('cron 任务在 M4 提供（gateway-core 自带调度器），当前版本仅支持 subagent');
        }
        const result = await this.runtime.spawnSubagent({
          label: req.prompt.slice(0, 40),
          prompt: req.prompt,
        });
        return { taskId: result.taskId };
      },
    };
  }

  private answerApproval(
    req: ApprovalRequestLike,
    _next: () => Promise<ApprovalOutcome>,
  ): Promise<ApprovalOutcome> {
    const sessionId = req.agent.session.header.id;
    const reqId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<ApprovalOutcome>((resolve) => {
      const pending: PendingApproval = {
        sessionId,
        resolve,
        timeout: setTimeout(() => {
          this.pendings.delete(reqId);
          resolve('rejected');
        }, this.approvalTimeoutMs),
      };
      pending.timeout.unref?.();
      this.pendings.set(reqId, pending);

      this.server.emit({
        type: 'approval.request',
        sessionId,
        ts: Date.now(),
        reqId,
        summary: `工具 ${req.toolName}${req.reason ? `：${req.reason}` : ''}`,
        timeoutMs: this.approvalTimeoutMs,
      });

      req.signal?.addEventListener('abort', () => {
        const current = this.pendings.get(reqId);
        if (current !== pending) return;
        clearTimeout(pending.timeout);
        this.pendings.delete(reqId);
        resolve('cancelled');
      }, { once: true });
    });
  }
}

// 让 ServerEvent 的联合类型在编译期被引用，避免未使用告警（审批事件经 server.emit 发送）。
export type { ServerEvent };
