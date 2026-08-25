// 长文本工具：按渠道可读性分片（对齐竞品的长回复分段能力）。

const DEFAULT_CHUNK_LIMIT = 1500;

/** 纯函数：长文本按 limit 分片，优先在换行/句号/问号/感叹号处断行；超过 1 段时带（i/n）序号。 */
export function chunkLongText(text: string, limit = DEFAULT_CHUNK_LIMIT): string[] {
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
