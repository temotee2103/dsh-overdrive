import type { Adapter } from './adapter.js';
import { CliAdapter } from './adapters/cli.js';
import { WhatsAppAdapter } from './adapters/whatsapp.js';
import { TelegramAdapter } from './adapters/telegram.js';
import { DiscordAdapter } from './adapters/discord.js';
import { SlackAdapter } from './adapters/slack.js';
import { FeishuAdapter } from './adapters/feishu.js';
import { DingTalkAdapter } from './adapters/dingtalk.js';
import { WeComAdapter } from './adapters/wecom.js';
import { WeChatAdapter } from './adapters/wechat.js';

/** 平台适配器需要的全部环境变量（缺省为 undefined = 不启用该平台）。 */
export interface AdapterEnv {
  whatsappDataDir?: string;
  telegramBotToken?: string;
  discordBotToken?: string;
  slackBotToken?: string;
  slackAppToken?: string;
  feishuAppId?: string;
  feishuAppSecret?: string;
  dingtalkClientId?: string;
  dingtalkClientSecret?: string;
  wecomCorpId?: string;
  wecomSecret?: string;
  wecomAgentId?: string;
  wecomToken?: string;
  wecomEncodingAESKey?: string;
  wecomCallbackPort?: string;
  wechatToken?: string;
  wechatStateDir?: string;
  asrApiKey?: string;
  asrBaseUrl?: string;
  asrModel?: string;
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
    case 'feishu':
      if (!env.feishuAppId || !env.feishuAppSecret) throw new Error('feishu 适配器需要 FEISHU_APP_ID / FEISHU_APP_SECRET');
      return new FeishuAdapter({ appId: env.feishuAppId, appSecret: env.feishuAppSecret });
    case 'dingtalk':
      if (!env.dingtalkClientId || !env.dingtalkClientSecret) throw new Error('dingtalk 适配器需要 DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET');
      return new DingTalkAdapter({ clientId: env.dingtalkClientId, clientSecret: env.dingtalkClientSecret });
    case 'wecom':
      if (!env.wecomCorpId || !env.wecomSecret || !env.wecomAgentId || !env.wecomToken || !env.wecomEncodingAESKey) {
        throw new Error('wecom 适配器需要 WECOM_CORP_ID / WECOM_SECRET / WECOM_AGENT_ID / WECOM_TOKEN / WECOM_ENCODING_AES_KEY');
      }
      return new WeComAdapter({
        corpId: env.wecomCorpId, secret: env.wecomSecret, agentId: env.wecomAgentId,
        token: env.wecomToken, encodingAESKey: env.wecomEncodingAESKey,
        callbackPort: Number(env.wecomCallbackPort ?? 3193),
      });
    case 'wechat':
      // 实验性（v0.2b）：token 可缺省——未配置时启动扫码登录（iLink/ClawBot）
      return new WeChatAdapter({ token: env.wechatToken, stateDir: env.wechatStateDir ?? 'data/wechat' });
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
    feishuAppId: env.FEISHU_APP_ID,
    feishuAppSecret: env.FEISHU_APP_SECRET,
    dingtalkClientId: env.DINGTALK_CLIENT_ID,
    dingtalkClientSecret: env.DINGTALK_CLIENT_SECRET,
    wecomCorpId: env.WECOM_CORP_ID,
    wecomSecret: env.WECOM_SECRET,
    wecomAgentId: env.WECOM_AGENT_ID,
    wecomToken: env.WECOM_TOKEN,
    wecomEncodingAESKey: env.WECOM_ENCODING_AES_KEY,
    wecomCallbackPort: env.WECOM_CALLBACK_PORT,
    wechatToken: env.WECHAT_TOKEN,
    wechatStateDir: env.WECHAT_STATE_DIR,
    asrApiKey: env.ASR_API_KEY,
    asrBaseUrl: env.ASR_BASE_URL,
    asrModel: env.ASR_MODEL,
  };
}
