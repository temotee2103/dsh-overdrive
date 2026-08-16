// 自研 5 字段 cron 匹配（gateway-core 内部调度器，D4）。
// 语法：`分 时 日 月 周`（minute hour day-of-month month day-of-week），
// 支持 `*` 通配与逗号列表（如 `0,30`），不支持步进（`*/5`）。
// 注意：dayOfMonth 与 dayOfWeek 同时限制时按 AND 语义（计划明确，区别于标准 cron 的 OR）。

export interface CronSchedule {
  minute: number[] | '*';
  hour: number[] | '*';
  dayOfMonth: number[] | '*';
  month: number[] | '*';
  dayOfWeek: number[] | '*';
}

function parseField(field: string, min: number, max: number, name: string): number[] | '*' {
  if (field === '*') return '*';
  return field.split(',').map((part) => {
    const n = Number(part);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new Error(`cron ${name} 字段非法: ${part}`);
    }
    return n;
  });
}

export function parseCron(expr: string): CronSchedule {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron 需要 5 个字段（分 时 日 月 周）: ${expr}`);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return {
    minute: parseField(minute, 0, 59, 'minute'),
    hour: parseField(hour, 0, 23, 'hour'),
    dayOfMonth: parseField(dayOfMonth, 1, 31, 'day-of-month'),
    month: parseField(month, 1, 12, 'month'),
    dayOfWeek: parseField(dayOfWeek, 0, 6, 'day-of-week'),
  };
}

function fieldMatches(field: number[] | '*', value: number): boolean {
  return field === '*' || field.includes(value);
}

export function cronMatches(cron: CronSchedule, date: Date): boolean {
  if (!fieldMatches(cron.minute, date.getMinutes())) return false;
  if (!fieldMatches(cron.hour, date.getHours())) return false;
  if (!fieldMatches(cron.dayOfMonth, date.getDate())) return false;
  if (!fieldMatches(cron.month, date.getMonth() + 1)) return false;
  if (!fieldMatches(cron.dayOfWeek, date.getDay())) return false;
  return true;
}

/** 下一次命中时间（精确到分钟），用于调度循环对齐。 */
export function nextRunTime(cron: CronSchedule, from: Date): Date {
  const t = new Date(from);
  t.setSeconds(0, 0);
  for (let i = 0; i < 60 * 24 * 366; i++) {
    t.setMinutes(t.getMinutes() + 1);
    if (cronMatches(cron, t)) return t;
  }
  throw new Error('无法在一年内找到 cron 下次执行时间');
}
