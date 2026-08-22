// 自动发送（OpenClaw 式）：agent 一轮 turn 结束后，扫描其工作目录里新产生的
// 图片/文档/语音文件，经协议事件（file.created，base64）发回聊天。

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const MEDIA_EXTENSIONS: Record<'image' | 'voice' | 'file', string[]> = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'],
  voice: ['ogg', 'oga', 'opus', 'mp3', 'wav', 'webm', 'm4a', 'aac'],
  file: ['pdf', 'docx', 'doc', 'xlsx', 'pptx', 'zip', 'md', 'txt', 'csv', 'json', 'mp4', 'mov'],
};

/** 纯函数：文件名 → 媒体分类；不认识的扩展名返回 null（不自动发送）。 */
export function mediaKindForName(name: string): 'image' | 'voice' | 'file' | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (MEDIA_EXTENSIONS.image.includes(ext)) return 'image';
  if (MEDIA_EXTENSIONS.voice.includes(ext)) return 'voice';
  if (MEDIA_EXTENSIONS.file.includes(ext)) return 'file';
  return null;
}

export interface FoundMedia {
  name: string;
  path: string;
  kind: 'image' | 'voice' | 'file';
  bytes: number;
}

/**
 * 纯函数（目录参数化，可单测）：扫描目录中「未被 seen 记录」且扩展名属于媒体集合的常规文件。
 * seen 集合用于跨 turn 去重（同一文件只自动发送一次）。
 */
export function findNewMediaFiles(dir: string, seen: Set<string>): FoundMedia[] {
  const out: FoundMedia[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // 目录不存在/无权限 → 空
  }
  for (const name of entries) {
    if (seen.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const kind = mediaKindForName(name);
    if (!kind) continue;
    out.push({ name, path: full, kind, bytes: st.size });
  }
  return out;
}
