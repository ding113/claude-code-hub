"use server";

import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys as keysTable, messageRequest } from "@/drizzle/schema";
import { getSession } from "@/lib/auth";
import { getEnvConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { RateLimitService } from "@/lib/rate-limit/service";
import { SessionTracker } from "@/lib/session-tracker";
import type { CurrencyCode } from "@/lib/utils";
import { getSystemSettings } from "@/repository/system-config";
import {
  findUsageLogsWithDetails,
  getDistinctEndpointsForKey,
  getDistinctModelsForKey,
  getTotalUsageForKey,
  type UsageLogFilters,
} from "@/repository/usage-logs";
import type { BillingModelSource } from "@/types/system-config";
import type { ActionResult } from "./types";

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
  userCurrent5hUsd: number;
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
}

export interface MyUsageLogsResult {
  logs: MyUsageLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  currencyCode: CurrencyCode;
  billingModelSource: BillingModelSource;
}

function getPeriodStart(period: "5h" | "weekly" | "monthly" | "total" | "today") {
  const now = new Date();
  if (period === "total") return null;
  if (period === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (period === "5h") {
    return new Date(now.getTime() - 5 * 60 * 60 * 1000);
  }
  if (period === "weekly") {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  if (period === "monthly") {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  return null;
}

async function sumUserCost(userId: number, period: "5h" | "weekly" | "monthly" | "total") {
  const conditions = [
    eq(keysTable.userId, userId),
    isNull(keysTable.deletedAt),
    isNull(messageRequest.deletedAt),
  ];
  const start = getPeriodStart(period);
  if (start) {
    conditions.push(gte(messageRequest.createdAt, start));
  }

  const [row] = await db
    .select({ total: sql<string>`COALESCE(sum(${messageRequest.costUsd}), 0)` })
    .from(messageRequest)
    .innerJoin(keysTable, eq(messageRequest.key, keysTable.key))
    .where(and(...conditions));

  return Number(row?.total ?? 0);
}

export async function getMyQuota(): Promise<ActionResult<MyUsageQuota>> {
  try {
    const session = await getSession({ allowReadOnlyAccess: true });
    if (!session) return { ok: false, error: "Unauthorized" };

    const key = session.key;
    const user = session.user;

    const [
      keyCost5h,
      keyCostDaily,
      keyCostWeekly,
      keyCostMonthly,
      keyTotalCost,
      keyConcurrent,
      userCost5h,
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
      keyLimitConcurrentSessions: key.limitConcurrentSessions || 0,
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
      userCurrent5hUsd: userCost5h,
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

    const timezone = getEnvConfig().TZ || "UTC";
    const startOfDay = sql`(CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date`;

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
          sql`(${messageRequest.createdAt} AT TIME ZONE ${timezone})::date = ${startOfDay}`
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
          sql`(${messageRequest.createdAt} AT TIME ZONE ${timezone})::date = ${startOfDay}`
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

    const usageFilters: UsageLogFilters = {
      keyId: session.key.id,
      startTime: filters.startDate
        ? new Date(`${filters.startDate}T00:00:00`).getTime()
        : undefined,
      endTime: filters.endDate ? new Date(`${filters.endDate}T23:59:59.999`).getTime() : undefined,
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
