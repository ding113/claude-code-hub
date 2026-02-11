/**
 * 将输入归一化为正整数限额。
 *
 * - 非数字 / 非有限值 / <= 0 视为 0（无限制）
 * - > 0 时向下取整
 */
function normalizePositiveLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.floor(value);
}

/**
 * 解析 Key 的“有效并发 Session 上限”。
 *
 * 规则：
 * - Key 自身设置（>0）优先生效
 * - Key 未设置/为 0 时，回退到 User 并发上限（>0）
 * - 都未设置/为 0 时，返回 0（表示无限制）
 */
export function resolveKeyConcurrentSessionLimit(
  keyLimit: number | null | undefined,
  userLimit: number | null | undefined
): number {
  const normalizedKeyLimit = normalizePositiveLimit(keyLimit);
  if (normalizedKeyLimit > 0) {
    return normalizedKeyLimit;
  }

  return normalizePositiveLimit(userLimit);
}
