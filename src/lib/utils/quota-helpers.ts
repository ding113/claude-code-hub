/**
 * 限额管理工具函数
 *
 * 用于判断密钥和用户的限额状态
 */

// 类型定义
export type KeyQuota = {
  cost5h: { current: number; limit: number | null };
  costDaily: { current: number; limit: number | null };
  costWeekly: { current: number; limit: number | null };
  costMonthly: { current: number; limit: number | null };
  concurrentSessions: { current: number; limit: number };
} | null;

export type UserQuota = {
  rpm: { current: number; limit: number; window: "per_minute" };
  dailyCost: { current: number; limit: number; resetAt: Date };
} | null;

/**
 * 判断密钥是否设置了限额
 *
 * @param quota - 密钥限额数据
 * @returns 是否设置了任意限额（5h/周/月/并发）
 */
export function hasKeyQuotaSet(quota: KeyQuota): boolean {
  if (!quota) return false;

  return !!(
    quota.cost5h.limit ||
    quota.costDaily.limit ||
    quota.costWeekly.limit ||
    quota.costMonthly.limit ||
    (quota.concurrentSessions.limit && quota.concurrentSessions.limit > 0)
  );
}

/**
 * 计算使用率（百分比）
 *
 * @param current - 当前使用量
 * @param limit - 限额
 * @returns 使用率（0-100+）
 */
export function getUsageRate(current: number, limit: number | null): number {
  if (!limit || limit <= 0) return 0;
  return (current / limit) * 100;
}

/**
 * 判断用户是否超限
 *
 * @param userQuota - 用户限额数据
 * @returns 是否超限（RPM 或每日消费）
 */
export function isUserExceeded(userQuota: UserQuota): boolean {
  if (!userQuota) return false;

  const rpmExceeded = userQuota.rpm.current >= userQuota.rpm.limit;
  const dailyExceeded = userQuota.dailyCost.current >= userQuota.dailyCost.limit;

  return rpmExceeded || dailyExceeded;
}

/**
 * 获取密钥限额的最高使用率
 *
 * @param quota - 密钥限额数据
 * @returns 最高使用率（0-100+）
 */
export function getMaxUsageRate(quota: KeyQuota): number {
  if (!quota) return 0;

  const rates: number[] = [];

  if (quota.cost5h.limit) {
    rates.push(getUsageRate(quota.cost5h.current, quota.cost5h.limit));
  }
  if (quota.costDaily.limit) {
    rates.push(getUsageRate(quota.costDaily.current, quota.costDaily.limit));
  }
  if (quota.costWeekly.limit) {
    rates.push(getUsageRate(quota.costWeekly.current, quota.costWeekly.limit));
  }
  if (quota.costMonthly.limit) {
    rates.push(getUsageRate(quota.costMonthly.current, quota.costMonthly.limit));
  }
  if (quota.concurrentSessions.limit > 0) {
    rates.push(getUsageRate(quota.concurrentSessions.current, quota.concurrentSessions.limit));
  }

  return rates.length > 0 ? Math.max(...rates) : 0;
}

/**
 * 判断用户是否预警（使用率 ≥60%）
 *
 * @param userQuota - 用户限额数据
 * @returns 是否预警
 */
export function isUserWarning(userQuota: UserQuota): boolean {
  if (!userQuota) return false;

  const rpmRate = getUsageRate(userQuota.rpm.current, userQuota.rpm.limit);
  const dailyRate = getUsageRate(userQuota.dailyCost.current, userQuota.dailyCost.limit);

  return rpmRate >= 60 || dailyRate >= 60;
}

/**
 * 判断密钥或其所属用户是否预警
 *
 * @param keyQuota - 密钥限额数据
 * @param userQuota - 用户限额数据
 * @returns 是否预警（任意维度 ≥60%）
 */
export function isWarning(keyQuota: KeyQuota, userQuota: UserQuota): boolean {
  // 检查用户限额
  if (isUserWarning(userQuota)) {
    return true;
  }

  // 检查密钥限额
  if (keyQuota && hasKeyQuotaSet(keyQuota)) {
    const maxRate = getMaxUsageRate(keyQuota);
    return maxRate >= 60 && maxRate < 100;
  }

  return false;
}

/**
 * 判断密钥或其所属用户是否超限
 *
 * @param keyQuota - 密钥限额数据
 * @param userQuota - 用户限额数据
 * @returns 是否超限（任意维度 ≥100%）
 */
export function isExceeded(keyQuota: KeyQuota, userQuota: UserQuota): boolean {
  // 检查用户限额
  if (isUserExceeded(userQuota)) {
    return true;
  }

  // 检查密钥限额
  if (keyQuota && hasKeyQuotaSet(keyQuota)) {
    const maxRate = getMaxUsageRate(keyQuota);
    return maxRate >= 100;
  }

  return false;
}

/**
 * 获取状态标签
 *
 * @param keyQuota - 密钥限额数据
 * @param userQuota - 用户限额数据
 * @returns 状态标签："正常" | "预警" | "超限"
 */
export function getQuotaStatus(keyQuota: KeyQuota, userQuota: UserQuota): "正常" | "预警" | "超限" {
  if (isExceeded(keyQuota, userQuota)) {
    return "超限";
  }
  if (isWarning(keyQuota, userQuota)) {
    return "预警";
  }
  return "正常";
}

/**
 * 获取状态颜色
 *
 * @param rate - 使用率（0-100+）
 * @returns 状态类型："normal" | "warning" | "danger" | "exceeded"
 */
export function getQuotaColorClass(rate: number): "normal" | "warning" | "danger" | "exceeded" {
  if (rate >= 100) return "exceeded";
  if (rate >= 80) return "danger";
  if (rate >= 60) return "warning";
  return "normal";
}
