/**
 * 为大文本生成轻量级 key。
 *
 * 用途：
 * - 避免在依赖数组中直接放入超大字符串
 * - 用于缓存命中（例如 lineStarts / prettyText）
 *
 * 注意：
 * - 对较小文本：使用 FNV-1a 全量哈希，尽量避免碰撞
 * - 对超大文本：使用固定窗口（首/中/尾）哈希，避免在主线程做 O(n) 扫描导致卡顿
 */
export function getTextKey(text: string): string {
  const len = text.length;
  if (len === 0) return "0:0";

  const FULL_HASH_MAX_CHARS = 200_000;
  const WINDOW_CHARS = 8192;

  let hash = 2166136261;

  const update = (code: number) => {
    hash ^= code;
    hash = Math.imul(hash, 16777619);
  };

  if (len <= FULL_HASH_MAX_CHARS) {
    for (let i = 0; i < len; i += 1) {
      update(text.charCodeAt(i));
    }
    return `${len}:${(hash >>> 0).toString(36)}`;
  }

  const firstEnd = Math.min(len, WINDOW_CHARS);
  for (let i = 0; i < firstEnd; i += 1) {
    update(text.charCodeAt(i));
  }

  const midStart = Math.max(firstEnd, (len >> 1) - (WINDOW_CHARS >> 1));
  const midEnd = Math.min(len, midStart + WINDOW_CHARS);
  for (let i = midStart; i < midEnd; i += 1) {
    update(text.charCodeAt(i));
  }

  const lastStart = Math.max(midEnd, len - WINDOW_CHARS);
  for (let i = lastStart; i < len; i += 1) {
    update(text.charCodeAt(i));
  }

  return `${len}:${(hash >>> 0).toString(36)}`;
}
