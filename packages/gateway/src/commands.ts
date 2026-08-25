export type ParsedCommand =
  | { kind: 'trace' }
  | { kind: 'new' }
  | { kind: 'agents' }
  | { kind: 'help' }
  | { kind: 'task'; prompt: string }
  | { kind: 'cron'; schedule: string; prompt: string; timeZone?: string }
  | { kind: 'crons' }
  | { kind: 'cronrm'; taskId: string }
  | { kind: 'context'; action: 'set' | 'clear' | 'show'; topic?: string }
  | { kind: 'remember'; text: string }
  | { kind: 'recall'; query: string }
  | { kind: 'forget'; memoryId: string }
  | { kind: 'remind'; text: string; inMinutes: number | null; atTime: string | null }
  | { kind: 'send'; path: string }
  | { kind: 'status' }
  | { kind: 'feedadd'; url: string }
  | { kind: 'feedlist' }
  | { kind: 'feedrm'; feedId: string }
  | { kind: 'digest' }
  | { kind: 'digestdaily'; time: string };

// cron 语法：/cron <分 时 日 月 周> <需求> [--tz <IANA时区>]
const CRON_RE = /^\/cron\s+(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+?)(?:\s+--tz\s+(\S+))?$/;
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
  if (cron) return { kind: 'cron', schedule: cron[1], prompt: cron[2].trim(), timeZone: cron[3] };
  const cronrm = trimmed.match(/^\/cronrm\s+(\S+)$/);
  if (cronrm) return { kind: 'cronrm', taskId: cronrm[1] };
  const context = trimmed.match(/^\/context\s+(.+)$/);
  if (context) {
    const topic = context[1].trim();
    if (topic === 'off' || topic === '清除' || topic === 'clear') return { kind: 'context', action: 'clear' };
    return { kind: 'context', action: 'set', topic };
  }
  if (trimmed === '/context') return { kind: 'context', action: 'show' };
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
  if (trimmed === '/digest') return { kind: 'digest' };
  const digestDaily = trimmed.match(/^\/digest\s+daily\s+(\d{1,2}:\d{2})$/);
  if (digestDaily) return { kind: 'digestdaily', time: digestDaily[1] };
  const feedAdd = trimmed.match(/^\/feed\s+add\s+(\S+)$/i);
  if (feedAdd) return { kind: 'feedadd', url: feedAdd[1] };
  if (/^\/feed\s+list$/i.test(trimmed)) return { kind: 'feedlist' };
  const feedRm = trimmed.match(/^\/feed\s+rm\s+(\S+)$/i);
  if (feedRm) return { kind: 'feedrm', feedId: feedRm[1] };
  return null;
}

export const HELP_TEXT = [
  '/help — 帮助',
  '/trace — 查看最近一轮轨迹',
  '/task <需求> — 派子任务',
  '/cron <分 时 日 月 周> <需求> [--tz 时区] — 定时任务',
  '/crons — 查看定时任务列表',
  '/cronrm <任务id> — 删除定时任务',
  '/context <主题> — 绑定当前会话主题（off 清除）',
  '/remind in 10 分钟 <提醒内容> — 一次性定时提醒（也支持 at HH:MM）',
  '/remember <事实> — 记住关于我的事',
  '/recall <关键词> — 回忆相关记忆',
  '/forget <记忆id> — 删除一条记忆',
  '/send <文件路径> — 把本地文件/图片发到当前聊天',
  '/status — 查看运行状态',
  '/digest — 立即生成今日摘要',
  '/digest daily 09:00 — 每天定时生成摘要',
  '/feed add <rss链接> — 订阅 RSS 推送',
  '/feed list / rm <id> — 管理订阅',
  '/agents — 查看子任务状态',
  '/new — 重置会话',
].join('\n');
