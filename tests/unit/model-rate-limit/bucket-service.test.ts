import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/redis", () => ({ getRedisClient: vi.fn() }));
vi.mock("@/repository/statistics", () => ({ sumScopeCostByModelsInTimeRange: vi.fn() }));
vi.mock("@/lib/model-rate-limit/bucket-lease", () => ({
  BucketLeaseService: { getCostLease: vi.fn(), decrementLeaseBudget: vi.fn() },
}));

import { BucketLeaseService } from "@/lib/model-rate-limit/bucket-lease";
import { BucketRateLimitService } from "@/lib/model-rate-limit/bucket-service";
import type { ModelLimitBucket, ModelLimitCaps } from "@/lib/model-rate-limit/types";
import type { BudgetLease } from "@/lib/rate-limit/lease";
import { getRedisClient } from "@/lib/redis";
import { sumScopeCostByModelsInTimeRange } from "@/repository/statistics";

const getCostLease = vi.mocked(BucketLeaseService.getCostLease);
const decrementLeaseBudget = vi.mocked(BucketLeaseService.decrementLeaseBudget);
const getRedis = vi.mocked(getRedisClient);
const sumScopeCost = vi.mocked(sumScopeCostByModelsInTimeRange);

function makeCaps(overrides: Partial<ModelLimitCaps> = {}): ModelLimitCaps {
  return {
    limit5hUsd: null,
    limit5hResetMode: "rolling",
    dailyLimitUsd: null,
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    limit5hCostResetAt: null,
    ...overrides,
  };
}

function makeBucket(overrides: Partial<ModelLimitCaps> = {}): ModelLimitBucket {
  return {
    axis: "user",
    scopeId: 7,
    modelGroupId: 42,
    models: ["m-a", "m-b"],
    caps: makeCaps(overrides),
  };
}

function makeLease(overrides: Partial<BudgetLease> = {}): BudgetLease {
  return {
    entityType: "user",
    entityId: 7,
    window: "5h",
    resetMode: "rolling",
    resetTime: "00:00",
    snapshotAtMs: 0,
    currentUsage: 0,
    limitAmount: 100,
    remainingBudget: 50,
    ttlSeconds: 300,
    ...overrides,
  };
}

function makeReadyRedis(getValue: string | null) {
  return {
    status: "ready",
    get: vi.fn().mockResolvedValue(getValue),
    setex: vi.fn().mockResolvedValue("OK"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getRedis.mockReturnValue(null as never);
});

describe("BucketRateLimitService.checkCostLimits — lease windows", () => {
  it("T-BS-1: every configured lease window has budget -> allowed, not fail-open", async () => {
    getCostLease.mockResolvedValue(makeLease({ remainingBudget: 10 }));
    const result = await BucketRateLimitService.checkCostLimits(
      makeBucket({ limit5hUsd: 100, dailyLimitUsd: 200 })
    );
    expect(result).toEqual({ allowed: true, failOpen: false });
    expect(getCostLease).toHaveBeenCalledTimes(2);
  });

  it("T-BS-2: a depleted lease blocks and reports its window/usage/limit", async () => {
    getCostLease.mockResolvedValue(makeLease({ remainingBudget: 0, currentUsage: 100 }));
    const result = await BucketRateLimitService.checkCostLimits(makeBucket({ limit5hUsd: 100 }));
    expect(result.allowed).toBe(false);
    expect(result.window).toBe("5h");
    expect(result.currentUsage).toBe(100);
    expect(result.limitValue).toBe(100);
  });

  it("T-BS-3: windows without a positive limit are skipped (no lease lookup)", async () => {
    getCostLease.mockResolvedValue(makeLease({ remainingBudget: 5 }));
    await BucketRateLimitService.checkCostLimits(
      makeBucket({ dailyLimitUsd: 0, limit5hUsd: null })
    );
    expect(getCostLease).not.toHaveBeenCalled();
  });

  it("T-BS-4: a failed lease lookup (null) sets fail-open without blocking", async () => {
    getCostLease.mockResolvedValue(null);
    const result = await BucketRateLimitService.checkCostLimits(makeBucket({ limit5hUsd: 100 }));
    expect(result).toEqual({ allowed: true, failOpen: true });
  });

  it("T-BS-7: a lease violation takes precedence over the total window", async () => {
    getCostLease.mockResolvedValue(
      makeLease({ window: "5h", remainingBudget: 0, currentUsage: 99 })
    );
    sumScopeCost.mockResolvedValue(99999);
    const result = await BucketRateLimitService.checkCostLimits(
      makeBucket({ limit5hUsd: 100, limitTotalUsd: 100 })
    );
    expect(result.allowed).toBe(false);
    expect(result.window).toBe("5h");
  });

  it("T-BS-8: a thrown error fails open", async () => {
    getCostLease.mockRejectedValue(new Error("redis exploded"));
    const result = await BucketRateLimitService.checkCostLimits(makeBucket({ limit5hUsd: 100 }));
    expect(result).toEqual({ allowed: true, failOpen: true });
  });
});

describe("BucketRateLimitService.checkCostLimits — total window (OPT-A)", () => {
  it("T-BS-5: total usage at/over the cap blocks on the total window", async () => {
    sumScopeCost.mockResolvedValue(150);
    const result = await BucketRateLimitService.checkCostLimits(makeBucket({ limitTotalUsd: 100 }));
    expect(result.allowed).toBe(false);
    expect(result.window).toBe("total");
    expect(result.currentUsage).toBe(150);
    expect(result.limitValue).toBe(100);
  });

  it("T-BS-6: total usage under the cap is allowed", async () => {
    sumScopeCost.mockResolvedValue(40);
    const result = await BucketRateLimitService.checkCostLimits(makeBucket({ limitTotalUsd: 100 }));
    expect(result).toEqual({ allowed: true, failOpen: false });
  });

  it("total window is not evaluated when no total cap is configured", async () => {
    await BucketRateLimitService.checkCostLimits(makeBucket({ limit5hUsd: null }));
    expect(sumScopeCost).not.toHaveBeenCalled();
  });

  it("T-TA-1: a fresh cache hit is used and skips the DB aggregation", async () => {
    getRedis.mockReturnValue(makeReadyRedis("80") as never);
    const result = await BucketRateLimitService.checkCostLimits(makeBucket({ limitTotalUsd: 100 }));
    expect(result.allowed).toBe(true);
    expect(sumScopeCost).not.toHaveBeenCalled();
  });

  it("T-TA-2: a cache miss aggregates from DB and writes the value back", async () => {
    const redis = makeReadyRedis(null);
    getRedis.mockReturnValue(redis as never);
    sumScopeCost.mockResolvedValue(64);
    await BucketRateLimitService.checkCostLimits(makeBucket({ limitTotalUsd: 100 }));
    expect(sumScopeCost).toHaveBeenCalledTimes(1);
    expect(redis.setex).toHaveBeenCalledWith("total_cost:model:user:7:42", 60, "64");
  });

  it("T-TA-3: a non-ready Redis client falls back to DB aggregation", async () => {
    getRedis.mockReturnValue(null as never);
    sumScopeCost.mockResolvedValue(10);
    await BucketRateLimitService.checkCostLimits(makeBucket({ limitTotalUsd: 100 }));
    expect(sumScopeCost).toHaveBeenCalledTimes(1);
  });

  it("a non-numeric cached value is ignored and the DB value is used", async () => {
    getRedis.mockReturnValue(makeReadyRedis("not-a-number") as never);
    sumScopeCost.mockResolvedValue(55);
    const result = await BucketRateLimitService.checkCostLimits(makeBucket({ limitTotalUsd: 100 }));
    expect(sumScopeCost).toHaveBeenCalledTimes(1);
    expect(result.allowed).toBe(true);
  });
});

describe("BucketRateLimitService.decrementLease", () => {
  it("decrements only the windows that have a positive limit", async () => {
    await BucketRateLimitService.decrementLease(
      makeBucket({ limit5hUsd: 100, dailyLimitUsd: 50 }),
      3
    );
    expect(decrementLeaseBudget).toHaveBeenCalledTimes(2);
    const windows = decrementLeaseBudget.mock.calls.map(([p]) => p.window);
    expect(windows).toEqual(["5h", "daily"]);
    for (const [params] of decrementLeaseBudget.mock.calls) {
      expect(params.cost).toBe(3);
      expect(params.modelGroupId).toBe(42);
    }
  });

  it("does nothing when no window has a positive limit", async () => {
    await BucketRateLimitService.decrementLease(makeBucket(), 5);
    expect(decrementLeaseBudget).not.toHaveBeenCalled();
  });
});
