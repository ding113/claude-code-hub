"use server";

import { getSession } from "@/lib/auth";
import { getOverviewWithCache } from "@/lib/redis/overview-cache";
import { getStatisticsWithCache } from "@/lib/redis/statistics-cache";
import {
  type AdminUserModelBreakdownItem,
  getUserModelBreakdown,
} from "@/repository/admin-user-insights";
import type { OverviewMetricsWithComparison } from "@/repository/overview";
import { getSystemSettings } from "@/repository/system-config";
import { findUserById } from "@/repository/user";
import type { User } from "@/types/user";
import type { ActionResult } from "./types";

const VALID_TIME_RANGES = ["today", "7days", "30days", "thisMonth"] as const;
type ValidTimeRange = (typeof VALID_TIME_RANGES)[number];

function isValidTimeRange(value: string): value is ValidTimeRange {
  return (VALID_TIME_RANGES as readonly string[]).includes(value);
}

/**
 * Get overview metrics for a specific user (admin only).
 */
export async function getUserInsightsOverview(targetUserId: number): Promise<
  ActionResult<{
    user: User;
    overview: OverviewMetricsWithComparison;
    currencyCode: string;
  }>
> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "Unauthorized" };
  }

  const user = await findUserById(targetUserId);
  if (!user) {
    return { ok: false, error: "User not found" };
  }

  const [overview, settings] = await Promise.all([
    getOverviewWithCache(targetUserId),
    getSystemSettings(),
  ]);

  return {
    ok: true,
    data: {
      user,
      overview,
      currencyCode: settings.currencyDisplay,
    },
  };
}

/**
 * Get key-level trend statistics for a specific user (admin only).
 */
export async function getUserInsightsKeyTrend(
  targetUserId: number,
  timeRange: string
): Promise<ActionResult<unknown>> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "Unauthorized" };
  }

  if (!isValidTimeRange(timeRange)) {
    return {
      ok: false,
      error: `Invalid timeRange: must be one of ${VALID_TIME_RANGES.join(", ")}`,
    };
  }

  const statistics = await getStatisticsWithCache(timeRange, "keys", targetUserId);

  return { ok: true, data: statistics };
}

/**
 * Get model-level usage breakdown for a specific user (admin only).
 */
export async function getUserInsightsModelBreakdown(
  targetUserId: number,
  startDate?: string,
  endDate?: string
): Promise<
  ActionResult<{
    breakdown: AdminUserModelBreakdownItem[];
    currencyCode: string;
  }>
> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "Unauthorized" };
  }

  const [breakdown, settings] = await Promise.all([
    getUserModelBreakdown(targetUserId, startDate, endDate),
    getSystemSettings(),
  ]);

  return {
    ok: true,
    data: {
      breakdown,
      currencyCode: settings.currencyDisplay,
    },
  };
}
