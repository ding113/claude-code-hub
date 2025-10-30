/**
 * Repository 层金额计算工具
 * 根据隐私过滤上下文条件化计算显示金额
 */

import { sql } from "drizzle-orm";
import type { PrivacyFilterContext } from "@/lib/utils/privacy-filter";
import { messageRequest } from "@/drizzle/schema";

/**
 * 构建条件化的金额计算表达式
 *
 * 逻辑：
 * - 管理员或不忽略倍率：返回 cost_usd * cost_multiplier（实际金额）
 * - 非管理员且忽略倍率：返回 cost_usd（倍率=1的金额）
 *
 * @param context 隐私过滤上下文
 * @param costUsdColumn 成本字段（默认使用 messageRequest.costUsd）
 * @param multiplierColumn 倍率字段（默认使用 messageRequest.costMultiplier）
 */
export function buildCostExpression(
  context: PrivacyFilterContext,
  costUsdColumn = messageRequest.costUsd,
  multiplierColumn = messageRequest.costMultiplier
) {
  // 管理员或不忽略倍率：返回实际金额（cost_usd * cost_multiplier）
  if (context.isAdmin || !context.ignoreMultiplier) {
    return sql<string>`CAST(${costUsdColumn} * COALESCE(${multiplierColumn}, 1.0) AS NUMERIC(10, 6))`;
  }

  // 非管理员且忽略倍率：返回原始成本（cost_usd）
  return sql<string>`CAST(${costUsdColumn} AS NUMERIC(10, 6))`;
}

/**
 * 构建聚合 SUM 的条件化金额计算表达式
 * 用于统计查询中的 SUM(cost) 场景
 */
export function buildSumCostExpression(
  context: PrivacyFilterContext,
  costUsdColumn = messageRequest.costUsd,
  multiplierColumn = messageRequest.costMultiplier
) {
  // 管理员或不忽略倍率：SUM(cost_usd * cost_multiplier)
  if (context.isAdmin || !context.ignoreMultiplier) {
    return sql<string>`SUM(${costUsdColumn} * COALESCE(${multiplierColumn}, 1.0))`;
  }

  // 非管理员且忽略倍率：SUM(cost_usd)
  return sql<string>`SUM(${costUsdColumn})`;
}

/**
 * 在 JavaScript 中计算显示金额（用于已查询出的数据）
 *
 * @param costUsd 原始成本
 * @param costMultiplier 成本倍率
 * @param context 隐私过滤上下文
 */
export function calculateDisplayCost(
  costUsd: number | string | null | undefined,
  costMultiplier: number | string | null | undefined,
  context: PrivacyFilterContext
): number {
  if (!costUsd) return 0;

  const cost = typeof costUsd === "string" ? parseFloat(costUsd) : costUsd;

  // 管理员或不忽略倍率：返回实际金额
  if (context.isAdmin || !context.ignoreMultiplier) {
    const multiplier = costMultiplier
      ? typeof costMultiplier === "string"
        ? parseFloat(costMultiplier)
        : costMultiplier
      : 1.0;
    return cost * multiplier;
  }

  // 非管理员且忽略倍率：返回原始成本
  return cost;
}
