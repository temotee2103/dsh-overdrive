// 文本工具：HTML 转义 + 长文分片（进程内 driver 共用；与 gateway/text.ts 同源逻辑）。

/** Telegram parse_mode=HTML 转义。 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 按可读性分片长文本；超过一段时每段带（i/n）序号。 */
export function chunkLongText(text: string, limit: number): string[] {
  if (!text) return [text];
  if (text.length <= limit) return [text];
  const raw: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const slice = rest.slice(0, limit);
    const breakAt = Math.max(
      slice.lastIndexOf('\n'),
      slice.lastIndexOf('。'),
      slice.lastIndexOf('！'),
      slice.lastIndexOf('？'),
      slice.lastIndexOf('.'),
      slice.lastIndexOf('!'),
      slice.lastIndexOf('?'),
      slice.lastIndexOf('；'),
    );
    const cut = breakAt >= limit * 0.6 ? breakAt + 1 : limit;
    raw.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) raw.push(rest);
  if (raw.length <= 1) return raw;
  return raw.map((chunk, i) => `${chunk}\n（${i + 1}/${raw.length}）`);
}
