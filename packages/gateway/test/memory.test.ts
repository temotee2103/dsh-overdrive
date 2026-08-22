import { describe, expect, it } from 'vitest';
import { MemoryStore, extractAutoMemories, formatMemories, memoryScope, searchMemories } from '../src/memory.js';

describe('memoryScope', () => {
  it('按 platform:userId 作用域（记忆跟随用户跨频道）', () => {
    expect(memoryScope('telegram', 'u1')).toBe('telegram:u1');
  });
});

describe('searchMemories', () => {
  const entries = [
    { id: '1', text: '用户喜欢喝美式咖啡', createdAt: 'x' },
    { id: '2', text: '用户住在杭州', createdAt: 'x' },
    { id: '3', text: '项目用 TypeScript', createdAt: 'x' },
  ];
  it('任一关键词命中即返回', () => {
    expect(searchMemories(entries, '咖啡').map((e) => e.id)).toEqual(['1']);
    expect(searchMemories(entries, '杭州 咖啡').map((e) => e.id).sort()).toEqual(['1', '2']);
  });
  it('无匹配返回空', () => {
    expect(searchMemories(entries, '滑雪')).toEqual([]);
  });
  it('空查询返回全部', () => {
    expect(searchMemories(entries, '')).toHaveLength(3);
  });
  it('大小写不敏感', () => {
    expect(searchMemories(entries, 'typescript').map((e) => e.id)).toEqual(['3']);
  });
});

describe('formatMemories', () => {
  it('空列表返回空串', () => {
    expect(formatMemories([])).toBe('');
  });
  it('渲染注入块', () => {
    const text = formatMemories([{ id: '1', text: '用户住在杭州', createdAt: 'x' }]);
    expect(text).toContain('📌 相关记忆');
    expect(text).toContain('用户住在杭州');
  });
});

describe('MemoryStore（内存模式）', () => {
  it('add / list / search / remove 全流程', () => {
    const store = new MemoryStore(); // 无文件 = 纯内存
    const entry = store.add('telegram:u1', '用户喜欢喝美式咖啡');
    expect(store.count('telegram:u1')).toBe(1);
    expect(store.list('telegram:u1')[0].text).toBe('用户喜欢喝美式咖啡');
    expect(store.search('telegram:u1', '咖啡')).toHaveLength(1);
    expect(store.remove('telegram:u1', entry.id)).toBe(true);
    expect(store.count('telegram:u1')).toBe(0);
    expect(store.remove('telegram:u1', entry.id)).toBe(false);
  });
  it('不同作用域隔离', () => {
    const store = new MemoryStore();
    store.add('telegram:u1', 'A 的记忆');
    store.add('whatsapp:u1', 'B 的记忆');
    expect(store.list('telegram:u1')).toHaveLength(1);
    expect(store.list('whatsapp:u1')).toHaveLength(1);
  });
});

describe('extractAutoMemories', () => {
  it('识别自我事实（我叫/我住在/我喜欢/我的邮箱等）', () => {
    expect(extractAutoMemories('你好，我叫小明')).toEqual(['我叫小明']);
    expect(extractAutoMemories('我住在杭州')).toEqual(['我住在杭州']);
    expect(extractAutoMemories('我喜欢喝美式咖啡')).toEqual(['我喜欢喝美式咖啡']);
    expect(extractAutoMemories('我的邮箱是 a@b.com，麻烦发我')).toEqual(['我的邮箱是 a@b.com']);
    expect(extractAutoMemories('我的职业是产品经理')).toEqual(['我的职业是产品经理']);
  });
  it('普通消息不触发', () => {
    expect(extractAutoMemories('今天天气如何')).toEqual([]);
    expect(extractAutoMemories('帮我写个脚本')).toEqual([]);
  });
  it('同一消息多模式只取各自匹配', () => {
    const facts = extractAutoMemories('我叫小红，我住在上海');
    expect(facts).toContain('我叫小红');
    expect(facts).toContain('我住在上海');
  });
});
