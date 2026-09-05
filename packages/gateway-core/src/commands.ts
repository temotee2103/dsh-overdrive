/**
 * 原生路径的斜杠命令解析（进程内，纯函数可测）。
 * apply() 层在 telegram driver 回调里先解析命令，命中则调度/回复，
 * 否则作为普通消息交给桥接。
 */

/** `/remind <N><unit> <提示>` 的解析结果。 */
export interface RemindSpec {
  delayMs: number;
  prompt: string;
}

const REMIND_RE = /^remind\s+(\d+(?:\.\d+)?)\s*(s|sec|secs|m|min|mins|h|hr|hrs)\s+(.+)$/i;

/** 纯函数：解析 remind 命令；非提醒文本返回 null。 */
export function parseRemindCommand(text: string): RemindSpec | null {
  const t = text.trim();
  const match = REMIND_RE.exec(t);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2].toLowerCase();
  const perUnit = unit.startsWith('s') ? 1000 : unit.startsWith('m') ? 60_000 : 3_600_000;
  const delayMs = Math.round(value * perUnit);
  if (delayMs <= 0) return null;
  return { delayMs, prompt: match[3].trim() };
}

/** 把提示格式化为易读串（确认用）。 */
export function describeRemindDelay(delayMs: number): string {
  if (delayMs >= 3_600_000) return `${Math.round(delayMs / 3_600_000)} 小时`;
  if (delayMs >= 60_000) return `${Math.round(delayMs / 60_000)} 分钟`;
  return `${Math.round(delayMs / 1000)} 秒`;
}
