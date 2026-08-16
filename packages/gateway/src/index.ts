import { GatewayClient, type ServerEvent } from '@dsh-overdrive/sdk';
import type { Adapter, OutboundPayload } from './adapter.js';
import { Allowlist, buildSessionKey } from './session.js';
import { CliAdapter } from './adapters/cli.js';

/** 事件 → 平台输出。纯函数，便于单测。返回 null 表示该事件不产出消息。 */
export function planOutbound(ev: ServerEvent): { payload: OutboundPayload } | null {
  switch (ev.type) {
    case 'message.complete':
      return { payload: { text: ev.text } };
    case 'message.delta':
      return null; // MVP：等 complete 一次性输出，流式渲染放 M4
    case 'trajectory.step': {
      const icon = ev.step.kind === 'tool' ? '🛠️' : ev.step.kind === 'subagent' ? '🤖' : '🧠';
      return { payload: { text: `${icon} ${ev.step.label}` } };
    }
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

async function main(): Promise<void> {
  const dshBaseUrl = process.env.DSH_BASE_URL ?? 'http://127.0.0.1:3191';
  const dshToken = process.env.DSH_TOKEN ?? 'dev-token';
  const allowlist = (process.env.ALLOWLIST ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);

  const client = new GatewayClient(dshBaseUrl, dshToken);
  const adapter: Adapter = new CliAdapter();
  const allow = new Allowlist(allowlist);
  const chatIds = new Map<string, string>();

  await client.health(); // 确认 DSH 侧（或 mock）活着
  await adapter.connect();

  adapter.onMessage(async (msg) => {
    const key = buildSessionKey(adapter.id, msg);
    if (!allow.allows(key)) {
      await adapter.send(msg.chatId, { text: '⛔ 你不在白名单里。' });
      return;
    }
    chatIds.set(key, msg.chatId);
    await client.upsertSession({ platform: adapter.id, channel: msg.chatId, user: msg.userId });
    await client.sendMessage(key, { text: msg.text, media: msg.media });
  });

  adapter.onReply(async (buttonId) => {
    const idx = buttonId.indexOf(':');
    if (idx < 0) return;
    const action = buttonId.slice(0, idx);
    const reqId = buttonId.slice(idx + 1);
    if ((action === 'approve' || action === 'reject') && reqId) {
      await client.resolveApproval(reqId, action);
    }
  });

  const chatIdFor = (sessionId: string): string => {
    const known = chatIds.get(sessionId);
    if (known) return known;
    return sessionId.split(':')[1] ?? sessionId;
  };

  await client.connect((ev) => {
    const out = planOutbound(ev);
    if (out) void adapter.send(chatIdFor(ev.sessionId), out.payload);
  });

  process.stdout.write('[gateway] 就绪。输入消息开始对话；/btn <id> 触发按钮；Ctrl+C 退出。\n');
}

if (process.argv[1]?.endsWith('index.js')) void main();
