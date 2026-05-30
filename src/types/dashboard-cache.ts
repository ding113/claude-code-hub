import type { TimeRange } from "@/types/statistics";

export type OverviewCacheKey = {
  scope: "global" | "user";
  userId?: number;
  timezone: string;
};

export type StatisticsCacheKey = {
  timeRange: TimeRange;
  mode: "users" | "keys" | "mixed";
  userId?: number;
  timezone: string;
};

export function buildOverviewCacheKey(scope: "global", timezone: string): string;
export function buildOverviewCacheKey(scope: "user", userId: number, timezone: string): string;
export function buildOverviewCacheKey(
  scope: "global" | "user",
  userIdOrTimezone: number | string,
  timezone?: string
): string {
  const resolvedTimezone = scope === "global" ? String(userIdOrTimezone) : String(timezone);
  return scope === "global"
    ? `overview:global:tz:${resolvedTimezone}`
    : `overview:user:${userIdOrTimezone}:tz:${resolvedTimezone}`;
}

export function buildStatisticsCacheKey(
  timeRange: TimeRange,
  mode: "users" | "keys" | "mixed",
  timezone: string
): string;
export function buildStatisticsCacheKey(
  timeRange: TimeRange,
  mode: "users" | "keys" | "mixed",
  userId: number | undefined,
  timezone: string
): string;
export function buildStatisticsCacheKey(
  timeRange: TimeRange,
  mode: "users" | "keys" | "mixed",
  userIdOrTimezone: number | string | undefined,
  timezone?: string
): string {
  const userId = typeof userIdOrTimezone === "number" ? userIdOrTimezone : undefined;
  const resolvedTimezone =
    typeof userIdOrTimezone === "string" ? userIdOrTimezone : String(timezone);
  return `statistics:${timeRange}:${mode}:${userId ?? "global"}:tz:${resolvedTimezone}`;
}
