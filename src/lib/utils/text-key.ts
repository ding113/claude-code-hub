/**
 * 为大文本生成轻量级 key（O(1)）。
 *
 * 用途：
 * - 避免在依赖数组中直接放入超大字符串
 * - 用于缓存命中（例如 lineStarts / prettyText）
 *
 * 注意：这是启发式 fingerprint，并非强哈希；但采样多个位置可显著降低碰撞概率。
 */
export function getTextKey(text: string): string {
  const len = text.length;
  if (len === 0) return "0:0:0:0:0:0";

  const first = text.charCodeAt(0);
  const second = len > 1 ? text.charCodeAt(1) : 0;
  const mid = text.charCodeAt(len >> 1);
  const penultimate = len > 1 ? text.charCodeAt(len - 2) : 0;
  const last = text.charCodeAt(len - 1);

  return `${len}:${first}:${second}:${mid}:${penultimate}:${last}`;
}
