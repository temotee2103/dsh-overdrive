import { sessionKey } from '@dsh-overdrive/sdk';

export function buildSessionKey(
  adapterId: string,
  msg: { chatId: string; userId: string },
): string {
  return sessionKey(adapterId, msg.chatId, msg.userId);
}

/** 空列表 = 开发模式放行所有；生产环境必须显式配置。 */
export class Allowlist {
  constructor(private readonly entries: string[]) {}

  allows(key: string): boolean {
    return this.entries.length === 0 || this.entries.includes(key);
  }
}
