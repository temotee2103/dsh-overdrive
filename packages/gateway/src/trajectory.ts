import type { ServerEvent, TrajectoryStep } from '@dsh-overdrive/sdk';

/** turn 级轨迹聚合：收集 trajectory.step，turn/end（idle）时产出 trajectory.summary 摘要卡片。 */
export class TrajectoryAggregator {
  private readonly buffer = new Map<string, TrajectoryStep[]>();
  private readonly summaries = new Map<string, string>();

  onEvent(ev: ServerEvent, emit: (ev: ServerEvent) => void): void {
    if (ev.type === 'agent.status' && ev.status === 'idle') {
      const steps = this.buffer.get(ev.sessionId) ?? [];
      this.buffer.delete(ev.sessionId);
      if (steps.length > 0) {
        this.summaries.set(ev.sessionId, formatTrajectorySummary(steps));
        emit({ type: 'trajectory.summary', sessionId: ev.sessionId, ts: Date.now(), steps });
      }
      emit(ev);
      return;
    }
    if (ev.type === 'agent.status' && ev.status === 'busy') {
      this.buffer.set(ev.sessionId, []);
      emit(ev);
      return;
    }
    if (ev.type === 'trajectory.step') {
      const list = this.buffer.get(ev.sessionId);
      if (list) list.push(ev.step);
      else this.buffer.set(ev.sessionId, [ev.step]);
      return; // 单步不实时推，等摘要（减少刷屏）
    }
    emit(ev);
  }

  /** 最近一次 turn 的轨迹摘要文本（/trace 命令用），无则 null。 */
  recentSummary(sessionId: string): string | null {
    return this.summaries.get(sessionId) ?? null;
  }
}

export function formatTrajectorySummary(steps: TrajectoryStep[]): string {
  const lines = steps.map((s) => {
    const icon = s.kind === 'tool' ? '🛠️' : s.kind === 'subagent' ? '🤖' : '🧠';
    return `${icon} ${s.label}`;
  });
  return `📋 轨迹（${lines.length} 步）\n${lines.join('\n')}`;
}
