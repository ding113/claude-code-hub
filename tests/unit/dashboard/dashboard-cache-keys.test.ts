import { describe, expect, it } from "vitest";
import { buildOverviewCacheKey, buildStatisticsCacheKey } from "@/types/dashboard-cache";
import type { TimeRange } from "@/types/statistics";

describe("buildOverviewCacheKey", () => {
  it("returns 'overview:global' for global scope", () => {
    expect(buildOverviewCacheKey("global")).toBe("overview:global");
  });

  it("returns 'overview:user:42' for user scope with userId=42", () => {
    expect(buildOverviewCacheKey("user", 42)).toBe("overview:user:42");
  });
});

describe("buildStatisticsCacheKey", () => {
  it("returns correct key for today/users/global", () => {
    expect(buildStatisticsCacheKey("today", "users")).toBe("statistics:today:users:global");
  });

  it("returns correct key with userId", () => {
    expect(buildStatisticsCacheKey("7days", "keys", 42)).toBe("statistics:7days:keys:42");
  });

  it("handles all TimeRange values", () => {
    const timeRanges: TimeRange[] = ["today", "7days", "30days", "thisMonth"];
    const keys = timeRanges.map((timeRange) => buildStatisticsCacheKey(timeRange, "users"));

    expect(keys).toEqual([
      "statistics:today:users:global",
      "statistics:7days:users:global",
      "statistics:30days:users:global",
      "statistics:thisMonth:users:global",
    ]);
    expect(new Set(keys).size).toBe(timeRanges.length);
  });
});
