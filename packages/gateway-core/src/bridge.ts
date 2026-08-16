import {
  ProtocolServer,
  parseSessionKey,
  sessionKey,
  type ProtocolHandlers,
  type ServerEvent,
} from '@dsh-overdrive/sdk';
import type { ApprovalOutcome, ApprovalRequestLike, DshRuntime } from './dsh-runtime.js';
import { cronMatches, parseCron, type CronSchedule } from './cron.js';
import { deriveProtocolEvents } from './derive.js';
import { fromDshSessionId, toDshSessionId } from './keys.js';

export interface BridgeOptions {
  /** 审批超时（毫秒），超时自动拒绝。 */
  approvalTimeoutMs?: number;
  /** cron 调度循环间隔（毫秒），默认 30s；测试可注入缩短。 */
  cronLoopIntervalMs?: number;
}

interface PendingApproval {
  sessionId: string;
  resolve: (outcome: ApprovalOutcome) => void;
  timeout: NodeJS.Timeout;
}

/** 一条已注册的 cron 任务。sessionId 存协议会话键（platform:channel:user）。 */
interface CronJob {
  sessionId: string;
  schedule: string;
  cron: CronSchedule;
  prompt: string;
  /** 上次触发的分钟桶（ms），防止同一分钟重复触发。 */
  lastFiredAtMs: number;
}

const CRON_LOOP_INTERVAL_MS = 30_000;

/**
 * 协议层与 DSH 之间的桥：会话 upsert/注入、事件转发（含轨迹派生）、
 * 审批应答（answerer，M0 报告 D5：网关侧自建应答通道）、子任务委托。
 */
export class DshBridge {
  private readonly pendings = new Map<string, PendingApproval>();
  private readonly cronJobs = new Map<string, CronJob>();
  private readonly approvalTimeoutMs: number;
  private readonly cronLoopIntervalMs: number;
  private cronTimer?: NodeJS.Timeout;

  constructor(
    private readonly server: ProtocolServer,
    private readonly runtime: DshRuntime,
    opts: BridgeOptions = {},
  ) {
    this.approvalTimeoutMs = opts.approvalTimeoutMs ?? 120_000;
    this.cronLoopIntervalMs = opts.cronLoopIntervalMs ?? CRON_LOOP_INTERVAL_MS;
  }

  /** 订阅 DSH 事件与审批 waterfall，并启动 cron 调度循环。 */
  start(): void {
    this.runtime.onSessionEvent((sessionId, event) => {
      // DSH 事件 sessionId 带 `dsh:` 前缀（DSH 侧会话 id）；协议事件必须用协议键
      // `platform:channel:user`，否则 gateway 无法映射回聊天（真机验证发现的 bug）。
      const protocolSessionId = this.toProtocolSessionId(sessionId);
      for (const ev of deriveProtocolEvents(protocolSessionId, event)) this.server.emit(ev);
    });
    this.runtime.onApprovalRequest((req, next) => this.answerApproval(req, next));
    this.startCronLoop();
  }

  /** DSH 会话 id（dsh:platform:channel:user）→ 协议会话键（platform:channel:user）。 */
  private toProtocolSessionId(dshSessionId: string): string {
    try {
      const { platform, channel, user } = fromDshSessionId(dshSessionId);
      return sessionKey(platform, channel, user);
    } catch {
      return dshSessionId; // 非本网关前缀（如 mock）原样透传
    }
  }

  /** 释放定时器资源（ctx.effect / server 关闭时调用）。 */
  dispose(): void {
    if (this.cronTimer) {
      clearInterval(this.cronTimer);
      this.cronTimer = undefined;
    }
  }

  /** 每 30s 检查 cronJobs：命中且分钟未触发过 → 空闲唤醒 agent 发 followup。 */
  private startCronLoop(): void {
    if (this.cronTimer) return;
    const timer = setInterval(() => void this.checkCronJobs(), this.cronLoopIntervalMs);
    timer.unref?.(); // 不阻塞进程退出
    this.cronTimer = timer;
  }

  private async checkCronJobs(): Promise<void> {
    const now = new Date();
    const bucket = new Date(now);
    bucket.setSeconds(0, 0);
    const bucketMs = bucket.getTime();

    for (const job of this.cronJobs.values()) {
      if (job.lastFiredAtMs === bucketMs) continue; // 本分钟已触发
      if (!cronMatches(job.cron, now)) continue;
      job.lastFiredAtMs = bucketMs;
      try {
        const { platform, channel, user } = parseSessionKey(job.sessionId);
        const agent = await this.runtime.ensureAgent(toDshSessionId(platform, channel, user));
        agent.followup(this.runtime.buildUserMessage(job.prompt));
        console.log(`[dsh-overdrive-gateway-core] cron 触发: ${job.schedule} → ${job.sessionId}（${job.prompt}）`);
      } catch (error) {
        console.warn(`[dsh-overdrive-gateway-core] cron 触发失败（${job.sessionId}）: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
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
        agent.followup(this.runtime.buildUserMessage(req.text, req.media));
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
          if (!req.schedule) throw new Error('cron 任务需要 schedule（5 字段：分 时 日 月 周）');
          const cron = parseCron(req.schedule); // 非法表达式直接抛错，注册失败
          const taskId = `cron-${Date.now()}`;
          this.cronJobs.set(req.prompt, {
            sessionId: req.sessionId,
            schedule: req.schedule,
            cron,
            prompt: req.prompt,
            lastFiredAtMs: -1,
          });
          return { taskId };
        }
        const result = await this.runtime.spawnSubagent({
          label: req.prompt.slice(0, 40),
          prompt: req.prompt,
        });
        return { taskId: result.taskId };
      },
      resetSession: async (sessionId) => {
        const { platform, channel, user } = parseSessionKey(sessionId);
        await this.runtime.destroyAgent?.(toDshSessionId(platform, channel, user));
        return { ok: true };
      },
    };
  }

  private answerApproval(
    req: ApprovalRequestLike,
    _next: () => Promise<ApprovalOutcome>,
  ): Promise<ApprovalOutcome> {
    const dshSessionId = req.agent.session.header.id;
    const sessionId = this.toProtocolSessionId(dshSessionId);
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
