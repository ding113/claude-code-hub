/**
 * 隐私保护工具函数
 * 用于根据用户权限过滤供应商信息和调整金额显示
 */

import type { SystemSettings } from "@/types/system-config";
import type { CurrencyCode } from "@/lib/utils/currency";

export interface PrivacyFilterContext {
  isAdmin: boolean;
  allowViewProviderInfo: boolean;
  userCurrency: CurrencyCode;
}

/**
 * 创建隐私过滤上下文
 */
export function createPrivacyContext(
  isAdmin: boolean,
  settings: SystemSettings
): PrivacyFilterContext {
  return {
    isAdmin,
    allowViewProviderInfo: settings.allowViewProviderInfo,
    userCurrency: isAdmin ? settings.currencyDisplay : settings.nonAdminCurrencyDisplay,
  };
}

/**
 * 判断是否允许查看供应商信息
 */
export function canViewProviderInfo(context: PrivacyFilterContext): boolean {
  return context.isAdmin || context.allowViewProviderInfo;
}

/**
 * 获取用户应该看到的货币代码
 */
export function getUserCurrency(context: PrivacyFilterContext): CurrencyCode {
  return context.userCurrency;
}

/**
 * 过滤供应商名称（如果不允许查看则返回 "***"）
 */
export function filterProviderName(
  providerName: string | null | undefined,
  context: PrivacyFilterContext
): string {
  if (!providerName) return "-";
  if (canViewProviderInfo(context)) return providerName;
  return "***";
}

/**
 * 过滤成本倍率（如果不允许查看则返回 null）
 * @returns 倍率值或 null（null 表示不显示倍率）
 */
export function filterCostMultiplier(
  costMultiplier: string | number | null | undefined,
  context: PrivacyFilterContext
): number | null {
  if (!costMultiplier) return null;
  if (canViewProviderInfo(context)) {
    return typeof costMultiplier === "string" ? parseFloat(costMultiplier) : costMultiplier;
  }
  return null;
}

/**
 * 调整金额计算（如果不允许查看供应商信息，则忽略倍率）
 * @param costUsd 原始成本（USD）
 * @param costMultiplier 成本倍率
 * @param context 隐私过滤上下文
 * @returns 调整后的成本
 */
export function adjustCost(
  costUsd: number | string | null | undefined,
  costMultiplier: number | string | null | undefined,
  context: PrivacyFilterContext
): number {
  if (!costUsd) return 0;

  const cost = typeof costUsd === "string" ? parseFloat(costUsd) : costUsd;

  // 如果允许查看供应商信息，返回原始成本
  if (canViewProviderInfo(context)) {
    return cost;
  }

  // 如果不允许查看，需要反向计算出倍率为 1.0 时的成本
  if (costMultiplier) {
    const multiplier =
      typeof costMultiplier === "string" ? parseFloat(costMultiplier) : costMultiplier;
    if (multiplier > 0) {
      return cost / multiplier;
    }
  }

  return cost;
}

/**
 * 过滤供应商决策链
 */
export function filterProviderChain(
  chain: Array<{ id: number; name: string }> | null | undefined,
  context: PrivacyFilterContext
): Array<{ id: number; name: string }> | null {
  if (!chain || chain.length === 0) return null;
  if (canViewProviderInfo(context)) return chain;

  // 隐藏供应商名称
  return chain.map((item) => ({
    id: item.id,
    name: "***",
  }));
}
