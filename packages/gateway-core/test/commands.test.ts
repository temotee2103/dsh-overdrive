import { describe, expect, it } from 'vitest';
import { describeRemindDelay, parseRemindCommand } from '../src/commands.js';

describe('斜杠命令解析（原生路径）', () => {
  it('/remind 秒/分/小时', () => {
    expect(parseRemindCommand('remind 30s 喝水')).toEqual({ delayMs: 30_000, prompt: '喝水' });
    expect(parseRemindCommand('remind 5m 看下 issue')).toEqual({ delayMs: 300_000, prompt: '看下 issue' });
    expect(parseRemindCommand('remind 2h 发布')).toEqual({ delayMs: 7_200_000, prompt: '发布' });
  });

  it('/remind 带前导斜杠或多余空格也解析（文本已在 driver 层去斜杠前缀场景另测）', () => {
    // driver 回调收到的是消息 text；若带 / 前缀由上层 strip。
    expect(parseRemindCommand('remind  90 s  站 起来 ')).toEqual({ delayMs: 90_000, prompt: '站 起来' });
  });

  it('非提醒文本返回 null', () => {
    expect(parseRemindCommand('帮我提醒我写周报')).toBeNull();
    expect(parseRemindCommand('remind later 睡觉')).toBeNull();
    expect(parseRemindCommand('')).toBeNull();
  });

  it('describeRemindDelay 人性化', () => {
    expect(describeRemindDelay(30_000)).toBe('30 秒');
    expect(describeRemindDelay(300_000)).toBe('5 分钟');
    expect(describeRemindDelay(7_200_000)).toBe('2 小时');
  });
});
