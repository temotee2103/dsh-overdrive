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
});
