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
import type { DatabaseKeyStatRow } from "@/types/statistics";
import type { User } from "@/types/user";
import type { ActionResult } from "./types";

const VALID_TIME_RANGES = ["today", "7days", "30days", "thisMonth"] as const;
type ValidTimeRange = (typeof VALID_TIME_RANGES)[number];

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

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
): Promise<ActionResult<DatabaseKeyStatRow[]>> {
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

  const normalized = (statistics as DatabaseKeyStatRow[]).map((row) => ({
    ...row,
    date: typeof row.date === "string" ? row.date : new Date(row.date).toISOString(),
  }));

  return { ok: true, data: normalized };
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

  if (startDate && !DATE_REGEX.test(startDate)) {
    return { ok: false, error: "Invalid startDate format: use YYYY-MM-DD" };
  }
  if (endDate && !DATE_REGEX.test(endDate)) {
    return { ok: false, error: "Invalid endDate format: use YYYY-MM-DD" };
  }
  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    return { ok: false, error: "startDate must not be after endDate" };
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
