import { GatewayClient, type ServerEvent } from '@dsh-overdrive/sdk';
import type { Adapter, OutboundPayload } from './adapter.js';
import { Allowlist, buildSessionKey } from './session.js';
import { adapterEnvFromProcess, createAdapter, parseAdapterIds } from './config.js';
import { CliAdapter } from './adapters/cli.js';
import { parseCommand, HELP_TEXT, type ParsedCommand } from './commands.js';
import { TrajectoryAggregator, formatTrajectorySummary } from './trajectory.js';
import { createStatusServer } from './status.js';
import { createTranscriber, type AsrTranscriber } from './asr.js';
import { MemoryStore, memoryScope, formatMemories } from './memory.js';

/**
 * message.delta → 打字指示去重：同一 turn 内首个 delta 触发一次 typing，
 * complete 后复位，下一 turn 可再次触发。纯逻辑，便于单测。
 */
export class DeltaTracker {
  private readonly fired = new Set<string>();

  onDelta(sessionId: string, fireTyping: () => void): void {
    if (this.fired.has(sessionId)) return;
    this.fired.add(sessionId);
    fireTyping();
  }

  /** turn 结束（message.complete / error）时复位，允许下一 turn 再次触发 typing。 */
  onComplete(sessionId: string): void {
    this.fired.delete(sessionId);
  }
}

/** 事件 → 平台输出。纯函数，便于单测。返回 null 表示该事件不产出消息。 */
export function planOutbound(ev: ServerEvent): { payload: OutboundPayload } | null {
  switch (ev.type) {
    case 'message.complete':
      return { payload: { text: ev.text } };
    case 'message.delta':
      return null; // 流式渲染走 sendTyping（见 wireAdapter），不产出文本
    case 'trajectory.step': {
      const icon = ev.step.kind === 'tool' ? '🛠️' : ev.step.kind === 'subagent' ? '🤖' : '🧠';
      return { payload: { text: `${icon} ${ev.step.label}` } };
    }
    case 'trajectory.summary':
      return { payload: { text: formatTrajectorySummary(ev.steps) } };
    case 'approval.request':
      return {
        payload: {
          text: `⚠️ 需要批准：${ev.summary}（${Math.round(ev.timeoutMs / 1000)}s 内有效）`,
          buttons: [
            { id: `approve:${ev.reqId}`, label: '✅ 同意' },
            { id: `reject:${ev.reqId}`, label: '🚫 拒绝' },
          ],
        },
      };
    case 'agent.status':
      return ev.status === 'subagent-spawned'
        ? { payload: { text: '🤖 派生子任务…' } }
        : null;
    case 'task.done':
      return { payload: { text: ev.ok ? `✅ 任务完成 ${ev.taskId}` : `❌ 任务失败 ${ev.taskId}` } };
    case 'error':
      return { payload: { text: `❌ 出错了：${ev.message}` } };
    default:
      return null;
  }
}

export interface WireOptions {
  allowlist: string[];
  /** 开发逃生口：ALLOW_ALL=1 跳过白名单（生产勿开）。 */
  allowAll?: boolean;
  /** ASR 转写器；配置了 API key 时启用，语音消息转成文本再发给 agent。 */
  asr?: AsrTranscriber;
  /** 记忆系统（OpenClaw 式长期记忆）；未提供则记忆命令返回不可用。 */
  memory?: MemoryStore;
}

/** 纯函数：一次性提醒的时间 → cron 5 字段表达式（分钟精度）。 */
export function remindSchedule(minutes: number, atTime: string | null, now = new Date()): string {
  const target = new Date(now);
  if (atTime) {
    const [h, m] = atTime.split(':').map(Number);
    target.setHours(h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1); // 已过则明天
  } else {
    target.setMinutes(target.getMinutes() + minutes);
  }
  return `${target.getMinutes()} ${target.getHours()} ${target.getDate()} ${target.getMonth() + 1} *`;
}

/** 命令面分发：/trace /new /task /cron /agents /help /remind /remember /recall /forget（M4 + v0.3）。 */
async function handleCommand(
  adapter: Adapter,
  client: GatewayClient,
  command: ParsedCommand,
  sessionId: string,
  chatId: string,
  aggregator: TrajectoryAggregator,
  memory: MemoryStore | undefined,
): Promise<void> {
  switch (command.kind) {
    case 'trace': {
      const summary = aggregator.recentSummary(sessionId);
      await adapter.send(chatId, { text: summary ?? '暂无轨迹（尚未运行或已重置）。' });
      return;
    }
    case 'new': {
      await client.resetSession(sessionId);
      await adapter.send(chatId, { text: '🆕 会话已重置' });
      return;
    }
    case 'task': {
      await client.createTask({ sessionId, kind: 'subagent', prompt: command.prompt });
      await adapter.send(chatId, { text: '🤖 子任务已派出' });
      return;
    }
    case 'cron': {
      await client.createTask({ sessionId, kind: 'cron', prompt: command.prompt, schedule: command.schedule });
      await adapter.send(chatId, { text: '⏰ 定时任务已注册' });
      return;
    }
    case 'crons': {
      const res = await client.listTasks();
      const text = res.tasks.length
        ? res.tasks.map((task) => {
            const next = task.nextRunAt
              ? new Date(task.nextRunAt).toLocaleString('zh-CN', { hour12: false })
              : '（无下次触发）';
            return `- \`${task.id}\` ${task.schedule} — ${task.prompt}（下次 ${next}）`;
          }).join('\n')
        : '暂无定时任务。';
      await adapter.send(chatId, { text: `⏰ 定时任务（${res.tasks.length}）:\n${text}` });
      return;
    }
    case 'cronrm': {
      const res = await client.removeTask(command.taskId);
      await adapter.send(chatId, {
        text: res.ok ? `🗑️ 已删除定时任务 \`${command.taskId}\`` : `未找到定时任务 \`${command.taskId}\``,
      });
      return;
    }
    case 'agents': {
      await adapter.send(chatId, { text: '（M4 简化）子任务状态由 agent 汇报，/task 派发' });
      return;
    }
    case 'remember': {
      if (!memory) { await adapter.send(chatId, { text: '记忆系统未启用。' }); return; }
      const scope = memoryScope(adapter.id, sessionId.split(':')[2] ?? '');
      const entry = memory.add(scope, command.text);
      await adapter.send(chatId, { text: `✅ 已记住（\`${entry.id}\`）：${command.text}` });
      return;
    }
    case 'recall': {
      if (!memory) { await adapter.send(chatId, { text: '记忆系统未启用。' }); return; }
      const scope = memoryScope(adapter.id, sessionId.split(':')[2] ?? '');
      const hits = memory.search(scope, command.query);
      if (hits.length === 0) { await adapter.send(chatId, { text: '没有相关记忆。' }); return; }
      await adapter.send(chatId, {
        text: `🧠 ${hits.length} 条记忆：\n` + hits.map((e) => `- \`${e.id}\` ${e.text}`).join('\n'),
      });
      return;
    }
    case 'forget': {
      if (!memory) { await adapter.send(chatId, { text: '记忆系统未启用。' }); return; }
      const scope = memoryScope(adapter.id, sessionId.split(':')[2] ?? '');
      const ok = memory.remove(scope, command.memoryId);
      await adapter.send(chatId, { text: ok ? `🗑️ 已删除记忆 \`${command.memoryId}\`` : `未找到记忆 \`${command.memoryId}\`` });
      return;
    }
    case 'remind': {
      const schedule = remindSchedule(command.inMinutes ?? 0, command.atTime);
      await client.createTask({ sessionId, kind: 'cron', prompt: `⏰ 提醒：${command.text}`, schedule, once: true });
      await adapter.send(chatId, {
        text: `⏰ 已设置提醒「${command.text}」（${command.atTime ? `at ${command.atTime}` : `${command.inMinutes} 分钟后`}，一次性）`,
      });
      return;
    }
    case 'help': {
      await adapter.send(chatId, { text: HELP_TEXT });
      return;
    }
  }
}

/** 单个适配器的接线：白名单 → 命令面/upsert → sendMessage；按钮 → resolveApproval；事件流经轨迹聚合。 */
export async function wireAdapter(
  adapter: Adapter,
  client: GatewayClient,
  opts: WireOptions,
): Promise<void> {
  const allow = new Allowlist(opts.allowlist, opts.allowAll);
  const chatIds = new Map<string, string>();
  const aggregator = new TrajectoryAggregator();
  const deltas = new DeltaTracker();

  adapter.onMessage(async (msg) => {
    const key = buildSessionKey(adapter.id, msg);
    console.log(`[gateway][${adapter.id}] 收到消息 chat=${msg.chatId} user=${msg.userId} text="${msg.text.slice(0, 40)}"`);
    try {
      if (!allow.allows(key)) {
        await adapter.send(msg.chatId, { text: '⛔ 你不在白名单里。' });
        return;
      }
      chatIds.set(key, msg.chatId);

      const command = parseCommand(msg.text);
      if (command) {
        console.log(`[gateway][${adapter.id}] 命令: ${JSON.stringify(command)}`);
        await handleCommand(adapter, client, command, key, msg.chatId, aggregator, opts.memory);
        return;
      }

      // OpenClaw 式记忆注入：入站消息前检索相关记忆，拼到文本后让 agent「记得你」
      if (opts.memory) {
        const scope = memoryScope(adapter.id, msg.userId);
        const hits = opts.memory.search(scope, msg.text);
        if (hits.length > 0) {
          msg.text = `${msg.text}${formatMemories(hits)}`;
          console.log(`[gateway][${adapter.id}] 注入 ${hits.length} 条相关记忆`);
        }
      }

      // ASR 语音转写：配置了 API key 时把语音消息转成文本；失败/未配置走原降级路径
      if (msg.media?.kind === 'voice' && opts.asr?.enabled) {
        const transcript = await opts.asr.transcribe(msg.media);
        if (transcript) {
          msg.text = msg.text ? `${msg.text}\n[语音转写] ${transcript}` : `[语音转写] ${transcript}`;
          msg.media = undefined;
          console.log(`[gateway][${adapter.id}] 语音转写: ${transcript.slice(0, 60)}`);
        }
      }

      await client.upsertSession({ platform: adapter.id, channel: msg.chatId, user: msg.userId });
      console.log(`[gateway][${adapter.id}] upsertSession OK -> ${key}`);
      await client.sendMessage(key, { text: msg.text, media: msg.media });
      console.log(`[gateway][${adapter.id}] sendMessage OK`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[gateway][${adapter.id}] 处理失败: ${message}`);
      await adapter.send(msg.chatId, { text: `❌ 出错了：${message}` }).catch(() => undefined);
    }
  });

  adapter.onReply(async (buttonId, sender) => {
    try {
      const idx = buttonId.indexOf(':');
      if (idx < 0) return;
      const action = buttonId.slice(0, idx) as 'approve' | 'reject';
      const reqId = buttonId.slice(idx + 1);
      if ((action === 'approve' || action === 'reject') && reqId) {
        // 安全边界：审批按钮必须校验点击者（维护者评审指出：未授权用户可代授权）
        const senderKey = buildSessionKey(adapter.id, { chatId: sender.chatId, userId: sender.userId });
        if (!allow.allows(senderKey)) {
          console.warn(`[gateway][${adapter.id}] 按钮点击者不在白名单，拒绝批准: ${senderKey}`);
          if (sender.chatId) {
            await adapter.send(sender.chatId, { text: '⛔ 你不在白名单里，不能批准该操作。' }).catch(() => undefined);
          }
          return;
        }
        await client.resolveApproval(reqId, action);
      }
    } catch (error) {
      console.error(`[gateway] resolveApproval 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  const chatIdFor = (sessionId: string): string => {
    const known = chatIds.get(sessionId);
    if (known) return known;
    return sessionId.split(':')[1] ?? sessionId;
  };

  await client.connect((ev) => {
    // 流式渲染：delta → 打字指示（去重），complete/error → 复位（下一 turn 可再触发）
    if (ev.type === 'message.delta') {
      deltas.onDelta(ev.sessionId, () => void adapter.sendTyping?.(chatIdFor(ev.sessionId)));
    } else if (ev.type === 'message.complete' || ev.type === 'error') {
      deltas.onComplete(ev.sessionId);
    }

    // 轨迹聚合：trajectory.step 攒批，idle 时产出 trajectory.summary（减少刷屏）
    aggregator.onEvent(ev, (out) => {
      const planned = planOutbound(out);
      if (!planned) return;
      const chatId = chatIdFor(out.sessionId);
      console.log(`[gateway][${adapter.id}] 事件 ${out.type} -> 发送到 ${chatId}`);
      void adapter.send(chatId, planned.payload).then(
        () => console.log(`[gateway][${adapter.id}] 已发送 ${out.type} 到 ${chatId}`),
        (error) => console.error(`[gateway][${adapter.id}] 发送失败 ${out.type}: ${error instanceof Error ? error.message : String(error)}`),
      );
    });
  });
}

async function main(): Promise<void> {
  const dshBaseUrl = process.env.DSH_BASE_URL ?? 'http://127.0.0.1:3191';
  const dshToken = process.env.DSH_OVERDRIVE_TOKEN ?? process.env.DSH_TOKEN ?? 'dev-token';
  const allowlist = (process.env.ALLOWLIST ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const allowAll = process.env.ALLOW_ALL === '1';
  const adapterIds = parseAdapterIds(process.env.GATEWAY_ADAPTERS ?? 'cli');
  const env = adapterEnvFromProcess();
  const asr = createTranscriber({
    apiKey: env.asrApiKey,
    baseUrl: env.asrBaseUrl,
    model: env.asrModel,
  });
  if (asr.enabled) console.log('[gateway] ASR 语音转写已启用');
  const memory = new MemoryStore(process.env.MEMORY_FILE ?? 'data/memory.json');
  console.log(`[gateway] 记忆系统已启用（文件: ${process.env.MEMORY_FILE ?? 'data/memory.json'}）`);

  const client = new GatewayClient(dshBaseUrl, dshToken);
  await client.health(); // 确认 DSH 侧（或 mock）活着

  const adapters: Adapter[] = adapterIds.map((id) => createAdapter(id, env));
  for (const adapter of adapters) {
    await adapter.connect();
    await wireAdapter(adapter, client, { allowlist, allowAll, asr, memory });
    console.log(`[gateway] ${adapter.id} 适配器已就绪`);
  }

  const consolePort = Number(process.env.GATEWAY_CONSOLE_PORT ?? 3190);
  const status = createStatusServer({ adapters, client, version: '0.1.0' });
  await status.listen(consolePort);
  console.log(`[gateway] 控制台 http://0.0.0.0:${consolePort}/`);

  process.stdout.write(`[gateway] 就绪（适配器: ${adapterIds.join(', ')}）。Ctrl+C 退出。\n`);
}

if (process.argv[1]?.endsWith('index.js')) void main();

// 保留 CLI 的直接导入（E2E 用）
export { CliAdapter };
