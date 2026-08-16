import { describe, expect, it } from 'vitest';
import { planOutbound } from '../src/index.js';
import type { ServerEvent } from '@dsh-overdrive/sdk';

describe('planOutbound（事件 → 平台输出）', () => {
  it('message.complete → 纯文本', () => {
    const ev: ServerEvent = { type: 'message.complete', sessionId: 'cli:cli:local', ts: 1, text: '结果' };
    expect(planOutbound(ev)?.payload).toEqual({ text: '结果' });
  });

  it('trajectory.step → 带图标的轨迹行', () => {
    const ev: ServerEvent = { type: 'trajectory.step', sessionId: 'cli:cli:local', ts: 1, step: { kind: 'tool', label: 'grep' } };
    expect(planOutbound(ev)?.payload.text).toBe('🛠️ grep');
  });

  it('approval.request → 文本 + 同意/拒绝两个按钮', () => {
    const ev: ServerEvent = { type: 'approval.request', sessionId: 'cli:cli:local', ts: 1, reqId: 'r1', summary: '删除文件', timeoutMs: 60000 };
    const out = planOutbound(ev)!;
    expect(out.payload.text).toContain('删除文件');
    expect(out.payload.buttons).toHaveLength(2);
    expect(out.payload.buttons![0].id).toBe('approve:r1');
    expect(out.payload.buttons![1].id).toBe('reject:r1');
  });

  it('message.delta 不输出（MVP 等 complete）', () => {
    const ev: ServerEvent = { type: 'message.delta', sessionId: 'cli:cli:local', ts: 1, text: '…' };
    expect(planOutbound(ev)).toBeNull();
  });
});
