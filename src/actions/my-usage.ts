"use server";

import { fromZonedTime } from "date-fns-tz";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys as keysTable, messageRequest } from "@/drizzle/schema";
import { getSession } from "@/lib/auth";
import { getEnvConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { RateLimitService } from "@/lib/rate-limit/service";
import type { DailyResetMode } from "@/lib/rate-limit/time-utils";
import { SessionTracker } from "@/lib/session-tracker";
import type { CurrencyCode } from "@/lib/utils";
import { EXCLUDE_WARMUP_CONDITION } from "@/repository/_shared/message-request-conditions";
import { getSystemSettings } from "@/repository/system-config";
import {
  findUsageLogsStats,
  findUsageLogsWithDetails,
  getDistinctEndpointsForKey,
  getDistinctModelsForKey,
  getTotalUsageForKey,
  type UsageLogFilters,
  type UsageLogSummary,
} from "@/repository/usage-logs";
import type { BillingModelSource } from "@/types/system-config";
import type { ActionResult } from "./types";

/**
 * Parse date range strings to timestamps using server timezone (TZ config).
 * Returns startTime as midnight and endTime as next day midnight (exclusive upper bound).
 */
function parseDateRangeInServerTimezone(
  startDate?: string,
  endDate?: string
): { startTime?: number; endTime?: number } {
  const timezone = getEnvConfig().TZ;

  const toIsoDate = (dateStr: string): { ok: true; value: string } | { ok: false } => {
    return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? { ok: true, value: dateStr } : { ok: false };
  };

  const addIsoDays = (dateStr: string, days: number): string => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!match) {
      return dateStr;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    const next = new Date(Date.UTC(year, month - 1, day));
    next.setUTCDate(next.getUTCDate() + days);
    return next.toISOString().slice(0, 10);
  };

  const startIso = startDate ? toIsoDate(startDate) : { ok: false as const };
  const endIso = endDate ? toIsoDate(endDate) : { ok: false as const };

  const parsedStart = startIso.ok
    ? fromZonedTime(`${startIso.value}T00:00:00`, timezone).getTime()
    : Number.NaN;

  const endExclusiveDate = endIso.ok ? addIsoDays(endIso.value, 1) : null;
  const parsedEndExclusive = endExclusiveDate
    ? fromZonedTime(`${endExclusiveDate}T00:00:00`, timezone).getTime()
    : Number.NaN;

  return {
    startTime: Number.isFinite(parsedStart) ? parsedStart : undefined,
    endTime: Number.isFinite(parsedEndExclusive) ? parsedEndExclusive : undefined,
  };
}

export interface MyUsageMetadata {
  keyName: string;
  keyProviderGroup: string | null;
  keyExpiresAt: Date | null;
  keyIsEnabled: boolean;
  userName: string;
  userProviderGroup: string | null;
  userExpiresAt: Date | null;
  userIsEnabled: boolean;
  dailyResetMode: "fixed" | "rolling";
  dailyResetTime: string;
  currencyCode: CurrencyCode;
}

export interface MyUsageQuota {
  keyLimit5hUsd: number | null;
  keyLimitDailyUsd: number | null;
  keyLimitWeeklyUsd: number | null;
  keyLimitMonthlyUsd: number | null;
  keyLimitTotalUsd: number | null;
  keyLimitConcurrentSessions: number | null;
  keyCurrent5hUsd: number;
  keyCurrentDailyUsd: number;
  keyCurrentWeeklyUsd: number;
  keyCurrentMonthlyUsd: number;
  keyCurrentTotalUsd: number;
  keyCurrentConcurrentSessions: number;

  userLimit5hUsd: number | null;
  userLimitWeeklyUsd: number | null;
  userLimitMonthlyUsd: number | null;
  userLimitTotalUsd: number | null;
  userLimitConcurrentSessions: number | null;
  userRpmLimit: number | null;
  userCurrent5hUsd: number;
  userCurrentDailyUsd: number;
  userCurrentWeeklyUsd: number;
  userCurrentMonthlyUsd: number;
  userCurrentTotalUsd: number;
  userCurrentConcurrentSessions: number;

  userLimitDailyUsd: number | null;
  userExpiresAt: Date | null;
  userProviderGroup: string | null;
  userName: string;
  userIsEnabled: boolean;

  keyProviderGroup: string | null;
  keyName: string;
  keyIsEnabled: boolean;

  userAllowedModels: string[];
  userAllowedClients: string[];

  expiresAt: Date | null;
  dailyResetMode: "fixed" | "rolling";
  dailyResetTime: string;
}

export interface MyTodayStats {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  modelBreakdown: Array<{
    model: string | null;
    billingModel: string | null;
    calls: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  currencyCode: CurrencyCode;
  billingModelSource: BillingModelSource;
}

export interface MyUsageLogEntry {
  id: number;
  createdAt: Date | null;
  model: string | null;
  billingModel: string | null;
  modelRedirect: string | null;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  statusCode: number | null;
  duration: number | null;
  endpoint: string | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreation5mInputTokens: number | null;
  cacheCreation1hInputTokens: number | null;
  cacheTtlApplied: string | null;
}

export interface MyUsageLogsResult {
  logs: MyUsageLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  currencyCode: CurrencyCode;
  billingModelSource: BillingModelSource;
}

/**
 * 查询用户在指定周期内的消费
 * 使用与 Key 层级和限额检查相同的时间范围计算逻辑
 *
 * @deprecated 此函数已被重构为使用统一的时间范围计算逻辑
 */
async function sumUserCost(userId: number, period: "5h" | "weekly" | "monthly" | "total") {
  // 动态导入避免循环依赖
  const { sumUserCostInTimeRange, sumUserTotalCost } = await import("@/repository/statistics");
  const { getTimeRangeForPeriod } = await import("@/lib/rate-limit/time-utils");

  // 总消费：使用专用函数
  if (period === "total") {
    return await sumUserTotalCost(userId);
  }

  // 其他周期：使用统一的时间范围计算
  const { startTime, endTime } = getTimeRangeForPeriod(period);
  return await sumUserCostInTimeRange(userId, startTime, endTime);
}

export async function getMyUsageMetadata(): Promise<ActionResult<MyUsageMetadata>> {
  try {
    const session = await getSession({ allowReadOnlyAccess: true });
    if (!session) return { ok: false, error: "Unauthorized" };

    const settings = await getSystemSettings();
    const key = session.key;
    const user = session.user;

    const metadata: MyUsageMetadata = {
      keyName: key.name,
      keyProviderGroup: key.providerGroup ?? null,
      keyExpiresAt: key.expiresAt ?? null,
      keyIsEnabled: key.isEnabled ?? true,
      userName: user.name,
      userProviderGroup: user.providerGroup ?? null,
      userExpiresAt: user.expiresAt ?? null,
      userIsEnabled: user.isEnabled ?? true,
      dailyResetMode: key.dailyResetMode ?? "fixed",
      dailyResetTime: key.dailyResetTime ?? "00:00",
      currencyCode: settings.currencyDisplay,
    };

    return { ok: true, data: metadata };
  } catch (error) {
    logger.error("[my-usage] getMyUsageMetadata failed", error);
    return { ok: false, error: "Failed to get metadata" };
  }
}

export async function getMyQuota(): Promise<ActionResult<MyUsageQuota>> {
  try {
    const session = await getSession({ allowReadOnlyAccess: true });
    if (!session) return { ok: false, error: "Unauthorized" };

    const key = session.key;
    const user = session.user;

    // 获取用户每日消费时使用用户的 dailyResetTime 和 dailyResetMode 配置
    // 导入时间工具函数
    const { getTimeRangeForPeriodWithMode } = await import("@/lib/rate-limit/time-utils");
    const { sumUserCostInTimeRange } = await import("@/repository/statistics");

    // 计算用户每日消费的时间范围(使用用户的配置)
    const userDailyTimeRange = getTimeRangeForPeriodWithMode(
      "daily",
      user.dailyResetTime ?? "00:00",
      (user.dailyResetMode as DailyResetMode | undefined) ?? "fixed"
    );

    const [
      keyCost5h,
      keyCostDaily,
      keyCostWeekly,
      keyCostMonthly,
      keyTotalCost,
      keyConcurrent,
      userCost5h,
      userCostDaily,
      userCostWeekly,
      userCostMonthly,
      userTotalCost,
      userKeyConcurrent,
    ] = await Promise.all([
      RateLimitService.getCurrentCost(key.id, "key", "5h"),
      RateLimitService.getCurrentCost(
        key.id,
        "key",
        "daily",
        key.dailyResetTime,
        key.dailyResetMode ?? "fixed"
      ),
      RateLimitService.getCurrentCost(key.id, "key", "weekly"),
      RateLimitService.getCurrentCost(key.id, "key", "monthly"),
      getTotalUsageForKey(key.key),
      SessionTracker.getKeySessionCount(key.id),
      sumUserCost(user.id, "5h"),
      // 修复: 使用与 Key 层级相同的时间范围逻辑来计算用户每日消费
      sumUserCostInTimeRange(user.id, userDailyTimeRange.startTime, userDailyTimeRange.endTime),
      sumUserCost(user.id, "weekly"),
      sumUserCost(user.id, "monthly"),
      sumUserCost(user.id, "total"),
      getUserConcurrentSessions(user.id),
    ]);

    const quota: MyUsageQuota = {
      keyLimit5hUsd: key.limit5hUsd ?? null,
      keyLimitDailyUsd: key.limitDailyUsd ?? null,
      keyLimitWeeklyUsd: key.limitWeeklyUsd ?? null,
      keyLimitMonthlyUsd: key.limitMonthlyUsd ?? null,
      keyLimitTotalUsd: key.limitTotalUsd ?? null,
      keyLimitConcurrentSessions: key.limitConcurrentSessions ?? null,
      keyCurrent5hUsd: keyCost5h,
      keyCurrentDailyUsd: keyCostDaily,
      keyCurrentWeeklyUsd: keyCostWeekly,
      keyCurrentMonthlyUsd: keyCostMonthly,
      keyCurrentTotalUsd: keyTotalCost,
      keyCurrentConcurrentSessions: keyConcurrent,

      userLimit5hUsd: user.limit5hUsd ?? null,
      userLimitWeeklyUsd: user.limitWeeklyUsd ?? null,
      userLimitMonthlyUsd: user.limitMonthlyUsd ?? null,
      userLimitTotalUsd: user.limitTotalUsd ?? null,
      userLimitConcurrentSessions: user.limitConcurrentSessions ?? null,
      userRpmLimit: user.rpm ?? null,
      userCurrent5hUsd: userCost5h,
      userCurrentDailyUsd: userCostDaily,
      userCurrentWeeklyUsd: userCostWeekly,
      userCurrentMonthlyUsd: userCostMonthly,
      userCurrentTotalUsd: userTotalCost,
      userCurrentConcurrentSessions: userKeyConcurrent,

      userLimitDailyUsd: user.dailyQuota ?? null,
      userExpiresAt: user.expiresAt ?? null,
      userProviderGroup: user.providerGroup ?? null,
      userName: user.name,
      userIsEnabled: user.isEnabled ?? true,

      keyProviderGroup: key.providerGroup ?? null,
      keyName: key.name,
      keyIsEnabled: key.isEnabled ?? true,

      userAllowedModels: user.allowedModels ?? [],
      userAllowedClients: user.allowedClients ?? [],

      expiresAt: key.expiresAt ?? null,
      dailyResetMode: key.dailyResetMode ?? "fixed",
      dailyResetTime: key.dailyResetTime ?? "00:00",
    };

    return { ok: true, data: quota };
  } catch (error) {
    logger.error("[my-usage] getMyQuota failed", error);
    return { ok: false, error: "Failed to get quota information" };
  }
}

export async function getMyTodayStats(): Promise<ActionResult<MyTodayStats>> {
  try {
    const session = await getSession({ allowReadOnlyAccess: true });
    if (!session) return { ok: false, error: "Unauthorized" };

    const settings = await getSystemSettings();
    const billingModelSource = settings.billingModelSource;
    const currencyCode = settings.currencyDisplay;

    // 修复: 使用 Key 的 dailyResetTime 和 dailyResetMode 来计算时间范围
    const { getTimeRangeForPeriodWithMode } = await import("@/lib/rate-limit/time-utils");
    const timeRange = getTimeRangeForPeriodWithMode(
      "daily",
      session.key.dailyResetTime ?? "00:00",
      (session.key.dailyResetMode as DailyResetMode | undefined) ?? "fixed"
    );

    const [aggregate] = await db
      .select({
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`COALESCE(sum(${messageRequest.inputTokens}), 0)::int`,
        outputTokens: sql<number>`COALESCE(sum(${messageRequest.outputTokens}), 0)::int`,
        costUsd: sql<string>`COALESCE(sum(${messageRequest.costUsd}), 0)`,
      })
      .from(messageRequest)
      .where(
        and(
          eq(messageRequest.key, session.key.key),
          isNull(messageRequest.deletedAt),
          EXCLUDE_WARMUP_CONDITION,
          gte(messageRequest.createdAt, timeRange.startTime),
          lt(messageRequest.createdAt, timeRange.endTime)
        )
      );

    const breakdown = await db
      .select({
        model: messageRequest.model,
        originalModel: messageRequest.originalModel,
        calls: sql<number>`count(*)::int`,
        costUsd: sql<string>`COALESCE(sum(${messageRequest.costUsd}), 0)`,
        inputTokens: sql<number>`COALESCE(sum(${messageRequest.inputTokens}), 0)::int`,
        outputTokens: sql<number>`COALESCE(sum(${messageRequest.outputTokens}), 0)::int`,
      })
      .from(messageRequest)
      .where(
        and(
          eq(messageRequest.key, session.key.key),
          isNull(messageRequest.deletedAt),
          EXCLUDE_WARMUP_CONDITION,
          gte(messageRequest.createdAt, timeRange.startTime),
          lt(messageRequest.createdAt, timeRange.endTime)
        )
      )
      .groupBy(messageRequest.model, messageRequest.originalModel);

    const modelBreakdown = breakdown.map((row) => {
      const billingModel = billingModelSource === "original" ? row.originalModel : row.model;
      return {
        model: row.model,
        billingModel,
        calls: row.calls,
        costUsd: Number(row.costUsd ?? 0),
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
      };
    });

    const stats: MyTodayStats = {
      calls: aggregate?.calls ?? 0,
      inputTokens: aggregate?.inputTokens ?? 0,
      outputTokens: aggregate?.outputTokens ?? 0,
      costUsd: Number(aggregate?.costUsd ?? 0),
      modelBreakdown,
      currencyCode,
      billingModelSource,
    };

    return { ok: true, data: stats };
  } catch (error) {
    logger.error("[my-usage] getMyTodayStats failed", error);
    return { ok: false, error: "Failed to get today's usage" };
  }
}

export interface MyUsageLogsFilters {
  startDate?: string;
  endDate?: string;
  model?: string;
  statusCode?: number;
  excludeStatusCode200?: boolean;
  endpoint?: string;
  minRetryCount?: number;
  page?: number;
  pageSize?: number;
}

export async function getMyUsageLogs(
  filters: MyUsageLogsFilters = {}
): Promise<ActionResult<MyUsageLogsResult>> {
  try {
    const session = await getSession({ allowReadOnlyAccess: true });
    if (!session) return { ok: false, error: "Unauthorized" };

    const settings = await getSystemSettings();

    const rawPageSize = filters.pageSize && filters.pageSize > 0 ? filters.pageSize : 20;
    const pageSize = Math.min(rawPageSize, 100);
    const page = filters.page && filters.page > 0 ? filters.page : 1;

    const { startTime, endTime } = parseDateRangeInServerTimezone(
      filters.startDate,
      filters.endDate
    );

    const usageFilters: UsageLogFilters = {
      keyId: session.key.id,
      startTime,
      endTime,
      model: filters.model,
      statusCode: filters.statusCode,
      excludeStatusCode200: filters.excludeStatusCode200,
      endpoint: filters.endpoint,
      minRetryCount: filters.minRetryCount,
      page,
      pageSize,
    };

    const result = await findUsageLogsWithDetails(usageFilters);

    const logs: MyUsageLogEntry[] = result.logs.map((log) => {
      const modelRedirect =
        log.originalModel && log.model && log.originalModel !== log.model
          ? `${log.originalModel} → ${log.model}`
          : null;

      const billingModel =
        (settings.billingModelSource === "original" ? log.originalModel : log.model) ?? null;

      return {
        id: log.id,
        createdAt: log.createdAt,
        model: log.model,
        billingModel,
        modelRedirect,
        inputTokens: log.inputTokens ?? 0,
        outputTokens: log.outputTokens ?? 0,
        cost: log.costUsd ? Number(log.costUsd) : 0,
        statusCode: log.statusCode,
        duration: log.durationMs,
        endpoint: log.endpoint,
        cacheCreationInputTokens: log.cacheCreationInputTokens ?? null,
        cacheReadInputTokens: log.cacheReadInputTokens ?? null,
        cacheCreation5mInputTokens: log.cacheCreation5mInputTokens ?? null,
        cacheCreation1hInputTokens: log.cacheCreation1hInputTokens ?? null,
        cacheTtlApplied: log.cacheTtlApplied ?? null,
      };
    });

    return {
      ok: true,
      data: {
        logs,
        total: result.total,
        page,
        pageSize,
        currencyCode: settings.currencyDisplay,
        billingModelSource: settings.billingModelSource,
      },
    };
  } catch (error) {
    logger.error("[my-usage] getMyUsageLogs failed", error);
    return { ok: false, error: "Failed to get usage logs" };
  }
}

export async function getMyAvailableModels(): Promise<ActionResult<string[]>> {
  try {
    const session = await getSession({ allowReadOnlyAccess: true });
    if (!session) return { ok: false, error: "Unauthorized" };

    const models = await getDistinctModelsForKey(session.key.key);
    return { ok: true, data: models };
  } catch (error) {
    logger.error("[my-usage] getMyAvailableModels failed", error);
    return { ok: false, error: "Failed to get model list" };
  }
}

export async function getMyAvailableEndpoints(): Promise<ActionResult<string[]>> {
  try {
    const session = await getSession({ allowReadOnlyAccess: true });
    if (!session) return { ok: false, error: "Unauthorized" };

    const endpoints = await getDistinctEndpointsForKey(session.key.key);
    return { ok: true, data: endpoints };
  } catch (error) {
    logger.error("[my-usage] getMyAvailableEndpoints failed", error);
    return { ok: false, error: "Failed to get endpoint list" };
  }
}

async function getUserConcurrentSessions(userId: number): Promise<number> {
  try {
    const keys = await db
      .select({ id: keysTable.id })
      .from(keysTable)
      .where(and(eq(keysTable.userId, userId), isNull(keysTable.deletedAt)));

    const counts = await Promise.all(keys.map((k) => SessionTracker.getKeySessionCount(k.id)));
    return counts.reduce((sum, value) => sum + value, 0);
  } catch (error) {
    logger.error("[my-usage] getUserConcurrentSessions failed", error);
    return 0;
  }
}

export interface MyStatsSummaryFilters {
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
}

export interface ModelBreakdownItem {
  model: string | null;
  requests: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface MyStatsSummary extends UsageLogSummary {
  keyModelBreakdown: ModelBreakdownItem[];
  userModelBreakdown: ModelBreakdownItem[];
  currencyCode: CurrencyCode;
}

/**
 * Get aggregated statistics for a date range
 * Uses findUsageLogsStats for efficient aggregation
 */
export async function getMyStatsSummary(
  filters: MyStatsSummaryFilters = {}
): Promise<ActionResult<MyStatsSummary>> {
  try {
    const session = await getSession({ allowReadOnlyAccess: true });
    if (!session) return { ok: false, error: "Unauthorized" };

    const settings = await getSystemSettings();
    const currencyCode = settings.currencyDisplay;

    const { startTime, endTime } = parseDateRangeInServerTimezone(
      filters.startDate,
      filters.endDate
    );

    // Get aggregated stats using existing repository function
    const stats = await findUsageLogsStats({
      keyId: session.key.id,
      startTime,
      endTime,
    });

    // Get model breakdown for current key
    const keyBreakdown = await db
      .select({
        model: messageRequest.model,
        requests: sql<number>`count(*)::int`,
        cost: sql<string>`COALESCE(sum(${messageRequest.costUsd}), 0)`,
        inputTokens: sql<number>`COALESCE(sum(${messageRequest.inputTokens}), 0)::int`,
        outputTokens: sql<number>`COALESCE(sum(${messageRequest.outputTokens}), 0)::int`,
        cacheCreationTokens: sql<number>`COALESCE(sum(${messageRequest.cacheCreationInputTokens}), 0)::int`,
        cacheReadTokens: sql<number>`COALESCE(sum(${messageRequest.cacheReadInputTokens}), 0)::int`,
      })
      .from(messageRequest)
      .where(
        and(
          eq(messageRequest.key, session.key.key),
          isNull(messageRequest.deletedAt),
          EXCLUDE_WARMUP_CONDITION,
          startTime ? gte(messageRequest.createdAt, new Date(startTime)) : undefined,
          endTime ? lt(messageRequest.createdAt, new Date(endTime)) : undefined
        )
      )
      .groupBy(messageRequest.model)
      .orderBy(sql`sum(${messageRequest.costUsd}) DESC`);

    // Get model breakdown for user (all keys)
    const userBreakdown = await db
      .select({
        model: messageRequest.model,
        requests: sql<number>`count(*)::int`,
        cost: sql<string>`COALESCE(sum(${messageRequest.costUsd}), 0)`,
        inputTokens: sql<number>`COALESCE(sum(${messageRequest.inputTokens}), 0)::int`,
        outputTokens: sql<number>`COALESCE(sum(${messageRequest.outputTokens}), 0)::int`,
        cacheCreationTokens: sql<number>`COALESCE(sum(${messageRequest.cacheCreationInputTokens}), 0)::int`,
        cacheReadTokens: sql<number>`COALESCE(sum(${messageRequest.cacheReadInputTokens}), 0)::int`,
      })
      .from(messageRequest)
      .where(
        and(
          eq(messageRequest.userId, session.user.id),
          isNull(messageRequest.deletedAt),
          EXCLUDE_WARMUP_CONDITION,
          startTime ? gte(messageRequest.createdAt, new Date(startTime)) : undefined,
          endTime ? lt(messageRequest.createdAt, new Date(endTime)) : undefined
        )
      )
      .groupBy(messageRequest.model)
      .orderBy(sql`sum(${messageRequest.costUsd}) DESC`);

    const result: MyStatsSummary = {
      ...stats,
      keyModelBreakdown: keyBreakdown.map((row) => ({
        model: row.model,
        requests: row.requests,
        cost: Number(row.cost ?? 0),
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheCreationTokens: row.cacheCreationTokens,
        cacheReadTokens: row.cacheReadTokens,
      })),
      userModelBreakdown: userBreakdown.map((row) => ({
        model: row.model,
        requests: row.requests,
        cost: Number(row.cost ?? 0),
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheCreationTokens: row.cacheCreationTokens,
        cacheReadTokens: row.cacheReadTokens,
      })),
      currencyCode,
    };

    return { ok: true, data: result };
  } catch (error) {
    logger.error("[my-usage] getMyStatsSummary failed", error);
    return { ok: false, error: "Failed to get statistics summary" };
  }
}
