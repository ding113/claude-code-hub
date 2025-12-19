"use server";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys as keysTable } from "@/drizzle/schema";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { RateLimitService } from "@/lib/rate-limit/service";
import { SessionTracker } from "@/lib/session-tracker";
import type { CurrencyCode } from "@/lib/utils";
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
  try {
    const session = await getSession();
    if (!session) return { ok: false, error: "Unauthorized" };
    if (session.user.role !== "admin") {
      return { ok: false, error: "Admin access required" };
    }

    const [keyRow] = await db
      .select()
      .from(keysTable)
      .where(and(eq(keysTable.id, keyId), isNull(keysTable.deletedAt)))
      .limit(1);

    if (!keyRow) {
      return { ok: false, error: "Key not found" };
    }

    const settings = await getSystemSettings();
    const currencyCode = settings.currencyDisplay;

    // Helper to convert numeric string from DB to number
    const parseNumericLimit = (val: string | null): number | null => {
      if (val === null) return null;
      const num = parseFloat(val);
      return Number.isNaN(num) ? null : num;
    };

    const [cost5h, costDaily, costWeekly, costMonthly, totalCost, concurrentSessions] =
      await Promise.all([
        RateLimitService.getCurrentCost(keyId, "key", "5h"),
        RateLimitService.getCurrentCost(
          keyId,
          "key",
          "daily",
          keyRow.dailyResetTime ?? "00:00",
          keyRow.dailyResetMode ?? "fixed"
        ),
        RateLimitService.getCurrentCost(keyId, "key", "weekly"),
        RateLimitService.getCurrentCost(keyId, "key", "monthly"),
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
        limit: keyRow.limitConcurrentSessions ?? null,
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
    return { ok: false, error: "Failed to get key quota usage" };
  }
}
