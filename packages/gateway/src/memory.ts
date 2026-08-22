// 记忆系统（对标 OpenClaw 的 long-term memory）。
// 按 platform:userId 作用域存储用户显式记忆（/remember），支持搜索（/recall）与删除（/forget）；
// 入站消息时自动检索相关记忆注入上下文，让 agent「记得你」。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface MemoryEntry {
  id: string;
  text: string;
  createdAt: string;
}

/** 作用域键：platform:userId（记忆跟随用户，跨频道共享，与 OpenClaw 一致）。 */
export function memoryScope(adapterId: string, userId: string): string {
  return `${adapterId}:${userId}`;
}

/** 字符 2-gram：CJK 无空格分词，用共享 bigram 判断相关性（比子串包含更鲁棒）。 */
function bigrams(text: string): Set<string> {
  const clean = text.toLowerCase();
  const out = new Set<string>();
  for (let i = 0; i < clean.length - 1; i++) out.add(clean.slice(i, i + 2));
  return out;
}

/** 纯函数：按查询文本检索记忆——与查询共享任意 2-gram 即相关；空查询返回全部。 */
export function searchMemories(entries: MemoryEntry[], query: string): MemoryEntry[] {
  const queryBigrams = bigrams(query);
  if (queryBigrams.size === 0) return entries;
  return entries.filter((entry) => {
    const memoryBigrams = bigrams(entry.text);
    for (const gram of queryBigrams) {
      if (memoryBigrams.has(gram)) return true;
    }
    return false;
  });
}

/** 纯函数：记忆列表 → 注入文本（拼在用户消息后）。 */
export function formatMemories(entries: MemoryEntry[]): string {
  if (entries.length === 0) return '';
  const lines = entries.map((e) => `- ${e.text}`).join('\n');
  return `\n📌 相关记忆：\n${lines}`;
}

/** JSON 文件持久化的记忆存储；file 缺省时仅内存（测试/无盘环境用）。 */
export class MemoryStore {
  private readonly data = new Map<string, MemoryEntry[]>();
  private readonly file?: string;

  constructor(file?: string) {
    this.file = file;
    if (file && existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, MemoryEntry[]>;
        for (const [scope, entries] of Object.entries(parsed)) {
          if (Array.isArray(entries)) this.data.set(scope, entries);
        }
      } catch {
        /* 损坏则从空开始 */
      }
    }
  }

  private persist(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.data), null, 2), 'utf8');
    } catch {
      /* 持久化失败不阻断 */
    }
  }

  add(scope: string, text: string): MemoryEntry {
    const entry: MemoryEntry = { id: randomUUID().slice(0, 8), text: text.trim(), createdAt: new Date().toISOString() };
    const list = this.data.get(scope) ?? [];
    list.push(entry);
    this.data.set(scope, list);
    this.persist();
    return entry;
  }

  list(scope: string): MemoryEntry[] {
    return this.data.get(scope) ?? [];
  }

  search(scope: string, query: string): MemoryEntry[] {
    return searchMemories(this.list(scope), query);
  }

  /** 删除某作用域下指定 id 的记忆；不存在返回 false。 */
  remove(scope: string, id: string): boolean {
    const list = this.data.get(scope);
    if (!list) return false;
    const next = list.filter((e) => e.id !== id);
    if (next.length === list.length) return false;
    this.data.set(scope, next);
    this.persist();
    return true;
  }

  count(scope: string): number {
    return this.list(scope).length;
  }
}
