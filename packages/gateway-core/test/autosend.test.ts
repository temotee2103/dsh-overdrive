import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findNewMediaFiles, mediaKindForName } from '../src/autosend.js';

describe('mediaKindForName', () => {
  it('图片/语音/文件分类，未知扩展名返回 null', () => {
    expect(mediaKindForName('a.png')).toBe('image');
    expect(mediaKindForName('b.JPG')).toBe('image');
    expect(mediaKindForName('v.ogg')).toBe('voice');
    expect(mediaKindForName('r.pdf')).toBe('file');
    expect(mediaKindForName('README.md')).toBe('file');
    expect(mediaKindForName('script.ts')).toBeNull();
    expect(mediaKindForName('archive.xyz')).toBeNull();
  });
});

describe('findNewMediaFiles', () => {
  it('只返回未被 seen 记录的媒体文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-autosend-'));
    try {
      writeFileSync(join(dir, 'out.png'), 'x');
      writeFileSync(join(dir, 'notes.md'), 'y');
      writeFileSync(join(dir, 'script.ts'), 'z'); // 非媒体扩展名
      const found = findNewMediaFiles(dir, new Set());
      expect(found.map((f) => f.name).sort()).toEqual(['notes.md', 'out.png']);
      expect(found.every((f) => f.kind !== null)).toBe(true);
      // 已 seen → 不再返回（跨 turn 去重）
      const again = findNewMediaFiles(dir, new Set(found.map((f) => f.name)));
      expect(again).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('目录不存在返回空', () => {
    expect(findNewMediaFiles(join(tmpdir(), 'no-such-dir-xyz'), new Set())).toEqual([]);
  });
});
