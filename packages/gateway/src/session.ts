import { sessionKey } from '@dsh-overdrive/sdk';

export function buildSessionKey(
  adapterId: string,
  msg: { chatId: string; userId: string },
): string {
  return sessionKey(adapterId, msg.chatId, msg.userId);
}

/**
 * 白名单：默认 fail-closed —— 只有显式配置了条目才放行；
 * 开发环境可用 ALLOW_ALL=1 显式放行所有（比空列表隐式放行安全得多）。
 */
export class Allowlist {
  constructor(
    private readonly entries: string[],
    private readonly allowAll = false,
  ) {}

  allows(key: string): boolean {
    return this.allowAll || (this.entries.length > 0 && this.entries.includes(key));
  }
}
