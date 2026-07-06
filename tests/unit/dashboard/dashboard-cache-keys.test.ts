import { describe, expect, it } from "vitest";
import { buildOverviewCacheKey, buildStatisticsCacheKey } from "@/types/dashboard-cache";
import type { TimeRange } from "@/types/statistics";

describe("buildOverviewCacheKey", () => {
  it("returns timezone-scoped global key", () => {
    expect(buildOverviewCacheKey("global", "Asia/Shanghai")).toBe(
      "overview:global:tz:Asia/Shanghai"
    );
  });

  it("returns timezone-scoped user key", () => {
    expect(buildOverviewCacheKey("user", 42, "America/New_York")).toBe(
      "overview:user:42:tz:America/New_York"
    );
  });
});

describe("buildStatisticsCacheKey", () => {
  it("returns correct key for today/users/global", () => {
    expect(buildStatisticsCacheKey("today", "users", "Asia/Shanghai")).toBe(
      "statistics:today:users:global:tz:Asia/Shanghai"
    );
  });

  it("returns correct key with userId", () => {
    expect(buildStatisticsCacheKey("7days", "keys", 42, "America/New_York")).toBe(
      "statistics:7days:keys:42:tz:America/New_York"
    );
  });

  it("handles all TimeRange values", () => {
    const timeRanges: TimeRange[] = ["today", "7days", "30days", "thisMonth"];
    const keys = timeRanges.map((timeRange) =>
      buildStatisticsCacheKey(timeRange, "users", "Asia/Shanghai")
    );

    expect(keys).toEqual([
      "statistics:today:users:global:tz:Asia/Shanghai",
      "statistics:7days:users:global:tz:Asia/Shanghai",
      "statistics:30days:users:global:tz:Asia/Shanghai",
      "statistics:thisMonth:users:global:tz:Asia/Shanghai",
    ]);
    expect(new Set(keys).size).toBe(timeRanges.length);
  });
});
