/**
 * 隐私保护工具函数
 * 用于根据用户权限过滤供应商信息和调整金额显示
 */

import type { SystemSettings } from "@/types/system-config";
import type { CurrencyCode } from "@/lib/utils/currency";

export interface PrivacyFilterContext {
  isAdmin: boolean;
  allowViewProviderInfo: boolean;
  ignoreMultiplier: boolean; // 非管理员是否忽略供应商倍率
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
    ignoreMultiplier: settings.nonAdminIgnoreMultiplier,
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
 *
 * @deprecated 此函数已废弃，不应在新代码中使用。
 *
 * 在新架构下，Repository 层会根据 PrivacyFilterContext 直接返回正确的金额：
 * - 非管理员 + ignoreMultiplier=true: 返回 cost_usd（倍率=1）
 * - 其他情况: 返回 cost_usd * cost_multiplier（实际金额）
 *
 * 前端组件应直接使用后端返回的金额，无需再次调整。
 * 此函数仅用于向后兼容旧代码。
 *
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

  // 如果是管理员或不忽略倍率，返回原始成本（假设后端已处理）
  if (context.isAdmin || !context.ignoreMultiplier) {
    return cost;
  }

  // 非管理员且忽略倍率：尝试反向计算（这是不准确的兼容逻辑）
  // 在新架构下，后端应该直接返回 cost_usd，而不是 cost_usd * cost_multiplier
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
