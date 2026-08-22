// RSS 订阅推送（零依赖）：/feed add/list/rm + 定时轮询新条目推送到聊天。
// 解析器为纯函数（RSS 2.0 子集 + 基本实体解码），可单测。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Adapter } from './adapter.js';

export interface RssItem {
  title: string;
  link: string;
  guid: string;
  pubDate?: string;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .trim();
}

/** 纯函数：RSS 2.0 XML → 条目列表（title/link/guid/pubDate）。 */
export function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const grab = (tag: string): string => {
      const r = new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)</${tag}>`, 'i');
      const mm = r.exec(block);
      return mm ? decodeEntities(mm[1]) : '';
    };
    const title = grab('title');
    const link = grab('link');
    if (!title && !link) continue;
    items.push({
      title,
      link,
      guid: grab('guid') || link || title,
      pubDate: grab('pubDate') || undefined,
    });
  }
  return items;
}

/** 纯函数：新条目摘要文本（推送用）。 */
export function formatFeedItem(item: RssItem): string {
  const title = item.title || '(无标题)';
  return item.link ? `📰 ${title}\n${item.link}` : `📰 ${title}`;
}

export interface Feed {
  id: string;
  adapterId: string;
  chatId: string;
  url: string;
  /** 已推送过的最大条目 guid（增量推送游标） */
  lastGuid: string;
  addedAt: string;
}

/** JSON 持久化的订阅存储；file 缺省时仅内存（测试用）。 */
export class FeedStore {
  private readonly feeds: Feed[] = [];
  private readonly file?: string;

  constructor(file?: string) {
    this.file = file;
    if (file && existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as Feed[];
        if (Array.isArray(parsed)) this.feeds.push(...parsed);
      } catch {
        /* 损坏则从空开始 */
      }
    }
  }

  private persist(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.feeds, null, 2), 'utf8');
    } catch {
      /* 持久化失败不阻断 */
    }
  }

  add(adapterId: string, chatId: string, url: string): Feed {
    const feed: Feed = {
      id: randomUUID().slice(0, 8),
      adapterId,
      chatId,
      url,
      lastGuid: '',
      addedAt: new Date().toISOString(),
    };
    this.feeds.push(feed);
    this.persist();
    return feed;
  }

  list(): Feed[] {
    return [...this.feeds];
  }

  remove(id: string): boolean {
    const idx = this.feeds.findIndex((f) => f.id === id);
    if (idx < 0) return false;
    this.feeds.splice(idx, 1);
    this.persist();
    return true;
  }

  updateLastGuid(id: string, guid: string): void {
    const feed = this.feeds.find((f) => f.id === id);
    if (!feed) return;
    // 游标无条件推进：迭代顺序由轮询器控制（文档序），避免非单调 GUID 比较出错
    feed.lastGuid = guid;
    this.persist();
  }
}

export interface FeedPollerOptions {
  intervalMs?: number;
  fetchImpl?: typeof fetch;
}

/** 轮询器：定时抓取每个订阅源，把新条目推送到对应聊天（假定文档序最新在前）。 */
export class FeedPoller {
  private timer?: ReturnType<typeof setInterval>;
  private readonly intervalMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly store: FeedStore,
    private readonly adapters: Map<string, Adapter>,
    opts: FeedPollerOptions = {},
  ) {
    this.intervalMs = opts.intervalMs ?? 5 * 60_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.pollOnce(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** 抓一轮：每个订阅源 fetch → 解析 → 增量推送新条目。返回推送条数。 */
  async pollOnce(): Promise<number> {
    let pushed = 0;
    for (const feed of this.store.list()) {
      const adapter = this.adapters.get(feed.adapterId);
      if (!adapter) continue;
      try {
        const res = await this.fetchImpl(feed.url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) continue;
        const items = parseRss(await res.text());
        if (items.length === 0) continue;
        if (!feed.lastGuid) {
          // 首次订阅：只建立游标（最新一条），不推送历史，避免刷屏
          this.store.updateLastGuid(feed.id, items[0].guid);
          continue;
        }
        const cursor = feed.lastGuid; // 捕获轮询开始时的游标，迭代中不随推进而变化
        for (const item of items) {
          if (item.guid === cursor) break; // 游标之前的都是新条目
          this.store.updateLastGuid(feed.id, item.guid);
          await adapter.send(feed.chatId, { text: formatFeedItem(item) });
          pushed += 1;
        }
      } catch {
        /* 单源失败不影响其他源 */
      }
    }
    return pushed;
  }
}
