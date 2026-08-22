import { describe, expect, it, vi } from 'vitest';
import { FeedPoller, FeedStore, formatFeedItem, parseRss } from '../src/feed.js';
import type { Adapter } from '../src/adapter.js';

const SAMPLE_RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Example Feed</title>
  <item>
    <title>First post</title>
    <link>https://x.com/1</link>
    <guid>g-1</guid>
    <pubDate>Mon, 18 Aug 2026 10:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Second &amp; great post</title>
    <link>https://x.com/2</link>
    <guid>g-2</guid>
  </item>
</channel></rss>`;

describe('parseRss', () => {
  it('解析条目与实体解码', () => {
    const items = parseRss(SAMPLE_RSS);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: 'First post', link: 'https://x.com/1', guid: 'g-1', pubDate: 'Mon, 18 Aug 2026 10:00:00 GMT' });
    expect(items[1].title).toBe('Second & great post');
  });
  it('空/非法 XML 返回空', () => {
    expect(parseRss('')).toEqual([]);
    expect(parseRss('<rss></rss>')).toEqual([]);
  });
  it('CDATA 内容解码', () => {
    const xml = '<rss><channel><item><title><![CDATA[Hello <World>]]></title><guid>g</guid></item></channel></rss>';
    expect(parseRss(xml)[0].title).toBe('Hello <World>');
  });
});

describe('formatFeedItem', () => {
  it('带链接时输出 标题+链接', () => {
    expect(formatFeedItem({ title: 'A', link: 'https://a', guid: 'g' })).toContain('📰 A');
    expect(formatFeedItem({ title: 'A', link: 'https://a', guid: 'g' })).toContain('https://a');
  });
});

describe('FeedStore（内存模式）', () => {
  it('add / list / remove / updateLastGuid', () => {
    const store = new FeedStore();
    const feed = store.add('telegram', 'c1', 'https://feed.example/rss');
    expect(store.list()).toHaveLength(1);
    expect(feed.lastGuid).toBe('');
    store.updateLastGuid(feed.id, 'g-2');
    expect(store.list()[0].lastGuid).toBe('g-2');
    expect(store.remove(feed.id)).toBe(true);
    expect(store.list()).toHaveLength(0);
    expect(store.remove(feed.id)).toBe(false);
  });
});

describe('FeedPoller.pollOnce', () => {
  const fakeAdapter = { id: 'telegram', send: vi.fn(async () => {}) } as unknown as Adapter;

  it('首次订阅只建立游标不推送', async () => {
    const store = new FeedStore();
    const feed = store.add('telegram', 'c1', 'https://feed.example/rss');
    const poller = new FeedPoller(store, new Map([['telegram', fakeAdapter]]), {
      fetchImpl: vi.fn(async () => ({ ok: true, text: async () => SAMPLE_RSS }) as Response),
    });
    const pushed = await poller.pollOnce();
    expect(pushed).toBe(0);
    expect(store.list()[0].lastGuid).toBe('g-1');
    expect(fakeAdapter.send).not.toHaveBeenCalled();
    void feed;
  });

  it('游标之后的新条目按序推送', async () => {
    const store = new FeedStore();
    const feed = store.add('telegram', 'c1', 'https://feed.example/rss');
    // 首次订阅：游标建立在最新一条 g-1 上
    const poller1 = new FeedPoller(store, new Map([['telegram', fakeAdapter]]), {
      fetchImpl: vi.fn(async () => ({ ok: true, text: async () => SAMPLE_RSS }) as Response),
    });
    await poller1.pollOnce();
    expect(store.list()[0].lastGuid).toBe('g-1');
    fakeAdapter.send.mockClear();
    // 第二轮出现新条目 g-0（文档序最新在前）→ 只推 g-0
    const NEW_RSS = `<rss version="2.0"><channel><item><title>Brand new</title><link>https://x.com/0</link><guid>g-0</guid></item>${SAMPLE_RSS.slice(SAMPLE_RSS.indexOf('<item>'))}`;
    const poller2 = new FeedPoller(store, new Map([['telegram', fakeAdapter]]), {
      fetchImpl: vi.fn(async () => ({ ok: true, text: async () => NEW_RSS }) as Response),
    });
    const pushed = await poller2.pollOnce();
    expect(pushed).toBe(1);
    expect(fakeAdapter.send).toHaveBeenCalledWith('c1', expect.objectContaining({ text: expect.stringContaining('Brand new') }));
    expect(store.list()[0].lastGuid).toBe('g-0');
  });

  it('抓取失败不影响其他源', async () => {
    const store = new FeedStore();
    store.add('telegram', 'c1', 'https://bad.example');
    store.add('telegram', 'c1', 'https://good.example');
    const calls: string[] = [];
    const poller = new FeedPoller(store, new Map([['telegram', fakeAdapter]]), {
      fetchImpl: vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes('bad')) return { ok: false, status: 500 } as Response;
        return { ok: true, text: async () => SAMPLE_RSS } as Response;
      }),
    });
    await poller.pollOnce();
    expect(calls).toHaveLength(2);
  });
});
