// 群聊响应策略（对齐竞品 dsh-im 的「私聊直接响应、群聊被提及/回复才响应」）。
// 纯函数，平台判定基于渠道 ID 特征与提及模式；无法判定的平台默认始终响应。

import type { NormalizedMessage } from './adapter.js';

/** 纯函数：该渠道 ID 是否为群聊/频道（vs 私聊）。平台特征： */
export function isGroupChat(adapterId: string, chatId: string): boolean {
  switch (adapterId) {
    case 'telegram':
      // 群/超级群为负 ID（-100 前缀的超群，- 前缀的普通群）
      return chatId.startsWith('-');
    case 'whatsapp':
      return chatId.endsWith('@g.us');
    case 'slack':
      // Slack 私聊 DM 以 D 开头，公共频道/群以 C/G 开头
      return !chatId.startsWith('D');
    default:
      // discord / feishu / dingtalk / wecom / wechat / cli：无法从 ID 可靠区分 → 视为私聊（始终响应）
      return false;
  }
}

/** 纯函数：消息文本是否提及了机器人（@<identity> 或 <@identity> 平台格式）。 */
export function isMentioned(adapterId: string, text: string, botIdentity: string): boolean {
  if (!botIdentity) return false;
  switch (adapterId) {
    case 'telegram':
      return text.includes(`@${botIdentity}`);
    case 'whatsapp':
      return text.includes(`@${botIdentity}`);
    case 'discord':
    case 'slack':
      return text.includes(`<@${botIdentity}>`);
    default:
      return true; // 无法检测提及的平台 → 视为已提及（始终响应）
  }
}

export interface MentionPolicy {
  /** 群聊中要求被提及/回复才响应；私聊始终响应。 */
  requireMention: boolean;
  /** 机器人身份（telegram @用户名 / discord·slack 用户ID / whatsapp 号码）。 */
  botIdentity: string;
}

/** 纯函数：是否应响应该消息。 */
export function shouldRespond(adapterId: string, msg: NormalizedMessage, policy: MentionPolicy): boolean {
  if (!policy.requireMention) return true;
  if (!isGroupChat(adapterId, msg.chatId)) return true; // 私聊始终响应
  return isMentioned(adapterId, msg.text, policy.botIdentity);
}
