import { describe, expect, it } from 'vitest';
import { cronMatches, datePartsInTz, nextRunTime, parseCron } from '../src/cron.js';

describe('parseCron（5 字段）', () => {
  it('解析合法表达式', () => {
    expect(parseCron('0 8 * * *')).toEqual({ minute: [0], hour: [8], dayOfMonth: '*', month: '*', dayOfWeek: '*' });
  });
  it('非法表达式抛错', () => {
    expect(() => parseCron('0 8 *')).toThrow();
    expect(() => parseCron('60 8 * * *')).toThrow();
    expect(() => parseCron('0 24 * * *')).toThrow();
    expect(() => parseCron('0 8 32 * *')).toThrow();
    expect(() => parseCron('0 8 * 13 *')).toThrow();
    expect(() => parseCron('0 8 * * 7')).toThrow();
  });
});

describe('cronMatches', () => {
  it('每天 08:00 命中', () => {
    const cron = parseCron('0 8 * * *');
    expect(cronMatches(cron, new Date(2026, 7, 16, 8, 0))).toBe(true);
    expect(cronMatches(cron, new Date(2026, 7, 16, 8, 1))).toBe(false);
    expect(cronMatches(cron, new Date(2026, 7, 17, 8, 0))).toBe(true);
    expect(cronMatches(cron, new Date(2026, 7, 16, 7, 0))).toBe(false);
  });
  it('每周一 09:30 命中（2026-08-17 是周一）', () => {
    const cron = parseCron('30 9 * * 1');
    expect(cronMatches(cron, new Date(2026, 7, 17, 9, 30))).toBe(true); // 2026-08-17 是周一
    expect(cronMatches(cron, new Date(2026, 7, 18, 9, 30))).toBe(false); // 周二
    expect(cronMatches(cron, new Date(2026, 7, 17, 10, 30))).toBe(false); // 小时不符
  });
  it('minute/hour/month 为 * 时通配命中', () => {
    const cron = parseCron('* * * * *');
    expect(cronMatches(cron, new Date(2026, 7, 16, 8, 0))).toBe(true);
    expect(cronMatches(cron, new Date(2026, 7, 16, 23, 59))).toBe(true);
  });
});

describe('nextRunTime', () => {
  it('找到下一次命中分钟（跨天）', () => {
    const cron = parseCron('0 8 * * *');
    expect(nextRunTime(cron, new Date(2026, 7, 16, 8, 1))).toEqual(new Date(2026, 7, 17, 8, 0));
  });
  it('每周一 09:30 的下次命中', () => {
    const cron = parseCron('30 9 * * 1');
    // 2026-08-14 是周五 → 下次周一是 2026-08-17 09:30
    expect(nextRunTime(cron, new Date(2026, 7, 14, 12, 0))).toEqual(new Date(2026, 7, 17, 9, 30));
  });
});

describe('datePartsInTz / cronMatches 时区', () => {
  // 固定一个 UTC 时刻：2026-08-20T00:30:00Z
  // Asia/Shanghai = UTC+8 → 08:30（周四）；America/New_York（EDT）= UTC-4 → 20:30（周三）
  const instant = new Date('2026-08-20T00:30:00Z');
  it('datePartsInTz 按 IANA 时区拆解', () => {
    const sh = datePartsInTz(instant, 'Asia/Shanghai');
    expect(sh).toMatchObject({ minute: 30, hour: 8, day: 20, month: 8, weekday: 4 }); // 周四
    const ny = datePartsInTz(instant, 'America/New_York');
    expect(ny).toMatchObject({ minute: 30, hour: 20, day: 19, month: 8, weekday: 3 }); // 周三
  });
  it('同一时刻在不同时区命中不同的 cron 表达式', () => {
    const cronSh = parseCron('30 8 * * *'); // 上海 08:30
    const cronNy = parseCron('30 20 * * *'); // 纽约 20:30
    expect(cronMatches(cronSh, instant, 'Asia/Shanghai')).toBe(true);
    expect(cronMatches(cronSh, instant, 'America/New_York')).toBe(false);
    expect(cronMatches(cronNy, instant, 'America/New_York')).toBe(true);
    expect(cronMatches(cronNy, instant, 'Asia/Shanghai')).toBe(false);
  });
  it('nextRunTime 带时区', () => {
    const cron = parseCron('0 9 * * *');
    // 从 2026-08-20T00:00:00Z 开始找上海 09:00 → 当天 01:00Z
    expect(nextRunTime(cron, new Date('2026-08-20T00:00:00Z'), 'Asia/Shanghai')).toEqual(new Date('2026-08-20T01:00:00Z'));
  });
});
