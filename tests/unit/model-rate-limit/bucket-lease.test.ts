import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/redis", () => ({ getRedisClient: () => null }));
vi.mock("@/drizzle/db", () => ({ db: {} }));

import { buildModelGroupLeaseKey } from "@/lib/model-rate-limit/keys";
import { calculateLeaseSlice } from "@/lib/rate-limit/lease";
import { getModelLeasePercent } from "@/lib/model-rate-limit/bucket-lease";

describe("calculateLeaseSlice — OPT-B floor (§18.5)", () => {
  it("T-LF-1: floor raises a small slice above the percent base", () => {
    // base = 5 * 0.05 = 0.25 -> floored to 1; remaining 5 does not clamp
    expect(
      calculateLeaseSlice({ limitAmount: 5, currentUsage: 0, percent: 0.05, minSliceUsd: 1 })
    ).toBe(1);
  });

  it("T-LF-2: remaining closes out the floor (never over-grants)", () => {
    // remaining = 5 - 4.5 = 0.5 < floor 1 -> slice clamped to 0.5
    expect(
      calculateLeaseSlice({ limitAmount: 5, currentUsage: 4.5, percent: 0.05, minSliceUsd: 1 })
    ).toBe(0.5);
  });

  it("T-LF-3: no floor -> identical to mainline (limit * percent)", () => {
    expect(calculateLeaseSlice({ limitAmount: 100, currentUsage: 0, percent: 0.05 })).toBe(5);
  });

  it("T-LF-5: cap wins when floor exceeds cap", () => {
    // base 0.25 -> floor 2 -> cap 1 -> 1 (remaining 5 does not clamp)
    expect(
      calculateLeaseSlice({
        limitAmount: 5,
        currentUsage: 0,
        percent: 0.05,
        minSliceUsd: 2,
        capUsd: 1,
      })
    ).toBe(1);
  });

  it("floor of 0 / undefined leaves the base untouched", () => {
    expect(
      calculateLeaseSlice({ limitAmount: 100, currentUsage: 0, percent: 0.05, minSliceUsd: 0 })
    ).toBe(5);
  });
});

describe("getModelLeasePercent — OPT-B model percent (T-LF-4)", () => {
  it("uses the dedicated model percent when set", () => {
    expect(
      getModelLeasePercent("daily", {
        quotaModelLeasePercentDaily: 0.2,
        quotaLeasePercentDaily: 0.05,
      })
    ).toBe(0.2);
  });

  it("falls back to the global percent when the model percent is null", () => {
    expect(
      getModelLeasePercent("daily", {
        quotaModelLeasePercentDaily: null,
        quotaLeasePercentDaily: 0.05,
      })
    ).toBe(0.05);
  });

  it("falls back to 0.05 when both are absent", () => {
    expect(getModelLeasePercent("weekly", {})).toBe(0.05);
  });
});

describe("buildModelGroupLeaseKey — §6 lease key namespace", () => {
  it("user axis includes reset mode for 5h/daily", () => {
    expect(buildModelGroupLeaseKey("user", 5, 1, "daily", "fixed")).toBe(
      "lease:user-mg:5:1:daily:fixed"
    );
    expect(buildModelGroupLeaseKey("user", 5, 1, "5h", "rolling")).toBe(
      "lease:user-mg:5:1:5h:rolling"
    );
  });

  it("key axis omits reset mode for weekly/monthly", () => {
    expect(buildModelGroupLeaseKey("key", 9, 2, "weekly")).toBe("lease:key-mg:9:2:weekly");
    expect(buildModelGroupLeaseKey("key", 9, 2, "monthly")).toBe("lease:key-mg:9:2:monthly");
  });

  it("namespace is disjoint from mainline and legacy single-model keys", () => {
    const key = buildModelGroupLeaseKey("user", 5, 1, "daily", "fixed");
    expect(key.startsWith("lease:user-mg:")).toBe(true);
    expect(key).not.toContain("lease:user:");
    expect(key).not.toContain("lease:user-model:");
  });
});
