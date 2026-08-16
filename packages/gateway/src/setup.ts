/**
 * dsh-overdrive setup wizard — 交互式设置向导（hermes setup 风格）
 *
 * 用法：
 *   node packages/gateway/dist/setup.js          （源码构建后）
 *   npx dsh-overdrive-setup                      （npm 全局/临时）
 *
 * 流程：DeepSeek key → 平台多选 → 逐个收集凭据并联网验证 → 写 .env → 打印下一步。
 * 全程英文为主、中文为辅；验证失败会提示"是否继续"。
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const C = {
  cyan: (t: string) => `\x1b[36m${t}\x1b[0m`,
  green: (t: string) => `\x1b[32m${t}\x1b[0m`,
  red: (t: string) => `\x1b[31m${t}\x1b[0m`,
  dim: (t: string) => `\x1b[90m${t}\x1b[0m`,
  bold: (t: string) => `\x1b[1m${t}\x1b[0m`,
};

/**
 * 输入层：TTY 用 readline（交互终端）；非 TTY 预读全部 stdin（管道/自动化/测试），
 * 逐行分发。输入耗尽时返回 ''，由 stopIfClosed 优雅收尾。
 */
const isTTY = !!stdin.isTTY;
let ttyRl: ReturnType<typeof createInterface> | null = null;
const pipeLines: string[] = [];
if (!isTTY) {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(chunk);
  pipeLines.push(...Buffer.concat(chunks).toString('utf8').split(/\r?\n/));
}
let inputClosed = !isTTY && pipeLines.length === 0;
async function promptOnce(question: string): Promise<string> {
  if (isTTY) {
    ttyRl ??= createInterface({ input: stdin, output: stdout, terminal: true });
    try {
      return await ttyRl.question(question);
    } catch {
      inputClosed = true;
      return '';
    }
  }
  const line = pipeLines.shift() ?? '';
  if (line === '' && pipeLines.length === 0) inputClosed = true;
  stdout.write(`${question}${line}\n`); // 非 TTY 无回显，手动回显
  return line;
}
function closeInput(): void {
  try { ttyRl?.close(); } catch { /* noop */ }
}
async function ask(q: string, hint = ''): Promise<string> {
  const answer = await promptOnce(`${C.cyan('?')} ${q} ${C.dim(hint)}\n> `);
  return answer.trim();
}
async function confirm(q: string): Promise<boolean> {
  const a = (await promptOnce(`${C.cyan('?')} ${q} ${C.dim('[y/N]')}\n> `)).trim().toLowerCase();
  return a === 'y' || a === 'yes';
}
function stopIfClosed(): void {
  if (inputClosed) {
    console.log(C.dim('\n  input closed — aborting / 输入已关闭，向导中止'));
    console.log(C.dim('  (run in an interactive terminal / 请在交互式终端中运行)'));
    process.exit(1);
  }
}

/** 联网验证辅助：返回 {ok, reason}；网络异常按"无法验证"处理（由调用方决定是否继续）。 */
async function probe(fn: () => Promise<boolean>, name: string): Promise<{ ok: boolean; reason: string }> {
  try {
    return (await fn()) ? { ok: true, reason: `${name} verified / 验证通过` } : { ok: false, reason: `${name} rejected / 验证失败` };
  } catch (error) {
    return { ok: false, reason: `${name} unreachable (network?) / 网络不可达: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const PROBES: Record<string, (v: Record<string, string>) => Promise<boolean>> = {
  deepseek: async (v) => {
    const r = await fetch('https://api.deepseek.com/user/balance', { headers: { authorization: `Bearer ${v.DEEPSEEK_API_KEY}` } });
    return r.ok;
  },
  telegram: async (v) => {
    const r = await fetch(`https://api.telegram.org/bot${v.TELEGRAM_BOT_TOKEN}/getMe`);
    const j = (await r.json()) as { ok?: boolean };
    return j.ok === true;
  },
  discord: async (v) => {
    const r = await fetch('https://discord.com/api/v10/users/@me', { headers: { authorization: `Bot ${v.DISCORD_BOT_TOKEN}` } });
    return r.ok;
  },
  slack: async (v) => {
    const r = await fetch('https://slack.com/api/auth.test', { headers: { authorization: `Bearer ${v.SLACK_BOT_TOKEN}` } });
    const j = (await r.json()) as { ok?: boolean };
    return j.ok === true;
  },
  feishu: async (v) => {
    const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: v.FEISHU_APP_ID, app_secret: v.FEISHU_APP_SECRET }),
    });
    const j = (await r.json()) as { code?: number };
    return j.code === 0;
  },
  dingtalk: async (v) => {
    const r = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appKey: v.DINGTALK_CLIENT_ID, appSecret: v.DINGTALK_CLIENT_SECRET }),
    });
    return r.ok;
  },
  wecom: async (v) => {
    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(v.WECOM_CORP_ID)}&corpsecret=${encodeURIComponent(v.WECOM_SECRET)}`;
    const j = (await (await fetch(url)).json()) as { errcode?: number };
    return j.errcode === 0;
  },
};

const PLATFORMS: Record<string, { label: string; fields: Array<[key: string, prompt: string, hint: string, pattern?: RegExp]> }> = {
  telegram: {
    label: 'Telegram',
    fields: [['TELEGRAM_BOT_TOKEN', 'Telegram bot token', 'https://t.me/BotFather → /newbot', /^\d+:[A-Za-z0-9_-]{20,}$/]],
  },
  whatsapp: {
    label: 'WhatsApp (no credentials — QR pairing on first start / 无需凭据，首次启动扫码)',
    fields: [],
  },
  discord: {
    label: 'Discord',
    fields: [['DISCORD_BOT_TOKEN', 'Discord bot token', 'Developer Portal → Bot → Token', /^[A-Za-z0-9._-]{20,}$/]],
  },
  slack: {
    label: 'Slack (Socket Mode)',
    fields: [
      ['SLACK_BOT_TOKEN', 'Slack bot token (xoxb-…)', 'App → OAuth & Permissions', /^xoxb-/],
      ['SLACK_APP_TOKEN', 'Slack app-level token (xapp-…)', 'App → Basic Information → App-Level Tokens', /^xapp-/],
    ],
  },
  feishu: {
    label: '飞书 Feishu',
    fields: [
      ['FEISHU_APP_ID', 'Feishu App ID', '开放平台 → 应用凭证', /^cli_/],
      ['FEISHU_APP_SECRET', 'Feishu App Secret', '开放平台 → 应用凭证', /.+/],
    ],
  },
  dingtalk: {
    label: '钉钉 DingTalk',
    fields: [
      ['DINGTALK_CLIENT_ID', 'DingTalk Client ID (AppKey)', '应用开发 → 凭证与基础信息', /.+/],
      ['DINGTALK_CLIENT_SECRET', 'DingTalk Client Secret', '应用开发 → 凭证与基础信息', /.+/],
    ],
  },
  wecom: {
    label: '企业微信 WeCom',
    fields: [
      ['WECOM_CORP_ID', 'WeCom Corp ID', '我的企业 → 企业信息', /.+/],
      ['WECOM_SECRET', 'WeCom Secret', '应用管理 → 应用 → Secret', /.+/],
      ['WECOM_AGENT_ID', 'WeCom Agent ID', '应用管理 → 应用 → AgentId', /^\d+$/],
      ['WECOM_TOKEN', 'WeCom callback Token', '接收消息 → Token（随意填一串）', /.+/],
      ['WECOM_ENCODING_AES_KEY', 'WeCom EncodingAESKey', '接收消息 → EncodingAESKey（43 位）', /^[A-Za-z0-9]{43}$/],
    ],
  },
};

/** 读取已有 .env（若存在）合并；返回新内容。 */
function buildEnv(current: string, pairs: Array<[string, string]>): string {
  const map = new Map<string, string>();
  for (const line of current.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) map.set(m[1], m[2]);
  }
  for (const [k, v] of pairs) map.set(k, v);
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
}

async function main(): Promise<void> {
  console.log('');
  console.log(C.bold(C.cyan('==================================================')));
  console.log(C.bold(C.cyan('  dsh-overdrive setup — the OpenClaw of DeepSeek Harness')));
  console.log(C.bold(C.cyan('  交互式设置向导（hermes setup 风格）')));
  console.log(C.bold(C.cyan('==================================================')));
  console.log('');

  const pairs: Array<[string, string]> = [];
  let platforms: string[] = [];

  // 1. DeepSeek API key
  console.log(C.dim('  1/3 DeepSeek API key — get one: https://platform.deepseek.com/api_keys'));
  for (;;) {
    const key = await ask('Paste your DeepSeek API key (sk-…)', '必填');
    stopIfClosed();
    if (!/^sk-/.test(key)) { console.log(C.red('  [x] should start with sk- / 应以 sk- 开头')); continue; }
    const r = await probe(() => PROBES.deepseek({ DEEPSEEK_API_KEY: key }), 'DeepSeek key');
    console.log(r.ok ? C.green(`  [ok] ${r.reason}`) : C.red(`  [!] ${r.reason}`));
    if (r.ok || (await confirm('Continue anyway? / 仍然继续？'))) { pairs.push(['DEEPSEEK_API_KEY', key]); break; }
  }

  // 2. platforms
  console.log(C.dim('  2/3 Platforms — telegram, whatsapp, discord, slack, feishu, dingtalk, wecom'));
  const chosen = await ask('Which platforms? (comma separated, default: telegram)', '逗号分隔，默认 telegram');
  stopIfClosed();
  platforms = (chosen || 'telegram').split(',').map((s) => s.trim().toLowerCase()).filter((s) => PLATFORMS[s]);
  if (platforms.length === 0) { console.log(C.red('  [x] no valid platform selected / 未选择有效平台')); process.exit(1); }

  // 3. per-platform credentials
  console.log(C.dim('  3/3 Platform credentials (each is verified live) / 平台凭据（逐个实时验证）'));
  for (const p of platforms) {
    console.log(`\n  ${C.bold('-- ' + PLATFORMS[p].label)} --`);
    const vals: Record<string, string> = { ...Object.fromEntries(pairs) };
    for (const [key, prompt, hint, pattern] of PLATFORMS[p].fields) {
      for (;;) {
        const v = await ask(prompt, hint);
        stopIfClosed();
        if (pattern && !pattern.test(v)) { console.log(C.red(`  [x] format looks wrong / 格式不对（${hint}）`)); continue; }
        vals[key] = v;
        break;
      }
    }
    const probeFn = PROBES[p];
    if (probeFn && p !== 'whatsapp') {
      const r = await probe(() => probeFn(vals), PLATFORMS[p].label);
      console.log(r.ok ? C.green(`  [ok] ${r.reason}`) : C.red(`  [!] ${r.reason}`));
      if (!r.ok && !(await confirm('Continue anyway? / 仍然继续？'))) { console.log(C.red('  skipped / 已跳过')); continue; }
    }
    for (const [k, v] of PLATFORMS[p].fields) pairs.push([k, vals[k]]);
  }
  if (platforms.includes('whatsapp')) console.log(C.dim('  WhatsApp: no credentials needed — QR shows on first start / 无需凭据，启动时扫码'));

  // 4. write .env
  const envPath = join(process.cwd(), '.env');
  const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const merged = buildEnv(current, [...pairs, ['GATEWAY_ADAPTERS', platforms.join(',')], ['DSH_OVERDRIVE_TOKEN', 'dsh-overdrive-token']]);
  writeFileSync(envPath, merged, 'utf8');
  console.log(`\n  ${C.green('[ok]')} .env written → ${C.bold(envPath)}（已合并现有配置）`);

  // 5. next steps
  console.log('');
  console.log(C.bold(C.cyan('==================================================')));
  console.log(C.bold(C.cyan('  Next steps / 下一步')));
  console.log(`  ${C.cyan('1)')} Start:  docker compose -f deploy/docker-compose.yml up -d --build`);
  console.log(`     or:     GATEWAY_ADAPTERS=${platforms.join(',')} npx @dsh-overdrive/gateway`);
  console.log(`  ${C.cyan('2)')} Console / 控制台:  http://localhost:3190/  （含四步引导向导）`);
  console.log(`  ${C.cyan('3)')} DSH Web UI (model): http://localhost:3080/`);
  console.log(`  ${C.cyan('4)')} In your chat app:   send /help`);
  console.log(C.bold(C.cyan('==================================================')));
  console.log('');
  closeInput();
}

void main();
