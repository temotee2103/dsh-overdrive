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

/** 纯函数：取 Date 在指定 IANA 时区下的「分 时 日 月 周几」。tz 缺省用本地时区。 */
export function datePartsInTz(
  date: Date,
  tz?: string,
): { minute: number; hour: number; day: number; month: number; weekday: number } {
  if (!tz) {
    return {
      minute: date.getMinutes(),
      hour: date.getHours(),
      day: date.getDate(),
      month: date.getMonth() + 1,
      weekday: date.getDay(),
    };
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23', // 24 小时制（en-US 默认 12 小时会把 20 点拆成 8 + PM）
    minute: 'numeric',
    hour: 'numeric',
    day: 'numeric',
    month: 'numeric',
    weekday: 'short',
  }).formatToParts(date);
  const get = (type: string): number => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : NaN;
  };
  // weekday 缩写（"Mon"…）→ 0-6（Sun=0）
  const weekdayMap: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const weekdayRaw = parts.find((x) => x.type === 'weekday')?.value.toLowerCase() ?? '';
  return {
    minute: get('minute'),
    hour: get('hour'),
    day: get('day'),
    month: get('month'),
    weekday: weekdayMap[weekdayRaw] ?? NaN,
  };
}

export function cronMatches(cron: CronSchedule, date: Date, tz?: string): boolean {
  const p = datePartsInTz(date, tz);
  if (!fieldMatches(cron.minute, p.minute)) return false;
  if (!fieldMatches(cron.hour, p.hour)) return false;
  if (!fieldMatches(cron.dayOfMonth, p.day)) return false;
  if (!fieldMatches(cron.month, p.month)) return false;
  if (!fieldMatches(cron.dayOfWeek, p.weekday)) return false;
  return true;
}

/** 下一次命中时间（精确到分钟），用于调度循环对齐。 */
export function nextRunTime(cron: CronSchedule, from: Date, tz?: string): Date {
  const t = new Date(from);
  t.setSeconds(0, 0);
  for (let i = 0; i < 60 * 24 * 366; i++) {
    t.setMinutes(t.getMinutes() + 1);
    if (cronMatches(cron, t, tz)) return t;
  }
  throw new Error('无法在一年内找到 cron 下次执行时间');
}
