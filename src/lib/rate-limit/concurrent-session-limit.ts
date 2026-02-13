/**
 * 将输入归一化为正整数限额。
 *
 * - 非数字 / 非有限值 / <= 0 视为 0（无限制）
 * - > 0 时向下取整
 */
export function normalizeConcurrentSessionLimit(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.floor(value);
}

/**
 * 同时解析 Key/User 的并发 Session 上限（供 proxy guards 统一复用）。
 *
 * - `effectiveKeyLimit`：Key 的有效上限（Key>0 优先，否则回退到 User>0；都未设置则为 0）
 * - `normalizedUserLimit`：User 上限的归一化结果（<=0 视为 0）
 * - `enabled`：任一维度上限 >0 即为 true
 */
export function resolveKeyUserConcurrentSessionLimits(
  keyLimit: number | null | undefined,
  userLimit: number | null | undefined
): { effectiveKeyLimit: number; normalizedUserLimit: number; enabled: boolean } {
  const normalizedUserLimit = normalizeConcurrentSessionLimit(userLimit);
  const effectiveKeyLimit = resolveKeyConcurrentSessionLimit(keyLimit, userLimit);
  const enabled = effectiveKeyLimit > 0 || normalizedUserLimit > 0;

  return { effectiveKeyLimit, normalizedUserLimit, enabled };
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
  const normalizedKeyLimit = normalizeConcurrentSessionLimit(keyLimit);
  if (normalizedKeyLimit > 0) {
    return normalizedKeyLimit;
  }

  return normalizeConcurrentSessionLimit(userLimit);
}
