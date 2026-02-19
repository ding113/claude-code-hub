import type { TimeRange } from "@/types/statistics";

export type OverviewCacheKey = {
  scope: "global" | "user";
  userId?: number;
};

export type StatisticsCacheKey = {
  timeRange: TimeRange;
  mode: "users" | "keys" | "mixed";
  userId?: number;
};

export function buildOverviewCacheKey(scope: "global" | "user", userId?: number): string {
  return scope === "global" ? "overview:global" : `overview:user:${userId}`;
}

export function buildStatisticsCacheKey(
  timeRange: TimeRange,
  mode: "users" | "keys" | "mixed",
  userId?: number
): string {
  return `statistics:${timeRange}:${mode}:${userId ?? "global"}`;
}
