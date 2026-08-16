import type { ServerEvent } from '@dsh-overdrive/sdk';

// DSH SessionEvent → 协议 ServerEvent 的纯函数映射（M0 报告 D2：DSH 无现成"轨迹 step"事件，必须派生）。
// DSH SessionEvent 采用结构化外形，避免测试依赖 pre-release 运行时包。

export interface DshEventData { [key: string]: unknown }
export interface DshSessionEvent {
  type: string;
  data: DshEventData;
}

export interface TextBlock { type: 'text'; text?: string }
export interface MessageContentBlock { type?: string; text?: string }

export function extractAssistantText(event: DshSessionEvent): string {
  const message = event.data.message as { content?: MessageContentBlock[] } | undefined;
  if (!message?.content) return '';
  const blocks: string[] = [];
  for (const block of message.content) {
    if (block.type === 'text' && typeof block.text === 'string') blocks.push(block.text);
  }
  return blocks.join('');
}

export function deriveProtocolEvents(sessionId: string, event: DshSessionEvent): ServerEvent[] {
  const ts = Date.now();
  switch (event.type) {
    case 'turn/start':
      return [{ type: 'agent.status', sessionId, ts, status: 'busy' }];
    case 'turn/end':
      return [{ type: 'agent.status', sessionId, ts, status: 'idle' }];
    case 'assistant/chunk': {
      const chunk = event.data.chunk as { type?: string; text?: string } | undefined;
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.length > 0) {
        return [{ type: 'message.delta', sessionId, ts, text: chunk.text }];
      }
      return [];
    }
    case 'assistant/message': {
      const text = extractAssistantText(event);
      if (!text) return [];
      return [{ type: 'message.complete', sessionId, ts, text }];
    }
    case 'tool/call': {
      const name = typeof event.data.name === 'string' ? event.data.name : 'unknown';
      return [{ type: 'trajectory.step', sessionId, ts, step: { kind: 'tool', label: name } }];
    }
    default:
      return [];
  }
}
