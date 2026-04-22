"use server";

import { fromZonedTime } from "date-fns-tz";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { db } from "@/drizzle/db";
import { messageRequest, usageLedger } from "@/drizzle/schema";
import { getSession } from "@/lib/auth";
import { lookupIp } from "@/lib/ip-geo/client";
import { logger } from "@/lib/logger";
import { resolveKeyConcurrentSessionLimit } from "@/lib/rate-limit/concurrent-session-limit";
import {
  clipStartByResetAt,
  resolveKeyCostResetAt,
  resolveUser5hCostResetAt,
} from "@/lib/rate-limit/cost-reset-utils";
import type { DailyResetMode } from "@/lib/rate-limit/time-utils";
import { SessionTracker } from "@/lib/session-tracker";
import type { CurrencyCode } from "@/lib/utils";
import { ERROR_CODES } from "@/lib/utils/error-messages";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import { LEDGER_BILLING_CONDITION } from "@/repository/_shared/ledger-conditions";
import { EXCLUDE_WARMUP_CONDITION } from "@/repository/_shared/message-request-conditions";
import { getSystemSettings } from "@/repository/system-config";
import {
  findReadonlyUsageLogsBatchForKey,
  findUsageLogsForKeyBatch,
  findUsageLogsForKeySlim,
  getDistinctEndpointsForKey,
  getDistinctModelsForKey,
  type UsageLogSlimBatchResult,
  type UsageLogSummary,
  type UsageLogsBatchResult,
} from "@/repository/usage-logs";
import type { IpGeoLookupResult, IpGeoPrivateMarker } from "@/types/ip-geo";
import type { ProviderChainItem } from "@/types/message";
import type { SpecialSetting } from "@/types/special-settings";
import type { BillingModelSource } from "@/types/system-config";
import type { ActionResult } from "./types";

async function getErrorTranslator() {
  return getTranslations("errors");
}

function scrubProviderChainRequestForReadonly(
  providerChain: ProviderChainItem[] | null
): ProviderChainItem[] | null {
  return (
    providerChain?.map((item) => {
      if (!item.errorDetails?.request) {
        return item;
      }

      const { request: _request, ...errorDetailsWithoutRequest } = item.errorDetails;

      return {
        ...item,
        errorDetails: errorDetailsWithoutRequest,
      };
    }) ?? null
  );
}

function scrubSpecialSettingsForReadonly(
  specialSettings: SpecialSetting[] | null | undefined
): SpecialSetting[] | null {
  return (
    specialSettings?.map((setting) =>
      setting.type === "guard_intercept" ? { ...setting, reason: null } : setting
    ) ?? null
  );
}

function scrubUsageLogsBatchForReadonly(result: UsageLogsBatchResult): UsageLogsBatchResult {
  return {
    ...result,
    logs: result.logs.map((log) => ({
      ...log,
      userName: "",
      keyName: "",
      providerName: null,
      errorMessage: null,
      blockedReason: null,
      userAgent: null,
      messagesCount: null,
      _liveChain: null,
      providerChain: scrubProviderChainRequestForReadonly(log.providerChain),
      costMultiplier: null,
      groupCostMultiplier: null,
      costBreakdown: null,
      specialSettings: scrubSpecialSettingsForReadonly(log.specialSettings),
    })),
  };
}

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
  billingModelSource: BillingModelSource;
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
  anthropicEffort?: string | null;
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

export interface MyUsageLogsBatchResult {
  logs: MyUsageLogEntry[];
  nextCursor: { createdAt: string; id: number } | null;
  hasMore: boolean;
  currencyCode: CurrencyCode;
  billingModelSource: BillingModelSource;
}

export interface MyUsageLogsFilters {
  startDate?: string;
  endDate?: string;
  startTime?: number;
  endTime?: number;
  sessionId?: string;
  model?: string;
  statusCode?: number;
  excludeStatusCode200?: boolean;
  endpoint?: string;
  minRetryCount?: number;
  page?: number;
  pageSize?: number;
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
      billingModelSource: settings.billingModelSource,
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
    const { RateLimitService } = await import("@/lib/rate-limit/service");

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

    // full reset 继续影响所有窗口；5H-only reset 只额外推进用户聚合 5H 的起点。
    const userCostResetAt = user.costResetAt ?? null;
    const user5hCostResetAt = resolveUser5hCostResetAt(
      user.costResetAt ?? null,
      user.limit5hCostResetAt ?? null
    );
    const keyCostResetAtResolved = resolveKeyCostResetAt(key.costResetAt ?? null, userCostResetAt);
    const keyClipStart = (start: Date): Date => clipStartByResetAt(start, keyCostResetAtResolved);
    const userClipStart = (start: Date): Date => clipStartByResetAt(start, userCostResetAt);
    const user5hClipStart = (start: Date): Date => clipStartByResetAt(start, user5hCostResetAt);

    const keyClippedRange5h = {
      startTime: keyClipStart(range5h.startTime),
      endTime: range5h.endTime,
    };
    const keyClippedRangeWeekly = {
      startTime: keyClipStart(rangeWeekly.startTime),
      endTime: rangeWeekly.endTime,
    };
    const keyClippedRangeMonthly = {
      startTime: keyClipStart(rangeMonthly.startTime),
      endTime: rangeMonthly.endTime,
    };
    const clippedKeyDaily = {
      startTime: keyClipStart(keyDailyTimeRange.startTime),
      endTime: keyDailyTimeRange.endTime,
    };

    const userClippedRange5h = {
      startTime: user5hClipStart(range5h.startTime),
      endTime: range5h.endTime,
    };
    const userClippedRangeWeekly = {
      startTime: userClipStart(rangeWeekly.startTime),
      endTime: rangeWeekly.endTime,
    };
    const userClippedRangeMonthly = {
      startTime: userClipStart(rangeMonthly.startTime),
      endTime: rangeMonthly.endTime,
    };
    const clippedUserDaily = {
      startTime: userClipStart(userDailyTimeRange.startTime),
      endTime: userDailyTimeRange.endTime,
    };

    const effectiveKeyConcurrentLimit = resolveKeyConcurrentSessionLimit(
      key.limitConcurrentSessions ?? 0,
      user.limitConcurrentSessions ?? null
    );

    const [keyCosts, keyFixed5hUsd, keyConcurrent, userCosts, userFixed5hUsd, userKeyConcurrent] =
      await Promise.all([
        // Key 配额：直接查 DB（与 User 保持一致，解决数据源不一致问题）
        sumKeyQuotaCostsById(
          key.id,
          {
            range5h: keyClippedRange5h,
            rangeDaily: clippedKeyDaily,
            rangeWeekly: keyClippedRangeWeekly,
            rangeMonthly: keyClippedRangeMonthly,
          },
          ALL_TIME_MAX_AGE_DAYS,
          keyCostResetAtResolved
        ),
        (key.limit5hResetMode ?? "rolling") === "fixed"
          ? RateLimitService.getCurrentCost(
              key.id,
              "key",
              "5h",
              key.dailyResetTime ?? "00:00",
              "fixed",
              {
                costResetAt: keyCostResetAtResolved,
              }
            )
          : Promise.resolve(null),
        SessionTracker.getKeySessionCount(key.id),
        // User 配额：直接查 DB
        sumUserQuotaCosts(
          user.id,
          {
            range5h: userClippedRange5h,
            rangeDaily: clippedUserDaily,
            rangeWeekly: userClippedRangeWeekly,
            rangeMonthly: userClippedRangeMonthly,
          },
          ALL_TIME_MAX_AGE_DAYS,
          userCostResetAt
        ),
        (user.limit5hResetMode ?? "rolling") === "fixed"
          ? RateLimitService.getCurrentCost(
              user.id,
              "user",
              "5h",
              user.dailyResetTime ?? "00:00",
              "fixed",
              {
                costResetAt: userCostResetAt,
                limit5hCostResetAt: user.limit5hCostResetAt ?? null,
              }
            )
          : Promise.resolve(null),
        getUserConcurrentSessions(user.id),
      ]);

    const {
      cost5h: keyCurrent5hUsd,
      costDaily: keyCostDaily,
      costWeekly: keyCostWeekly,
      costMonthly: keyCostMonthly,
      costTotal: keyTotalCost,
    } = keyCosts;
    const {
      cost5h: userCurrent5hUsd,
      costDaily: userCostDaily,
      costWeekly: userCostWeekly,
      costMonthly: userCostMonthly,
      costTotal: userTotalCost,
    } = userCosts;
    const resolvedKeyCurrent5hUsd = keyFixed5hUsd ?? keyCurrent5hUsd;
    const resolvedUserCurrent5hUsd = userFixed5hUsd ?? userCurrent5hUsd;

    const quota: MyUsageQuota = {
      keyLimit5hUsd: key.limit5hUsd ?? null,
      keyLimitDailyUsd: key.limitDailyUsd ?? null,
      keyLimitWeeklyUsd: key.limitWeeklyUsd ?? null,
      keyLimitMonthlyUsd: key.limitMonthlyUsd ?? null,
      keyLimitTotalUsd: key.limitTotalUsd ?? null,
      keyLimitConcurrentSessions: effectiveKeyConcurrentLimit,
      keyCurrent5hUsd: resolvedKeyCurrent5hUsd,
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
      userCurrent5hUsd: resolvedUserCurrent5hUsd,
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
        model: usageLedger.model,
        originalModel: usageLedger.originalModel,
        calls: sql<number>`count(*)::int`,
        costUsd: sql<string>`COALESCE(sum(${usageLedger.costUsd}), 0)`,
        inputTokens: sql<number>`COALESCE(sum(${usageLedger.inputTokens}), 0)::double precision`,
        outputTokens: sql<number>`COALESCE(sum(${usageLedger.outputTokens}), 0)::double precision`,
      })
      .from(usageLedger)
      .where(
        and(
          eq(usageLedger.key, session.key.key),
          LEDGER_BILLING_CONDITION,
          gte(usageLedger.createdAt, timeRange.startTime),
          lt(usageLedger.createdAt, timeRange.endTime)
        )
      )
      .groupBy(usageLedger.model, usageLedger.originalModel);

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

export interface MyUsageLogsBatchFilters {
  startDate?: string;
  endDate?: string;
  startTime?: number;
  endTime?: number;
  /** Session ID（精确匹配；空字符串/空白视为不筛选） */
  sessionId?: string;
  model?: string;
  statusCode?: number;
  excludeStatusCode200?: boolean;
  endpoint?: string;
  minRetryCount?: number;
  cursor?: { createdAt: string; id: number };
  limit?: number;
}

function mapMyUsageLogEntries(
  result: Pick<UsageLogSlimBatchResult, "logs">,
  billingModelSource: BillingModelSource
): MyUsageLogEntry[] {
  return result.logs.map((log) => {
    const modelRedirect =
      log.originalModel && log.model && log.originalModel !== log.model
        ? `${log.originalModel} → ${log.model}`
        : null;

    const billingModel =
      (billingModelSource === "original" ? log.originalModel : log.model) ?? null;

    return {
      id: log.id,
      createdAt: log.createdAt,
      model: log.model,
      billingModel,
      anthropicEffort: log.anthropicEffort ?? null,
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
}

export async function getMyUsageLogs(
  filters: MyUsageLogsFilters = {}
): Promise<ActionResult<MyUsageLogsResult>> {
  try {
    const session = await getSession({ allowReadOnlyAccess: true });
    if (!session) return { ok: false, error: "Unauthorized" };

    const settings = await getSystemSettings();
    const timezone = await resolveSystemTimezone();
    const dateRange =
      filters.startTime !== undefined || filters.endTime !== undefined
        ? { startTime: filters.startTime, endTime: filters.endTime }
        : parseDateRangeInServerTimezone(filters.startDate, filters.endDate, timezone);
    const parsedPageSize = Number(filters.pageSize);
    const pageSize =
      Number.isFinite(parsedPageSize) && parsedPageSize > 0
        ? Math.min(Math.trunc(parsedPageSize), 100)
        : 20;
    const parsedPage = Number(filters.page);
    const page = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.trunc(parsedPage) : 1;
    const result = await findUsageLogsForKeySlim({
      keyString: session.key.key,
      sessionId: filters.sessionId,
      startTime: dateRange.startTime,
      endTime: dateRange.endTime,
      model: filters.model,
      statusCode: filters.statusCode,
      excludeStatusCode200: filters.excludeStatusCode200,
      endpoint: filters.endpoint,
      minRetryCount: filters.minRetryCount,
      page,
      pageSize,
    });

    return {
      ok: true,
      data: {
        logs: mapMyUsageLogEntries(result, settings.billingModelSource),
        total: result.total,
        page,
        pageSize,
        currencyCode: settings.currencyDisplay,
        billingModelSource: settings.billingModelSource,
      },
    };
  } catch (error) {
    logger.error("[my-usage] getMyUsageLogs failed", { error, filters });
    return { ok: false, error: "Failed to get usage logs" };
  }
}

export async function getMyUsageLogsBatch(
  filters: MyUsageLogsBatchFilters = {}
): Promise<ActionResult<MyUsageLogsBatchResult>> {
  try {
    const session = await getSession({ allowReadOnlyAccess: true });
    if (!session) return { ok: false, error: "Unauthorized" };

    const settings = await getSystemSettings();
    const timezone = await resolveSystemTimezone();
    const dateRange =
      filters.startTime !== undefined || filters.endTime !== undefined
        ? { startTime: filters.startTime, endTime: filters.endTime }
        : parseDateRangeInServerTimezone(filters.startDate, filters.endDate, timezone);
    const limit = filters.limit && filters.limit > 0 ? Math.min(filters.limit, 100) : 20;
    const result = await findUsageLogsForKeyBatch({
      keyString: session.key.key,
      sessionId: filters.sessionId,
      startTime: dateRange.startTime,
      endTime: dateRange.endTime,
      model: filters.model,
      statusCode: filters.statusCode,
      excludeStatusCode200: filters.excludeStatusCode200,
      endpoint: filters.endpoint,
      minRetryCount: filters.minRetryCount,
      cursor: filters.cursor,
      limit,
    });

    return {
      ok: true,
      data: {
        logs: mapMyUsageLogEntries(result, settings.billingModelSource),
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        currencyCode: settings.currencyDisplay,
        billingModelSource: settings.billingModelSource,
      },
    };
  } catch (error) {
    logger.error("[my-usage] getMyUsageLogsBatch failed", error);
    return { ok: false, error: "Failed to get usage logs" };
  }
}

/**
 * Full-format batch fetch for VirtualizedLogsTable on my-usage page.
 * Scoped to the current key (not just user) and uses allowReadOnlyAccess.
 * Returns UsageLogsBatchResult (same shape as admin getUsageLogsBatch).
 */
export async function getMyUsageLogsBatchFull(
  params: MyUsageLogsBatchFilters = {}
): Promise<ActionResult<UsageLogsBatchResult>> {
  const tError = await getErrorTranslator();
  try {
    const session = await getSession({ allowReadOnlyAccess: true });
    if (!session) {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const timezone = await resolveSystemTimezone();
    const dateRange =
      params.startTime !== undefined || params.endTime !== undefined
        ? { startTime: params.startTime, endTime: params.endTime }
        : parseDateRangeInServerTimezone(params.startDate, params.endDate, timezone);
    const limit = params.limit && params.limit > 0 ? Math.min(params.limit, 100) : 20;
    const result = await findReadonlyUsageLogsBatchForKey({
      sessionId: params.sessionId,
      model: params.model,
      statusCode: params.statusCode,
      excludeStatusCode200: params.excludeStatusCode200,
      endpoint: params.endpoint,
      minRetryCount: params.minRetryCount,
      cursor: params.cursor,
      startTime: dateRange.startTime,
      endTime: dateRange.endTime,
      limit,
      keyString: session.key.key,
    });

    return { ok: true, data: scrubUsageLogsBatchForReadonly(result) };
  } catch (error) {
    logger.error("[my-usage] getMyUsageLogsBatchFull failed", error);
    return {
      ok: false,
      error: tError("OPERATION_FAILED"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

export async function getMyAvailableModels(): Promise<ActionResult<string[]>> {
  const tError = await getErrorTranslator();
  try {
    const session = await getSession({ allowReadOnlyAccess: true });
    if (!session) {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const models = await getDistinctModelsForKey(session.key.key);
    return { ok: true, data: models };
  } catch (error) {
    logger.error("[my-usage] getMyAvailableModels failed", error);
    return {
      ok: false,
      error: tError("OPERATION_FAILED"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

export async function getMyAvailableEndpoints(): Promise<ActionResult<string[]>> {
  const tError = await getErrorTranslator();
  try {
    const session = await getSession({ allowReadOnlyAccess: true });
    if (!session) {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const endpoints = await getDistinctEndpointsForKey(session.key.key);
    return { ok: true, data: endpoints };
  } catch (error) {
    logger.error("[my-usage] getMyAvailableEndpoints failed", error);
    return {
      ok: false,
      error: tError("OPERATION_FAILED"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

export async function getMyIpGeoDetails(params: { ip: string; lang?: string }): Promise<
  ActionResult<{
    status: "ok" | "private" | "error";
    data?: IpGeoLookupResult | IpGeoPrivateMarker;
    error?: string;
  }>
> {
  const tError = await getErrorTranslator();
  try {
    const session = await getSession({ allowReadOnlyAccess: true });
    if (!session) {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const ip = params.ip.trim();
    if (!ip) {
      return {
        ok: false,
        error: tError("REQUIRED_FIELD", { field: tError("IP_ADDRESS_FIELD") }),
        errorCode: ERROR_CODES.REQUIRED_FIELD,
      };
    }

    const settings = await getSystemSettings();
    if (!settings.ipGeoLookupEnabled) {
      return { ok: false, error: tError("INVALID_STATE"), errorCode: ERROR_CODES.INVALID_STATE };
    }

    // 仅允许查询当前 key 在 my-usage 可见日志中真实出现过的 IP。
    const [messageRequestMatch] = await db
      .select({ id: messageRequest.id })
      .from(messageRequest)
      .where(
        and(
          isNull(messageRequest.deletedAt),
          EXCLUDE_WARMUP_CONDITION,
          eq(messageRequest.key, session.key.key),
          eq(messageRequest.clientIp, ip)
        )
      )
      .limit(1);

    let visibleLogId = messageRequestMatch?.id ?? null;

    if (!visibleLogId) {
      const [ledgerMatch] = await db
        .select({ id: usageLedger.requestId })
        .from(usageLedger)
        .where(
          and(
            LEDGER_BILLING_CONDITION,
            eq(usageLedger.key, session.key.key),
            eq(usageLedger.clientIp, ip),
            sql`not exists (
              select 1
              from "message_request" as mr_active
              where mr_active.id = ${usageLedger.requestId}
                and mr_active.deleted_at is null
                and mr_active.key = ${usageLedger.key}
            )`
          )
        )
        .limit(1);

      visibleLogId = ledgerMatch?.id ?? null;
    }

    if (!visibleLogId) {
      return { ok: false, error: tError("NOT_FOUND"), errorCode: ERROR_CODES.NOT_FOUND };
    }

    const result = await lookupIp(ip, { lang: params.lang });
    if (result.status === "error") {
      logger.warn("[my-usage] getMyIpGeoDetails lookup returned error", {
        messageRequestId: visibleLogId,
        lang: params.lang,
        userId: session.user.id,
        keyId: session.key.id,
        error: result.error,
      });
    }

    return { ok: true, data: result };
  } catch (error) {
    logger.error("[my-usage] getMyIpGeoDetails failed", { error });
    return {
      ok: false,
      error: tError("OPERATION_FAILED"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
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
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
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
        model: usageLedger.model,
        // User breakdown（跨所有 Key）
        userRequests: sql<number>`count(*)::int`,
        userCost: sql<string>`COALESCE(sum(${usageLedger.costUsd}), 0)`,
        userInputTokens: sql<number>`COALESCE(sum(${usageLedger.inputTokens}), 0)::double precision`,
        userOutputTokens: sql<number>`COALESCE(sum(${usageLedger.outputTokens}), 0)::double precision`,
        userCacheCreationTokens: sql<number>`COALESCE(sum(${usageLedger.cacheCreationInputTokens}), 0)::double precision`,
        userCacheReadTokens: sql<number>`COALESCE(sum(${usageLedger.cacheReadInputTokens}), 0)::double precision`,
        userCacheCreation5mTokens: sql<number>`COALESCE(sum(${usageLedger.cacheCreation5mInputTokens}), 0)::double precision`,
        userCacheCreation1hTokens: sql<number>`COALESCE(sum(${usageLedger.cacheCreation1hInputTokens}), 0)::double precision`,
        // Key breakdown（FILTER 聚合）
        keyRequests: sql<number>`count(*) FILTER (WHERE ${usageLedger.key} = ${keyString})::int`,
        keyCost: sql<string>`COALESCE(sum(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.key} = ${keyString}), 0)`,
        keyInputTokens: sql<number>`COALESCE(sum(${usageLedger.inputTokens}) FILTER (WHERE ${usageLedger.key} = ${keyString}), 0)::double precision`,
        keyOutputTokens: sql<number>`COALESCE(sum(${usageLedger.outputTokens}) FILTER (WHERE ${usageLedger.key} = ${keyString}), 0)::double precision`,
        keyCacheCreationTokens: sql<number>`COALESCE(sum(${usageLedger.cacheCreationInputTokens}) FILTER (WHERE ${usageLedger.key} = ${keyString}), 0)::double precision`,
        keyCacheReadTokens: sql<number>`COALESCE(sum(${usageLedger.cacheReadInputTokens}) FILTER (WHERE ${usageLedger.key} = ${keyString}), 0)::double precision`,
        keyCacheCreation5mTokens: sql<number>`COALESCE(sum(${usageLedger.cacheCreation5mInputTokens}) FILTER (WHERE ${usageLedger.key} = ${keyString}), 0)::double precision`,
        keyCacheCreation1hTokens: sql<number>`COALESCE(sum(${usageLedger.cacheCreation1hInputTokens}) FILTER (WHERE ${usageLedger.key} = ${keyString}), 0)::double precision`,
      })
      .from(usageLedger)
      .where(
        and(
          eq(usageLedger.userId, userId),
          LEDGER_BILLING_CONDITION,
          startDate ? gte(usageLedger.createdAt, startDate) : undefined,
          endDate ? lt(usageLedger.createdAt, endDate) : undefined
        )
      )
      .groupBy(usageLedger.model)
      .orderBy(sql`sum(${usageLedger.costUsd}) DESC`);

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
          cacheCreation5mTokens: row.keyCacheCreation5mTokens,
          cacheCreation1hTokens: row.keyCacheCreation1hTokens,
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
        cacheCreation5mTokens: row.userCacheCreation5mTokens,
        cacheCreation1hTokens: row.userCacheCreation1hTokens,
      })),
      currencyCode,
    };

    return { ok: true, data: result };
  } catch (error) {
    logger.error("[my-usage] getMyStatsSummary failed", error);
    return { ok: false, error: "Failed to get statistics summary" };
  }
}
