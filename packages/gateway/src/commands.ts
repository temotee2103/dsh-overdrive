export type ParsedCommand =
  | { kind: 'trace' }
  | { kind: 'new' }
  | { kind: 'agents' }
  | { kind: 'help' }
  | { kind: 'task'; prompt: string }
  | { kind: 'cron'; schedule: string; prompt: string };

// cron 语法：/cron <分 时 日 月 周> <需求>（schedule 为 5 个空白分隔字段）
const CRON_RE = /^\/cron\s+(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/;

export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (trimmed === '/trace') return { kind: 'trace' };
  if (trimmed === '/new') return { kind: 'new' };
  if (trimmed === '/agents') return { kind: 'agents' };
  if (trimmed === '/help') return { kind: 'help' };
  const task = trimmed.match(/^\/task\s+(.+)$/);
  if (task) return { kind: 'task', prompt: task[1] };
  const cron = trimmed.match(CRON_RE);
  if (cron) return { kind: 'cron', schedule: cron[1], prompt: cron[2] };
  return null;
}

export const HELP_TEXT = [
  '/help — 帮助',
  '/trace — 查看最近一轮轨迹',
  '/task <需求> — 派子任务',
  '/cron <分 时 日 月 周> <需求> — 定时任务',
  '/agents — 查看子任务状态',
  '/new — 重置会话',
].join('\n');
