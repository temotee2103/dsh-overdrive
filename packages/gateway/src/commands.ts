export type ParsedCommand =
  | { kind: 'trace' }
  | { kind: 'new' }
  | { kind: 'agents' }
  | { kind: 'help' }
  | { kind: 'task'; prompt: string }
  | { kind: 'cron'; schedule: string; prompt: string }
  | { kind: 'crons' }
  | { kind: 'cronrm'; taskId: string }
  | { kind: 'remember'; text: string }
  | { kind: 'recall'; query: string }
  | { kind: 'forget'; memoryId: string }
  | { kind: 'remind'; text: string; inMinutes: number | null; atTime: string | null }
  | { kind: 'send'; path: string }
  | { kind: 'status' };

// cron 语法：/cron <分 时 日 月 周> <需求>（schedule 为 5 个空白分隔字段）
const CRON_RE = /^\/cron\s+(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/;
// /remind in N 分钟/小时/天 <text>（也支持 min/minutes/hour/hours/day/days）；或 /remind at HH:MM <text>
const REMIND_IN_RE = /^\/remind\s+in\s+(\d+)\s+(\S+)\s+(.+)$/i;
const REMIND_AT_RE = /^\/remind\s+at\s+(\d{1,2}:\d{2})\s+(.+)$/i;

export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (trimmed === '/trace') return { kind: 'trace' };
  if (trimmed === '/new') return { kind: 'new' };
  if (trimmed === '/agents') return { kind: 'agents' };
  if (trimmed === '/help') return { kind: 'help' };
  if (trimmed === '/crons') return { kind: 'crons' };
  if (trimmed === '/status') return { kind: 'status' };
  const task = trimmed.match(/^\/task\s+(.+)$/);
  if (task) return { kind: 'task', prompt: task[1] };
  const cron = trimmed.match(CRON_RE);
  if (cron) return { kind: 'cron', schedule: cron[1], prompt: cron[2] };
  const cronrm = trimmed.match(/^\/cronrm\s+(\S+)$/);
  if (cronrm) return { kind: 'cronrm', taskId: cronrm[1] };
  const remember = trimmed.match(/^\/remember\s+(.+)$/);
  if (remember) return { kind: 'remember', text: remember[1] };
  const recall = trimmed.match(/^\/recall\s*(.*)$/);
  if (recall) return { kind: 'recall', query: recall[1].trim() };
  const forget = trimmed.match(/^\/forget\s+(\S+)$/);
  if (forget) return { kind: 'forget', memoryId: forget[1] };
  const remindIn = trimmed.match(REMIND_IN_RE);
  if (remindIn) {
    const unit = (remindIn[2] ?? '').toLowerCase();
    const n = Number(remindIn[1]);
    const minutes = /^(小|h|hour)/.test(unit) ? n * 60 : /^(天|d)/.test(unit) ? n * 1440 : n;
    return { kind: 'remind', text: remindIn[3], inMinutes: minutes, atTime: null };
  }
  const remindAt = trimmed.match(REMIND_AT_RE);
  if (remindAt) return { kind: 'remind', text: remindAt[2], inMinutes: null, atTime: remindAt[1] };
  const send = trimmed.match(/^\/send\s+(.+)$/);
  if (send) return { kind: 'send', path: send[1].trim() };
  return null;
}

export const HELP_TEXT = [
  '/help — 帮助',
  '/trace — 查看最近一轮轨迹',
  '/task <需求> — 派子任务',
  '/cron <分 时 日 月 周> <需求> — 定时任务',
  '/crons — 查看定时任务列表',
  '/cronrm <任务id> — 删除定时任务',
  '/remind in 10 分钟 <提醒内容> — 一次性定时提醒（也支持 at HH:MM）',
  '/remember <事实> — 记住关于我的事',
  '/recall <关键词> — 回忆相关记忆',
  '/forget <记忆id> — 删除一条记忆',
  '/send <文件路径> — 把本地文件/图片发到当前聊天',
  '/status — 查看运行状态',
  '/agents — 查看子任务状态',
  '/new — 重置会话',
].join('\n');
