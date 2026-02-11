"use server";

import { and, eq, isNull } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { db } from "@/drizzle/db";
import { keys as keysTable, users as usersTable } from "@/drizzle/schema";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { resolveKeyConcurrentSessionLimit } from "@/lib/rate-limit/concurrent-session-limit";
import type { DailyResetMode } from "@/lib/rate-limit/time-utils";
import { SessionTracker } from "@/lib/session-tracker";
import type { CurrencyCode } from "@/lib/utils";
import { ERROR_CODES } from "@/lib/utils/error-messages";
import { getSystemSettings } from "@/repository/system-config";
import { getTotalUsageForKey } from "@/repository/usage-logs";
import type { ActionResult } from "./types";

export interface KeyQuotaItem {
  type: "limit5h" | "limitDaily" | "limitWeekly" | "limitMonthly" | "limitTotal" | "limitSessions";
  current: number;
  limit: number | null;
  mode?: "fixed" | "rolling";
  time?: string;
}

export interface KeyQuotaUsageResult {
  keyName: string;
  items: KeyQuotaItem[];
  currencyCode: CurrencyCode;
}

export async function getKeyQuotaUsage(keyId: number): Promise<ActionResult<KeyQuotaUsageResult>> {
  let tError: ((key: string, params?: Record<string, string | number>) => string) | null = null;
  try {
    tError = await getTranslations("errors");
  } catch (error) {
    logger.warn("[key-quota] failed to load errors translations", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const session = await getSession({ allowReadOnlyAccess: true });
    if (!session) {
      return {
        ok: false,
        error: tError?.("UNAUTHORIZED") ?? "",
        errorCode: ERROR_CODES.UNAUTHORIZED,
      };
    }

    const [keyRow] = await db
      .select()
      .from(keysTable)
      .where(and(eq(keysTable.id, keyId), isNull(keysTable.deletedAt)))
      .limit(1);

    if (!keyRow) {
      return {
        ok: false,
        error: tError?.("KEY_NOT_FOUND") ?? "",
        errorCode: ERROR_CODES.NOT_FOUND,
      };
    }

    // Allow admin to view any key, users can only view their own keys
    if (session.user.role !== "admin" && keyRow.userId !== session.user.id) {
      return {
        ok: false,
        error: tError?.("PERMISSION_DENIED") ?? "",
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    // Key 并发未设置时，继承用户并发上限（避免 UI 显示为“无限制”但实际被 User 并发限制约束）
    const [userRow] = await db
      .select({ limitConcurrentSessions: usersTable.limitConcurrentSessions })
      .from(usersTable)
      .where(and(eq(usersTable.id, keyRow.userId), isNull(usersTable.deletedAt)))
      .limit(1);

    const effectiveConcurrentLimit = resolveKeyConcurrentSessionLimit(
      keyRow.limitConcurrentSessions ?? 0,
      userRow?.limitConcurrentSessions ?? null
    );

    const settings = await getSystemSettings();
    const currencyCode = settings.currencyDisplay;

    // Helper to convert numeric string from DB to number
    const parseNumericLimit = (val: string | null): number | null => {
      if (val === null) return null;
      const num = parseFloat(val);
      return Number.isNaN(num) ? null : num;
    };

    // Import time utils and statistics functions (same as my-usage.ts for consistency)
    const { getTimeRangeForPeriodWithMode, getTimeRangeForPeriod } = await import(
      "@/lib/rate-limit/time-utils"
    );
    const { sumKeyCostInTimeRange } = await import("@/repository/statistics");

    // Calculate time ranges using Key's dailyResetTime/dailyResetMode configuration
    const keyDailyTimeRange = await getTimeRangeForPeriodWithMode(
      "daily",
      keyRow.dailyResetTime ?? "00:00",
      (keyRow.dailyResetMode as DailyResetMode | undefined) ?? "fixed"
    );

    // 5h/weekly/monthly use unified time ranges
    const range5h = await getTimeRangeForPeriod("5h");
    const rangeWeekly = await getTimeRangeForPeriod("weekly");
    const rangeMonthly = await getTimeRangeForPeriod("monthly");

    // Use DB direct queries for consistency with my-usage.ts (not Redis-first)
    const [cost5h, costDaily, costWeekly, costMonthly, totalCost, concurrentSessions] =
      await Promise.all([
        sumKeyCostInTimeRange(keyId, range5h.startTime, range5h.endTime),
        sumKeyCostInTimeRange(keyId, keyDailyTimeRange.startTime, keyDailyTimeRange.endTime),
        sumKeyCostInTimeRange(keyId, rangeWeekly.startTime, rangeWeekly.endTime),
        sumKeyCostInTimeRange(keyId, rangeMonthly.startTime, rangeMonthly.endTime),
        getTotalUsageForKey(keyRow.key),
        SessionTracker.getKeySessionCount(keyId),
      ]);

    const items: KeyQuotaItem[] = [
      {
        type: "limit5h",
        current: cost5h,
        limit: parseNumericLimit(keyRow.limit5hUsd),
      },
      {
        type: "limitDaily",
        current: costDaily,
        limit: parseNumericLimit(keyRow.limitDailyUsd),
        mode: keyRow.dailyResetMode ?? "fixed",
        time: keyRow.dailyResetTime ?? "00:00",
      },
      {
        type: "limitWeekly",
        current: costWeekly,
        limit: parseNumericLimit(keyRow.limitWeeklyUsd),
      },
      {
        type: "limitMonthly",
        current: costMonthly,
        limit: parseNumericLimit(keyRow.limitMonthlyUsd),
      },
      {
        type: "limitTotal",
        current: totalCost,
        limit: parseNumericLimit(keyRow.limitTotalUsd),
      },
      {
        type: "limitSessions",
        current: concurrentSessions,
        limit: effectiveConcurrentLimit > 0 ? effectiveConcurrentLimit : null,
      },
    ];

    return {
      ok: true,
      data: {
        keyName: keyRow.name ?? "",
        items,
        currencyCode,
      },
    };
  } catch (error) {
    logger.error("[key-quota] getKeyQuotaUsage failed", error);
    return {
      ok: false,
      error: tError?.("INTERNAL_ERROR") ?? "",
      errorCode: ERROR_CODES.INTERNAL_ERROR,
    };
  }
}
