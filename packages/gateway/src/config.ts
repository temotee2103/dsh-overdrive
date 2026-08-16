import type { Adapter } from './adapter.js';
import { CliAdapter } from './adapters/cli.js';
import { WhatsAppAdapter } from './adapters/whatsapp.js';
import { TelegramAdapter } from './adapters/telegram.js';
import { DiscordAdapter } from './adapters/discord.js';
import { SlackAdapter } from './adapters/slack.js';

/** 平台适配器需要的全部环境变量（缺省为 undefined = 不启用该平台）。 */
export interface AdapterEnv {
  whatsappDataDir?: string;
  telegramBotToken?: string;
  discordBotToken?: string;
  slackBotToken?: string;
  slackAppToken?: string;
}

export function parseAdapterIds(raw: string): string[] {
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return ids.length > 0 ? ids : ['cli'];
}

/** 按 id 创建适配器实例；依赖注入 env 便于测试。 */
export function createAdapter(id: string, env: AdapterEnv): Adapter {
  switch (id) {
    case 'cli':
      return new CliAdapter();
    case 'whatsapp':
      return new WhatsAppAdapter({ authDir: env.whatsappDataDir ?? 'data/whatsapp' });
    case 'telegram':
      if (!env.telegramBotToken) throw new Error('telegram 适配器需要 TELEGRAM_BOT_TOKEN');
      return new TelegramAdapter({ token: env.telegramBotToken });
    case 'discord':
      if (!env.discordBotToken) throw new Error('discord 适配器需要 DISCORD_BOT_TOKEN');
      return new DiscordAdapter({ token: env.discordBotToken });
    case 'slack':
      if (!env.slackBotToken || !env.slackAppToken) throw new Error('slack 适配器需要 SLACK_BOT_TOKEN 与 SLACK_APP_TOKEN');
      return new SlackAdapter({ botToken: env.slackBotToken, appToken: env.slackAppToken });
    default:
      throw new Error(`unknown adapter: ${id}`);
  }
}

/** 从 process.env 读适配器配置。 */
export function adapterEnvFromProcess(env: NodeJS.ProcessEnv = process.env): AdapterEnv {
  return {
    whatsappDataDir: env.WHATSAPP_DATA_DIR,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    discordBotToken: env.DISCORD_BOT_TOKEN,
    slackBotToken: env.SLACK_BOT_TOKEN,
    slackAppToken: env.SLACK_APP_TOKEN,
  };
}
