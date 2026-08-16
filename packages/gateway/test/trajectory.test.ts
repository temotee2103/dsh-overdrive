import { describe, expect, it } from 'vitest';
import { TrajectoryAggregator, formatTrajectorySummary } from '../src/trajectory.js';
import type { ServerEvent, TrajectoryStep } from '@dsh-overdrive/sdk';

// 注意：ServerEvent 联合类型尚无 trajectory.summary（Task 2 协议修改才加入），
// 故本文件对 summary 事件统一用结构断言 + as 断言，不修改 sdk 协议。
describe('TrajectoryAggregator', () => {
  it('聚合 turn 内轨迹，turn 结束产出摘要', () => {
    const agg = new TrajectoryAggregator();
    const events: ServerEvent[] = [];
    agg.onEvent({ type: 'agent.status', sessionId: 'cli:cli:local', ts: 1, status: 'busy' }, (ev) => events.push(ev));
    agg.onEvent({ type: 'trajectory.step', sessionId: 'cli:cli:local', ts: 2, step: { kind: 'thought', label: '分析' } }, (ev) => events.push(ev));
    agg.onEvent({ type: 'trajectory.step', sessionId: 'cli:cli:local', ts: 3, step: { kind: 'tool', label: 'bash' } }, (ev) => events.push(ev));
    agg.onEvent({ type: 'agent.status', sessionId: 'cli:cli:local', ts: 4, status: 'idle' }, (ev) => events.push(ev));

    const summary = events.find((e) => (e as { type: string }).type === 'trajectory.summary') as
      | { type: 'trajectory.summary'; steps: TrajectoryStep[] }
      | undefined;
    expect(summary).toBeDefined();
    // 直接比较结构（Task 2 的协议变体含 steps，渲染由 formatTrajectorySummary 负责）
    expect(summary!.steps).toEqual([
      { kind: 'thought', label: '分析' },
      { kind: 'tool', label: 'bash' },
    ]);
  });

  it('busy 状态在摘要前透传，idle 后清空缓冲', () => {
    const agg = new TrajectoryAggregator();
    const events: ServerEvent[] = [];
    agg.onEvent({ type: 'agent.status', sessionId: 'cli:cli:local', ts: 1, status: 'busy' }, (ev) => events.push(ev));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('agent.status');

    agg.onEvent({ type: 'agent.status', sessionId: 'cli:cli:local', ts: 2, status: 'idle' }, (ev) => events.push(ev));
    expect(events).toHaveLength(2);
  });

  it('其他事件（message.complete 等）原样透传', () => {
    const agg = new TrajectoryAggregator();
    const events: ServerEvent[] = [];
    agg.onEvent({ type: 'message.complete', sessionId: 's', ts: 1, text: '结果' }, (ev) => events.push(ev));
    expect(events).toEqual([{ type: 'message.complete', sessionId: 's', ts: 1, text: '结果' }]);
  });
});

describe('formatTrajectorySummary（摘要卡片渲染，Task 2 接线复用）', () => {
  it('按 kind 渲染图标 + 标签，含步数标题', () => {
    const text = formatTrajectorySummary([
      { kind: 'thought', label: '分析' },
      { kind: 'tool', label: 'bash' },
      { kind: 'subagent', label: '子任务' },
    ]);
    expect(text).toContain('🧠 分析');
    expect(text).toContain('🛠️ bash');
    expect(text).toContain('🤖 子任务');
    expect(text).toContain('📋 轨迹（3 步）');
  });
});
