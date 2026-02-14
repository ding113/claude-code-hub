"use server";

import { fromZonedTime } from "date-fns-tz";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { messageRequest } from "@/drizzle/schema";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { resolveKeyConcurrentSessionLimit } from "@/lib/rate-limit/concurrent-session-limit";
import type { DailyResetMode } from "@/lib/rate-limit/time-utils";
import { SessionTracker } from "@/lib/session-tracker";
import type { CurrencyCode } from "@/lib/utils";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import { EXCLUDE_WARMUP_CONDITION } from "@/repository/_shared/message-request-conditions";
import { getSystemSettings } from "@/repository/system-config";
import {
  findUsageLogsForKeySlim,
  getDistinctEndpointsForKey,
  getDistinctModelsForKey,
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
  endDate?: string,
  timezone?: string
): { startTime?: number; endTime?: number } {
  const tz = timezone ?? "UTC";

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
    ? fromZonedTime(`${startIso.value}T00:00:00`, tz).getTime()
    : Number.NaN;

  const endExclusiveDate = endIso.ok ? addIsoDays(endIso.value, 1) : null;
  const parsedEndExclusive = endExclusiveDate
    ? fromZonedTime(`${endExclusiveDate}T00:00:00`, tz).getTime()
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
  keyLimitConcurrentSessions: number;
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

// Infinity means "all time" - no date filter applied to the query
const ALL_TIME_MAX_AGE_DAYS = Infinity;

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

    // 导入时间工具函数和统计函数
    const { getTimeRangeForPeriodWithMode, getTimeRangeForPeriod } = await import(
      "@/lib/rate-limit/time-utils"
    );
    const { sumKeyQuotaCostsById, sumUserQuotaCosts } = await import("@/repository/statistics");

    // 计算各周期的时间范围
    // Key 使用 Key 的 dailyResetTime/dailyResetMode 配置
    const keyDailyTimeRange = await getTimeRangeForPeriodWithMode(
      "daily",
      key.dailyResetTime ?? "00:00",
      (key.dailyResetMode as DailyResetMode | undefined) ?? "fixed"
    );

    // User 使用 User 的 dailyResetTime/dailyResetMode 配置
    const userDailyTimeRange = await getTimeRangeForPeriodWithMode(
      "daily",
      user.dailyResetTime ?? "00:00",
      (user.dailyResetMode as DailyResetMode | undefined) ?? "fixed"
    );

    // 5h/weekly/monthly 使用统一时间范围
    const range5h = await getTimeRangeForPeriod("5h");
    const rangeWeekly = await getTimeRangeForPeriod("weekly");
    const rangeMonthly = await getTimeRangeForPeriod("monthly");

    const effectiveKeyConcurrentLimit = resolveKeyConcurrentSessionLimit(
      key.limitConcurrentSessions ?? 0,
      user.limitConcurrentSessions ?? null
    );

    const [keyCosts, keyConcurrent, userCosts, userKeyConcurrent] = await Promise.all([
      // Key 配额：直接查 DB（与 User 保持一致，解决数据源不一致问题）
      sumKeyQuotaCostsById(
        key.id,
        {
          range5h,
          rangeDaily: keyDailyTimeRange,
          rangeWeekly,
          rangeMonthly,
        },
        ALL_TIME_MAX_AGE_DAYS
      ),
      SessionTracker.getKeySessionCount(key.id),
      // User 配额：直接查 DB
      sumUserQuotaCosts(
        user.id,
        {
          range5h,
          rangeDaily: userDailyTimeRange,
          rangeWeekly,
          rangeMonthly,
        },
        ALL_TIME_MAX_AGE_DAYS
      ),
      getUserConcurrentSessions(user.id),
    ]);

    const {
      cost5h: keyCost5h,
      costDaily: keyCostDaily,
      costWeekly: keyCostWeekly,
      costMonthly: keyCostMonthly,
      costTotal: keyTotalCost,
    } = keyCosts;
    const {
      cost5h: userCost5h,
      costDaily: userCostDaily,
      costWeekly: userCostWeekly,
      costMonthly: userCostMonthly,
      costTotal: userTotalCost,
    } = userCosts;

    const quota: MyUsageQuota = {
      keyLimit5hUsd: key.limit5hUsd ?? null,
      keyLimitDailyUsd: key.limitDailyUsd ?? null,
      keyLimitWeeklyUsd: key.limitWeeklyUsd ?? null,
      keyLimitMonthlyUsd: key.limitMonthlyUsd ?? null,
      keyLimitTotalUsd: key.limitTotalUsd ?? null,
      keyLimitConcurrentSessions: effectiveKeyConcurrentLimit,
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
    const timeRange = await getTimeRangeForPeriodWithMode(
      "daily",
      session.key.dailyResetTime ?? "00:00",
      (session.key.dailyResetMode as DailyResetMode | undefined) ?? "fixed"
    );

    const breakdown = await db
      .select({
        model: messageRequest.model,
        originalModel: messageRequest.originalModel,
        calls: sql<number>`count(*)::int`,
        costUsd: sql<string>`COALESCE(sum(${messageRequest.costUsd}), 0)`,
        inputTokens: sql<number>`COALESCE(sum(${messageRequest.inputTokens}), 0)::double precision`,
        outputTokens: sql<number>`COALESCE(sum(${messageRequest.outputTokens}), 0)::double precision`,
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

    let totalCalls = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCostUsd = 0;

    const modelBreakdown = breakdown.map((row) => {
      const billingModel = billingModelSource === "original" ? row.originalModel : row.model;
      const rawCostUsd = Number(row.costUsd ?? 0);
      const costUsd = Number.isFinite(rawCostUsd) ? rawCostUsd : 0;

      totalCalls += row.calls ?? 0;
      totalInputTokens += row.inputTokens ?? 0;
      totalOutputTokens += row.outputTokens ?? 0;
      totalCostUsd += costUsd;

      return {
        model: row.model,
        billingModel,
        calls: row.calls,
        costUsd,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
      };
    });

    const stats: MyTodayStats = {
      calls: totalCalls,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      costUsd: totalCostUsd,
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
  /** Session ID（精确匹配；空字符串/空白视为不筛选） */
  sessionId?: string;
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

    const timezone = await resolveSystemTimezone();
    const { startTime, endTime } = parseDateRangeInServerTimezone(
      filters.startDate,
      filters.endDate,
      timezone
    );
    const result = await findUsageLogsForKeySlim({
      keyString: session.key.key,
      sessionId: filters.sessionId,
      startTime,
      endTime,
      model: filters.model,
      statusCode: filters.statusCode,
      excludeStatusCode200: filters.excludeStatusCode200,
      endpoint: filters.endpoint,
      minRetryCount: filters.minRetryCount,
      page,
      pageSize,
    });

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
    // 直接使用 user 维度的活跃 session 集合，避免 keys × Redis 查询的 N+1
    return await SessionTracker.getUserSessionCount(userId);
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
 * 通过 model breakdown 聚合，避免额外的 summary 聚合查询
 */
export async function getMyStatsSummary(
  filters: MyStatsSummaryFilters = {}
): Promise<ActionResult<MyStatsSummary>> {
  try {
    const session = await getSession({ allowReadOnlyAccess: true });
    if (!session) return { ok: false, error: "Unauthorized" };

    const settings = await getSystemSettings();
    const currencyCode = settings.currencyDisplay;

    const timezone = await resolveSystemTimezone();
    const { startTime, endTime } = parseDateRangeInServerTimezone(
      filters.startDate,
      filters.endDate,
      timezone
    );

    const startDate = startTime ? new Date(startTime) : undefined;
    const endDate = endTime ? new Date(endTime) : undefined;

    const userId = session.user.id;
    const keyString = session.key.key;

    // Key 维度是 User 维度的子集：用一条聚合 SQL 扫描 userId 范围即可同时算出两套 breakdown。
    const modelBreakdown = await db
      .select({
        model: messageRequest.model,
        // User breakdown（跨所有 Key）
        userRequests: sql<number>`count(*)::int`,
        userCost: sql<string>`COALESCE(sum(${messageRequest.costUsd}), 0)`,
        userInputTokens: sql<number>`COALESCE(sum(${messageRequest.inputTokens}), 0)::double precision`,
        userOutputTokens: sql<number>`COALESCE(sum(${messageRequest.outputTokens}), 0)::double precision`,
        userCacheCreationTokens: sql<number>`COALESCE(sum(${messageRequest.cacheCreationInputTokens}), 0)::double precision`,
        userCacheReadTokens: sql<number>`COALESCE(sum(${messageRequest.cacheReadInputTokens}), 0)::double precision`,
        userCacheCreation5mTokens: sql<number>`COALESCE(sum(${messageRequest.cacheCreation5mInputTokens}), 0)::double precision`,
        userCacheCreation1hTokens: sql<number>`COALESCE(sum(${messageRequest.cacheCreation1hInputTokens}), 0)::double precision`,
        // Key breakdown（FILTER 聚合）
        keyRequests: sql<number>`count(*) FILTER (WHERE ${messageRequest.key} = ${keyString})::int`,
        keyCost: sql<string>`COALESCE(sum(${messageRequest.costUsd}) FILTER (WHERE ${messageRequest.key} = ${keyString}), 0)`,
        keyInputTokens: sql<number>`COALESCE(sum(${messageRequest.inputTokens}) FILTER (WHERE ${messageRequest.key} = ${keyString}), 0)::double precision`,
        keyOutputTokens: sql<number>`COALESCE(sum(${messageRequest.outputTokens}) FILTER (WHERE ${messageRequest.key} = ${keyString}), 0)::double precision`,
        keyCacheCreationTokens: sql<number>`COALESCE(sum(${messageRequest.cacheCreationInputTokens}) FILTER (WHERE ${messageRequest.key} = ${keyString}), 0)::double precision`,
        keyCacheReadTokens: sql<number>`COALESCE(sum(${messageRequest.cacheReadInputTokens}) FILTER (WHERE ${messageRequest.key} = ${keyString}), 0)::double precision`,
        keyCacheCreation5mTokens: sql<number>`COALESCE(sum(${messageRequest.cacheCreation5mInputTokens}) FILTER (WHERE ${messageRequest.key} = ${keyString}), 0)::double precision`,
        keyCacheCreation1hTokens: sql<number>`COALESCE(sum(${messageRequest.cacheCreation1hInputTokens}) FILTER (WHERE ${messageRequest.key} = ${keyString}), 0)::double precision`,
      })
      .from(messageRequest)
      .where(
        and(
          eq(messageRequest.userId, userId),
          isNull(messageRequest.deletedAt),
          EXCLUDE_WARMUP_CONDITION,
          startDate ? gte(messageRequest.createdAt, startDate) : undefined,
          endDate ? lt(messageRequest.createdAt, endDate) : undefined
        )
      )
      .groupBy(messageRequest.model)
      .orderBy(sql`sum(${messageRequest.costUsd}) DESC`);

    const keyOnlyBreakdown = modelBreakdown.filter((row) => (row.keyRequests ?? 0) > 0);

    const summaryAcc = keyOnlyBreakdown.reduce(
      (acc, row) => {
        const cost = Number(row.keyCost ?? 0);
        acc.totalRequests += row.keyRequests ?? 0;
        acc.totalCost += Number.isFinite(cost) ? cost : 0;
        acc.totalInputTokens += row.keyInputTokens ?? 0;
        acc.totalOutputTokens += row.keyOutputTokens ?? 0;
        acc.totalCacheCreationTokens += row.keyCacheCreationTokens ?? 0;
        acc.totalCacheReadTokens += row.keyCacheReadTokens ?? 0;
        acc.totalCacheCreation5mTokens += row.keyCacheCreation5mTokens ?? 0;
        acc.totalCacheCreation1hTokens += row.keyCacheCreation1hTokens ?? 0;
        return acc;
      },
      {
        totalRequests: 0,
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheCreationTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheCreation5mTokens: 0,
        totalCacheCreation1hTokens: 0,
      }
    );

    const totalTokens =
      summaryAcc.totalInputTokens +
      summaryAcc.totalOutputTokens +
      summaryAcc.totalCacheCreationTokens +
      summaryAcc.totalCacheReadTokens;

    const stats: UsageLogSummary = {
      totalRequests: summaryAcc.totalRequests,
      totalCost: summaryAcc.totalCost,
      totalTokens,
      totalInputTokens: summaryAcc.totalInputTokens,
      totalOutputTokens: summaryAcc.totalOutputTokens,
      totalCacheCreationTokens: summaryAcc.totalCacheCreationTokens,
      totalCacheReadTokens: summaryAcc.totalCacheReadTokens,
      totalCacheCreation5mTokens: summaryAcc.totalCacheCreation5mTokens,
      totalCacheCreation1hTokens: summaryAcc.totalCacheCreation1hTokens,
    };

    const result: MyStatsSummary = {
      ...stats,
      keyModelBreakdown: keyOnlyBreakdown
        .map((row) => ({
          model: row.model,
          requests: row.keyRequests,
          cost: Number(row.keyCost ?? 0),
          inputTokens: row.keyInputTokens,
          outputTokens: row.keyOutputTokens,
          cacheCreationTokens: row.keyCacheCreationTokens,
          cacheReadTokens: row.keyCacheReadTokens,
        }))
        .sort((a, b) => b.cost - a.cost),
      userModelBreakdown: modelBreakdown.map((row) => ({
        model: row.model,
        requests: row.userRequests,
        cost: Number(row.userCost ?? 0),
        inputTokens: row.userInputTokens,
        outputTokens: row.userOutputTokens,
        cacheCreationTokens: row.userCacheCreationTokens,
        cacheReadTokens: row.userCacheReadTokens,
      })),
      currencyCode,
    };

    return { ok: true, data: result };
  } catch (error) {
    logger.error("[my-usage] getMyStatsSummary failed", error);
    return { ok: false, error: "Failed to get statistics summary" };
  }
}
