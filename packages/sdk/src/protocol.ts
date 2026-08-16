// Remote Session Driver 协议：类型定义与工具函数。

export interface TrajectoryStep {
  kind: 'thought' | 'tool' | 'subagent';
  label: string;
  detail?: string;
}

export type ServerEvent =
  | { type: 'message.delta'; sessionId: string; ts: number; text: string }
  | { type: 'message.complete'; sessionId: string; ts: number; text: string }
  | { type: 'trajectory.step'; sessionId: string; ts: number; step: TrajectoryStep }
  | { type: 'trajectory.summary'; sessionId: string; ts: number; steps: TrajectoryStep[] }
  | { type: 'approval.request'; sessionId: string; ts: number; reqId: string; summary: string; timeoutMs: number }
  | { type: 'agent.status'; sessionId: string; ts: number; status: 'busy' | 'idle' | 'subagent-spawned' }
  | { type: 'task.done'; sessionId: string; ts: number; taskId: string; ok: boolean }
  | { type: 'error'; sessionId: string; ts: number; message: string };

export interface UpsertSessionRequest { platform: string; channel: string; user: string; }
export interface UpsertSessionResponse { sessionId: string; }

export interface SendMessageRequest {
  text: string;
  media?: { kind: 'voice' | 'image' | 'video' | 'file'; url?: string; mime?: string; caption?: string };
}
export interface SendMessageResponse { runId: string; }

export interface ResolveApprovalRequest { decision: 'approve' | 'reject'; }
export interface ResolveApprovalResponse { ok: boolean; }

export interface TaskRequest { sessionId: string; kind: 'subagent' | 'cron'; prompt: string; schedule?: string; }
export interface TaskResponse { taskId: string; }

export interface ResetSessionRequest { /* 空 */ }
export interface ResetSessionResponse { ok: boolean }

export interface HealthResponse { status: 'ok'; version: string; }

// 会话键：platform:channel:user（与 Hermes 网关同构）。
export function sessionKey(platform: string, channel: string, user: string): string {
  return `${platform}:${channel}:${user}`;
}

export function parseSessionKey(key: string): { platform: string; channel: string; user: string } {
  const [platform, channel, user] = key.split(':');
  if (!platform || !channel || !user) throw new Error(`invalid session key: ${key}`);
  return { platform, channel, user };
}

export function encodeEvent(ev: ServerEvent): string {
  return JSON.stringify(ev);
}

export function decodeEvent(line: string): ServerEvent {
  const parsed = JSON.parse(line) as ServerEvent;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
    throw new Error('invalid event payload');
  }
  return parsed;
}
