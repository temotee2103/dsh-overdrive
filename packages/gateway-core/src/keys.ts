// DSH 会话 id 映射。DSH 的 SessionId 是插件自定 branded string（M0 报告 D1），
// gateway-core 约定为 `dsh:<platform>:<channel>:<user>`。
// 会话 id 会进入 JSONL 持久化路径，组件必须消毒，避免 `/`、`\`、`..` 等不安全字符。

const SAFE = /[^A-Za-z0-9._+\-]/g;

export function sanitizeComponent(value: string): string {
  return value.replace(SAFE, '_');
}

export function toDshSessionId(platform: string, channel: string, user: string, prefix = 'dsh'): string {
  return `${prefix}:${sanitizeComponent(platform)}:${sanitizeComponent(channel)}:${sanitizeComponent(user)}`;
}

export function fromDshSessionId(id: string, prefix = 'dsh'): { platform: string; channel: string; user: string } {
  const [p, platform, channel, user] = id.split(':');
  if (p !== prefix || !platform || !channel || !user) {
    throw new Error(`invalid dsh session id: ${id}`);
  }
  return { platform, channel, user };
}
