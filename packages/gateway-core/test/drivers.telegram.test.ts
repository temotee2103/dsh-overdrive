import { describe, expect, it } from 'vitest';
import { chunkLongText, escapeHtml } from '../src/format.js';
import {
  TelegramNativeDriver,
  telegramCommand,
  type RawTelegramUpdate,
  type TelegramApiLike,
} from '../src/drivers/telegram.js';

// —— fake Bot API seam ——
function fakeApi(queue: RawTelegramUpdate[][] = [], opts: { filePath?: string } = {}) {
  const sent: Array<{ chatId: number | string; text: string; extra?: Record<string, unknown> }> = [];
  const actions: Array<{ chatId: number | string; action: string }> = [];
  const polls: number[] = [];
  const api: TelegramApiLike = {
    async getMe() {
      return { id: 1 };
    },
    async getUpdates(params) {
      polls.push(params.offset);
      return { result: queue.shift() ?? [] };
    },
    async sendMessage(chatId, text, extra) {
      sent.push({ chatId, text, extra });
      return { message_id: 1 };
    },
    async sendChatAction(chatId, action) {
      actions.push({ chatId, action });
      return { ok: true };
    },
    async getFile() {
      return opts.filePath === undefined ? { result: {} } : { result: { file_path: opts.filePath } };
    },
  };
  return { api, sent, actions, polls };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('format 助手', () => {
  it('escapeHtml 转义 < > &', () => {
    expect(escapeHtml('<b>&</b>')).toBe('&lt;b&gt;&amp;&lt;/b&gt;');
  });
  it('chunkLongText 超限分片带序号，短文本不分', () => {
    expect(chunkLongText('短', 20)).toEqual(['短']);
    const parts = chunkLongText('一'.repeat(45), 20);
    expect(parts).toHaveLength(3);
    expect(parts[0].endsWith('（1/3）')).toBe(true);
  });
});

describe('TelegramNativeDriver（进程内，P1）', () => {
  it('入站消息经鉴权后回调 onIncoming（channel=chat, user=from）', async () => {
    const { api } = fakeApi([
      [{ update_id: 1, message: { text: '你好', from: { id: 7 }, chat: { id: 111 } } }],
    ]);
    const driver = new TelegramNativeDriver({
      token: 't',
      allowAllUsers: true,
      api,
      sleep: () => tick(),
    });
    const got: Array<{ channel: string; user: string; text: string }> = [];
    await driver.start((m) => void got.push(m));
    await tick();
    driver.stop();
    expect(got).toEqual([{ channel: '111', user: '7', text: '你好' }]);
  });

  it('不在 allowlist 且未开 allowAll 时忽略（仅提示一次）', async () => {
    const { api, sent } = fakeApi([
      [{ update_id: 1, message: { text: 'hi', from: { id: 99 }, chat: { id: 1 } } }],
      [{ update_id: 2, message: { text: 'hi2', from: { id: 99 }, chat: { id: 1 } } }],
    ]);
    const driver = new TelegramNativeDriver({
      token: 't',
      allowedUserIds: [7],
      api,
      sleep: () => tick(),
    });
    const got: string[] = [];
    await driver.start((m) => void got.push(m.text));
    await tick();
    await tick();
    driver.stop();
    expect(got).toEqual([]);
    // 只提示一次（非重复骚扰）
    const hints = sent.filter((s) => s.text.includes('允许列表'));
    expect(hints).toHaveLength(1);
  });

  it('send(complete) 用 HTML 转义 + 长文分片逐条发送', async () => {
    const { api, sent } = fakeApi();
    const driver = new TelegramNativeDriver({
      token: 't',
      allowAllUsers: true,
      maxMessageLength: 20,
      api,
      sleep: () => tick(),
    });
    await driver.start(() => {});
    const long = '<x>' + '字'.repeat(45);
    await driver.send({ channel: '111', user: '7' }, { kind: 'complete', text: long });
    driver.stop();
    expect(sent.length).toBeGreaterThan(1);
    expect(sent[0].extra?.parse_mode).toBe('HTML');
    expect(sent[0].text).toContain('&lt;x&gt;');
    // 全部分片拼回去（去掉序号后缀）应等于「分片后转义」的原文
    const joined = sent.map((s) => s.text.replace(/\n（\d+\/\d+）$/, '')).join('');
    expect(joined).toBe(escapeHtml(long));
  });

  it('busy 状态发送 typing（限频）', async () => {
    const { api, actions } = fakeApi();
    const driver = new TelegramNativeDriver({ token: 't', api, sleep: () => tick() });
    await driver.start(() => {});
    await driver.send({ channel: '111', user: '7' }, { kind: 'status', status: 'busy' });
    await driver.send({ channel: '111', user: '7' }, { kind: 'status', status: 'busy' });
    driver.stop();
    expect(actions.length).toBe(1); // 4s 限频内只发一次
    expect(actions[0]).toEqual({ chatId: '111', action: 'typing' });
  });

  it('轮询 offset 推进（已处理 update 不再重复）', async () => {
    const { api, polls } = fakeApi([
      [{ update_id: 5, message: { text: 'a', from: { id: 1 }, chat: { id: 2 } } }],
    ]);
    const driver = new TelegramNativeDriver({
      token: 't',
      allowAllUsers: true,
      api,
      sleep: () => new Promise((r) => setImmediate(r)),
    });
    await driver.start(() => {});
    await tick();
    await tick();
    driver.stop();
    expect(polls[0]).toBe(0);
    expect(polls[1]).toBe(6);
  });

  it('命令识别', () => {
    expect(telegramCommand('/new')).toBe('/new');
    expect(telegramCommand('/clear')).toBe('/clear');
    expect(telegramCommand('/help')).toBe('/help');
    expect(telegramCommand('/start')).toBe('/help');
    expect(telegramCommand('hello')).toBeNull();
  });

  it('图片消息：photo → getFile → 可下载 URL + caption', async () => {
    const { api } = fakeApi(
      [[{ update_id: 1, message: { caption: '看图', photo: [{ file_id: 'small' }, { file_id: 'big' }], from: { id: 7 }, chat: { id: 111 } } }]],
      { filePath: 'photos/big.jpg' },
    );
    const driver = new TelegramNativeDriver({ token: 't', allowAllUsers: true, api, sleep: () => tick() });
    const got: Array<{ channel: string; user: string; text: string; media?: { kind?: string; url?: string; caption?: string } }> = [];
    await driver.start((m) => void got.push(m as never));
    await tick();
    driver.stop();
    expect(got).toHaveLength(1);
    expect(got[0].media?.kind).toBe('image');
    expect(got[0].media?.url).toBe('https://api.telegram.org/file/bott/photos/big.jpg'); // 取最大尺寸
    expect(got[0].media?.caption).toBe('看图');
  });

  it('图片 file_path 获取失败时降级为纯文本（不丢 caption）', async () => {
    const { api } = fakeApi(
      [[{ update_id: 1, message: { caption: '注', photo: [{ file_id: 'a' }], from: { id: 7 }, chat: { id: 1 } } }]],
    );
    const driver = new TelegramNativeDriver({ token: 't', allowAllUsers: true, api, sleep: () => tick() });
    const got: Array<{ text: string; media?: unknown }> = [];
    await driver.start((m) => void got.push(m as never));
    await tick();
    driver.stop();
    expect(got).toHaveLength(1);
    expect(got[0].text).toBe('注');
    expect(got[0].media).toBeUndefined();
  });
});
