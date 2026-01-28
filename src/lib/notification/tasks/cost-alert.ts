import { sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys, providers } from "@/drizzle/schema";
import { logger } from "@/lib/logger";
import { getTimeRangeForPeriod } from "@/lib/rate-limit/time-utils";
import type { CostAlertData } from "@/lib/webhook";
import { sumKeyCostInTimeRange, sumProviderCostInTimeRange } from "@/repository/statistics";

/**
 * 生成成本预警数据
 * @param threshold 阈值 (0-1，例如 0.8 表示 80%)
 * @returns 成本预警数据数组（超过阈值的项）
 */
export async function generateCostAlerts(threshold: number): Promise<CostAlertData[]> {
  try {
    logger.info({
      action: "generate_cost_alerts",
      threshold,
    });

    const alerts: CostAlertData[] = [];

    // 检查用户级别的配额超额
    const userAlerts = await checkUserQuotas(threshold);
    alerts.push(...userAlerts);

    // 检查供应商级别的配额超额
    const providerAlerts = await checkProviderQuotas(threshold);
    alerts.push(...providerAlerts);

    logger.info({
      action: "cost_alerts_generated",
      count: alerts.length,
    });

    return alerts;
  } catch (error) {
    logger.error({
      action: "generate_cost_alerts_error",
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * 检查用户配额超额情况
 *
 * 使用统一的时间窗口计算函数 (getTimeRangeForPeriod) 和
 * 带 warmup/deleted 过滤的统计函数 (sumKeyCostInTimeRange)。
 *
 * 时间窗口语义:
 * - 5h: 滚动窗口（过去 5 小时）
 * - weekly: 自然周（本周一 00:00 开始，使用系统时区）
 * - monthly: 自然月（本月 1 号 00:00 开始，使用系统时区）
 */
async function checkUserQuotas(threshold: number): Promise<CostAlertData[]> {
  const alerts: CostAlertData[] = [];

  try {
    // 查询有配额限制的密钥
    const keysWithLimits = await db
      .select({
        id: keys.id,
        key: keys.key,
        userName: keys.name,

        // 限额配置
        limit5h: keys.limit5hUsd,
        limitWeek: keys.limitWeeklyUsd,
        limitMonth: keys.limitMonthlyUsd,
      })
      .from(keys)
      .where(
        sql`${keys.limit5hUsd} > 0 OR ${keys.limitWeeklyUsd} > 0 OR ${keys.limitMonthlyUsd} > 0`
      );

    // 预计算时间范围（所有 key 共享相同的时间窗口）
    const [range5h, rangeWeekly, rangeMonthly] = await Promise.all([
      getTimeRangeForPeriod("5h"),
      getTimeRangeForPeriod("weekly"),
      getTimeRangeForPeriod("monthly"),
    ]);

    for (const keyData of keysWithLimits) {
      // 检查 5 小时额度
      if (keyData.limit5h) {
        const limit5h = parseFloat(keyData.limit5h);
        if (limit5h > 0) {
          // 使用 keyId 和标准统计函数（包含 warmup/deleted 过滤）
          const cost5h = await sumKeyCostInTimeRange(
            keyData.id,
            range5h.startTime,
            range5h.endTime
          );
          if (cost5h >= limit5h * threshold) {
            alerts.push({
              targetType: "user",
              targetName: keyData.userName,
              targetId: keyData.id,
              currentCost: cost5h,
              quotaLimit: limit5h,
              threshold,
              period: "5小时",
            });
          }
        }
      }

      // 检查本周额度（自然周：从周一开始）
      if (keyData.limitWeek) {
        const limitWeek = parseFloat(keyData.limitWeek);
        if (limitWeek > 0) {
          const costWeek = await sumKeyCostInTimeRange(
            keyData.id,
            rangeWeekly.startTime,
            rangeWeekly.endTime
          );
          if (costWeek >= limitWeek * threshold) {
            alerts.push({
              targetType: "user",
              targetName: keyData.userName,
              targetId: keyData.id,
              currentCost: costWeek,
              quotaLimit: limitWeek,
              threshold,
              period: "本周",
            });
          }
        }
      }

      // 检查本月额度（自然月：从 1 号开始）
      if (keyData.limitMonth) {
        const limitMonth = parseFloat(keyData.limitMonth);
        if (limitMonth > 0) {
          const costMonth = await sumKeyCostInTimeRange(
            keyData.id,
            rangeMonthly.startTime,
            rangeMonthly.endTime
          );
          if (costMonth >= limitMonth * threshold) {
            alerts.push({
              targetType: "user",
              targetName: keyData.userName,
              targetId: keyData.id,
              currentCost: costMonth,
              quotaLimit: limitMonth,
              threshold,
              period: "本月",
            });
          }
        }
      }
    }
  } catch (error) {
    logger.error({
      action: "check_user_quotas_error",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return alerts;
}

/**
 * 检查供应商配额超额情况
 *
 * 使用统一的时间窗口计算函数 (getTimeRangeForPeriod) 和
 * 带 warmup/deleted 过滤的统计函数 (sumProviderCostInTimeRange)。
 *
 * 时间窗口语义:
 * - weekly: 自然周（本周一 00:00 开始，使用系统时区）
 * - monthly: 自然月（本月 1 号 00:00 开始，使用系统时区）
 */
async function checkProviderQuotas(threshold: number): Promise<CostAlertData[]> {
  const alerts: CostAlertData[] = [];

  try {
    // 查询有配额限制的供应商
    const providersWithLimits = await db
      .select({
        id: providers.id,
        name: providers.name,

        // 限额配置
        limitWeek: providers.limitWeeklyUsd,
        limitMonth: providers.limitMonthlyUsd,
      })
      .from(providers)
      .where(sql`${providers.limitWeeklyUsd} > 0 OR ${providers.limitMonthlyUsd} > 0`);

    // 预计算时间范围（所有 provider 共享相同的时间窗口）
    const [rangeWeekly, rangeMonthly] = await Promise.all([
      getTimeRangeForPeriod("weekly"),
      getTimeRangeForPeriod("monthly"),
    ]);

    for (const provider of providersWithLimits) {
      // 检查本周额度（自然周：从周一开始）
      if (provider.limitWeek) {
        const limitWeek = parseFloat(provider.limitWeek);
        if (limitWeek > 0) {
          const costWeek = await sumProviderCostInTimeRange(
            provider.id,
            rangeWeekly.startTime,
            rangeWeekly.endTime
          );
          if (costWeek >= limitWeek * threshold) {
            alerts.push({
              targetType: "provider",
              targetName: provider.name,
              targetId: provider.id,
              currentCost: costWeek,
              quotaLimit: limitWeek,
              threshold,
              period: "本周",
            });
          }
        }
      }

      // 检查本月额度（自然月：从 1 号开始）
      if (provider.limitMonth) {
        const limitMonth = parseFloat(provider.limitMonth);
        if (limitMonth > 0) {
          const costMonth = await sumProviderCostInTimeRange(
            provider.id,
            rangeMonthly.startTime,
            rangeMonthly.endTime
          );
          if (costMonth >= limitMonth * threshold) {
            alerts.push({
              targetType: "provider",
              targetName: provider.name,
              targetId: provider.id,
              currentCost: costMonth,
              quotaLimit: limitMonth,
              threshold,
              period: "本月",
            });
          }
        }
      }
    }
  } catch (error) {
    logger.error({
      action: "check_provider_quotas_error",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return alerts;
}
