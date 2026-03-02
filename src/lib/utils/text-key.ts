/**
 * 为大文本生成轻量级 key。
 *
 * 用途：
 * - 避免在依赖数组中直接放入超大字符串
 * - 用于缓存命中（例如 lineStarts / prettyText）
 *
 * 注意：
 * - 对较小文本：使用 FNV-1a 全量哈希，尽量避免碰撞
 * - 对超大文本：使用固定多窗口 + 全局步进采样，避免在主线程做 O(n) 扫描导致卡顿，同时尽量降低碰撞概率
 *
 * FULL_HASH_MAX_CHARS 是一个性能阈值：长度刚好跨过该值时，会从“全量哈希”切换为“采样哈希”。
 * 这是有意为之，用于避免极端大文本触发主线程卡顿。
 */
export function getTextKey(text: string): string {
  const len = text.length;
  if (len === 0) return "0:0";

  const FULL_HASH_MAX_CHARS = 200_000;
  const WINDOW_CHARS = 4096;

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

  const windowHalf = WINDOW_CHARS >> 1;
  const pushWindow = (start: number) => {
    const end = Math.min(len, start + WINDOW_CHARS);
    for (let i = start; i < end; i += 1) {
      update(text.charCodeAt(i));
    }
    return end;
  };

  let cursor = 0;
  cursor = pushWindow(0);
  cursor = pushWindow(Math.max(cursor, Math.floor(len * 0.25) - windowHalf));
  cursor = pushWindow(Math.max(cursor, Math.floor(len * 0.5) - windowHalf));
  cursor = pushWindow(Math.max(cursor, Math.floor(len * 0.75) - windowHalf));
  pushWindow(Math.max(cursor, len - WINDOW_CHARS));

  // 全局步进采样：让 hash 覆盖整个文本范围，降低“只修改未覆盖窗口区域”时的碰撞概率。
  const STRIDE_SAMPLES = 16_384;
  const step = Math.max(1, Math.floor(len / STRIDE_SAMPLES));

  for (let i = 0; i < len; i += step) {
    update(text.charCodeAt(i));
  }
  if (step > 1) {
    const offset = step >> 1;
    for (let i = offset; i < len; i += step) {
      update(text.charCodeAt(i));
    }
  }

  return `${len}:${(hash >>> 0).toString(36)}`;
}
