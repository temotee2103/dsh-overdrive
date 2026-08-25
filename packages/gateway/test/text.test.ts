import { describe, expect, it } from 'vitest';
import { chunkLongText } from '../src/text.js';

describe('chunkLongText', () => {
  it('短文本不分片', () => {
    expect(chunkLongText('hello')).toEqual(['hello']);
  });
  it('超长文本按句号断行并带序号', () => {
    const text = ('这是一段很长的内容。'.repeat(200));
    const chunks = chunkLongText(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toMatch(/（\d+\/\d+）$/);
    expect(chunks.every((c) => c.length <= 130)).toBe(true);
  });
  it('无标点长文本按硬上限截断', () => {
    const chunks = chunkLongText('x'.repeat(500), 200);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBeLessThanOrEqual(210);
  });
});
