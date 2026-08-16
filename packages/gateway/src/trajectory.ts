import type { ServerEvent, TrajectoryStep } from '@dsh-overdrive/sdk';

/** turn 级轨迹聚合：收集 trajectory.step，turn/end（idle）时产出 trajectory.summary 摘要卡片。 */
export class TrajectoryAggregator {
  private readonly buffer = new Map<string, TrajectoryStep[]>();

  onEvent(ev: ServerEvent, emit: (ev: ServerEvent) => void): void {
    if (ev.type === 'agent.status' && ev.status === 'idle') {
      const steps = this.buffer.get(ev.sessionId) ?? [];
      this.buffer.delete(ev.sessionId);
      if (steps.length > 0) {
        // 注：ServerEvent 联合类型尚无 trajectory.summary（Task 2 协议修改加入），
        // 此处临时断言为 ServerEvent；Task 2 加入协议变体后可去掉 as。
        emit({ type: 'trajectory.summary', sessionId: ev.sessionId, ts: Date.now(), steps } as unknown as ServerEvent);
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
}

export function formatTrajectorySummary(steps: TrajectoryStep[]): string {
  const lines = steps.map((s) => {
    const icon = s.kind === 'tool' ? '🛠️' : s.kind === 'subagent' ? '🤖' : '🧠';
    return `${icon} ${s.label}`;
  });
  return `📋 轨迹（${lines.length} 步）\n${lines.join('\n')}`;
}
