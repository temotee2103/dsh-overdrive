import { describe, expect, it } from 'vitest';
import { parseCommand, type ParsedCommand } from '../src/commands.js';

describe('parseCommand', () => {
  it('识别 /trace、/task、/cron、/agents、/new、/help', () => {
    expect(parseCommand('/trace')).toEqual({ kind: 'trace' });
    expect(parseCommand('/new')).toEqual({ kind: 'new' });
    expect(parseCommand('/agents')).toEqual({ kind: 'agents' });
    expect(parseCommand('/help')).toEqual({ kind: 'help' });
    expect(parseCommand('/task 调研竞品')).toEqual({ kind: 'task', prompt: '调研竞品' });
    expect(parseCommand('/cron 0 8 * * * 每日汇报')).toEqual({ kind: 'cron', schedule: '0 8 * * *', prompt: '每日汇报' });
  });
  it('识别 /crons 与 /cronrm', () => {
    expect(parseCommand('/crons')).toEqual({ kind: 'crons' });
    expect(parseCommand('/cronrm cron-1')).toEqual({ kind: 'cronrm', taskId: 'cron-1' });
    expect(parseCommand('/cronrm cron-123-abc')).toEqual({ kind: 'cronrm', taskId: 'cron-123-abc' });
  });
  it('非命令返回 null', () => {
    expect(parseCommand('hello')).toBeNull();
    expect(parseCommand('/unknown')).toBeNull();
    expect(parseCommand('/task')).toBeNull(); // 缺参数
    expect(parseCommand('/cronrm')).toBeNull(); // 缺任务 id
  });
  it('识别 /remember /recall /forget', () => {
    expect(parseCommand('/remember 用户喜欢美式咖啡')).toEqual({ kind: 'remember', text: '用户喜欢美式咖啡' });
    expect(parseCommand('/recall 咖啡')).toEqual({ kind: 'recall', query: '咖啡' });
    expect(parseCommand('/recall')).toEqual({ kind: 'recall', query: '' });
    expect(parseCommand('/forget abc123')).toEqual({ kind: 'forget', memoryId: 'abc123' });
    expect(parseCommand('/remember')).toBeNull(); // 缺内容
  });
  it('识别 /remind（相对时间与定点时间）', () => {
    expect(parseCommand('/remind in 10 分钟 喝水')).toEqual({ kind: 'remind', text: '喝水', inMinutes: 10, atTime: null });
    expect(parseCommand('/remind in 2 小时 开会')).toEqual({ kind: 'remind', text: '开会', inMinutes: 120, atTime: null });
    expect(parseCommand('/remind in 30 minutes 散步')).toEqual({ kind: 'remind', text: '散步', inMinutes: 30, atTime: null });
    expect(parseCommand('/remind in 1 day 汇报')).toEqual({ kind: 'remind', text: '汇报', inMinutes: 1440, atTime: null });
    expect(parseCommand('/remind at 14:30 开会')).toEqual({ kind: 'remind', text: '开会', inMinutes: null, atTime: '14:30' });
  });
  it('识别 /send 与 /status', () => {
    expect(parseCommand('/send /tmp/report.png')).toEqual({ kind: 'send', path: '/tmp/report.png' });
    expect(parseCommand('/status')).toEqual({ kind: 'status' });
    expect(parseCommand('/send')).toBeNull(); // 缺路径
  });
  it('识别 /cron --tz 时区', () => {
    expect(parseCommand('/cron 0 8 * * * 每日汇报 --tz Asia/Shanghai'))
      .toEqual({ kind: 'cron', schedule: '0 8 * * *', prompt: '每日汇报', timeZone: 'Asia/Shanghai' });
    expect(parseCommand('/cron 0 8 * * * 每日汇报')).toEqual({ kind: 'cron', schedule: '0 8 * * *', prompt: '每日汇报', timeZone: undefined });
  });
  it('识别 /context', () => {
    expect(parseCommand('/context 项目重构')).toEqual({ kind: 'context', action: 'set', topic: '项目重构' });
    expect(parseCommand('/context off')).toEqual({ kind: 'context', action: 'clear' });
    expect(parseCommand('/context')).toEqual({ kind: 'context', action: 'show' });
  });
});
