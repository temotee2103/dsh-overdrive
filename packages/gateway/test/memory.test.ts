import { describe, expect, it } from 'vitest';
import { MemoryStore, formatMemories, memoryScope, searchMemories } from '../src/memory.js';

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
