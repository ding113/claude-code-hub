/**
 * 限额工具函数 - 用于判断无限额和格式化限额显示
 */

/**
 * 判断限额是否为"无限制"
 * null、undefined、0 或负数都视为无限制
 *
 * @param limit - 限额值
 * @returns 是否为无限制
 */
export function isUnlimited(limit: number | null | undefined): boolean {
  return limit == null || limit <= 0;
}

/**
 * 格式化限额显示值
 *
 * @param limit - 限额值
 * @param formatter - 格式化函数（如货币格式化）
 * @param unlimitedText - 无限制时显示的文本
 * @returns 格式化后的显示文本
 */
export function formatLimit(
  limit: number | null | undefined,
  formatter: (value: number) => string,
  unlimitedText: string
): string {
  if (isUnlimited(limit)) return unlimitedText;
  return formatter(limit as number);
}

/**
 * 计算使用率百分比
 * 无限制时返回 null，结果限制在 0-100 范围内
 *
 * @param current - 当前使用量
 * @param limit - 限额值
 * @returns 使用率（0-100），无限额时返回 null
 */
export function calculateUsagePercent(
  current: number,
  limit: number | null | undefined
): number | null {
  if (isUnlimited(limit)) return null;
  const rate = (current / (limit as number)) * 100;
  // 处理 NaN 和负数边界情况
  if (!Number.isFinite(rate) || rate < 0) return 0;
  return Math.min(rate, 100);
}
