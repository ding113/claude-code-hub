import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/redis", () => ({ getRedisClient: vi.fn() }));
vi.mock("@/repository/statistics", () => ({ sumScopeCostByModelsInTimeRange: vi.fn() }));
vi.mock("@/lib/config/system-settings-cache", () => ({ getCachedSystemSettings: vi.fn() }));
vi.mock("@/lib/model-rate-limit/lease", () => ({
  ModelLeaseService: { decrementLeaseBudget: vi.fn() },
}));

import { getCachedSystemSettings } from "@/lib/config/system-settings-cache";
import { BucketLeaseService } from "@/lib/model-rate-limit/bucket-lease";
import { buildModelGroupLeaseKey } from "@/lib/model-rate-limit/keys";
import { ModelLeaseService } from "@/lib/model-rate-limit/lease";
import { createBudgetLease, serializeLease } from "@/lib/rate-limit/lease";
import { getRedisClient } from "@/lib/redis";
import { sumScopeCostByModelsInTimeRange } from "@/repository/statistics";

const getRedis = vi.mocked(getRedisClient);
const sumScopeCost = vi.mocked(sumScopeCostByModelsInTimeRange);
const getSettings = vi.mocked(getCachedSystemSettings);
const decrementModelLease = vi.mocked(ModelLeaseService.decrementLeaseBudget);

const baseParams = {
  axis: "user" as const,
  scopeId: 7,
  modelGroupId: 42,
  models: ["m-a", "m-b"],
  window: "daily" as const,
  limitAmount: 100,
  resetTime: "00:00",
  resetMode: "fixed" as const,
};

function makeReadyRedis(getValue: string | null) {
  return {
    status: "ready",
    get: vi.fn().mockResolvedValue(getValue),
    setex: vi.fn().mockResolvedValue("OK"),
  };
}

function cachedLeaseString(overrides: Partial<Parameters<typeof createBudgetLease>[0]> = {}) {
  return serializeLease(
    createBudgetLease({
      entityType: "user",
      entityId: 7,
      window: "daily",
      resetMode: "fixed",
      resetTime: "00:00",
      snapshotAtMs: Date.now(),
      currentUsage: 10,
      limitAmount: 100,
      remainingBudget: 5,
      ttlSeconds: 300,
      ...overrides,
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getRedis.mockReturnValue(null as never);
  sumScopeCost.mockResolvedValue(20);
  getSettings.mockResolvedValue({
    quotaDbRefreshIntervalSeconds: 10,
    quotaLeaseCapUsd: null,
    quotaModelLeaseMinSliceUsd: null,
    quotaModelLeasePercentDaily: null,
    quotaLeasePercentDaily: 0.05,
  } as never);
  decrementModelLease.mockResolvedValue({ allowed: true } as never);
});

describe("BucketLeaseService.getCostLease", () => {
  it("returns a fresh, matching cached lease without touching the DB", async () => {
    getRedis.mockReturnValue(makeReadyRedis(cachedLeaseString()) as never);
    const lease = await BucketLeaseService.getCostLease(baseParams);
    expect(lease?.remainingBudget).toBe(5);
    expect(lease?.currentUsage).toBe(10);
    expect(sumScopeCost).not.toHaveBeenCalled();
  });

  it("refreshes from the DB when the cached lease limit no longer matches", async () => {
    getRedis.mockReturnValue(makeReadyRedis(cachedLeaseString({ limitAmount: 999 })) as never);
    const lease = await BucketLeaseService.getCostLease(baseParams);
    expect(sumScopeCost).toHaveBeenCalledTimes(1);
    expect(lease?.limitAmount).toBe(100);
  });

  it("refreshes from the DB when Redis is unavailable", async () => {
    getRedis.mockReturnValue(null as never);
    await BucketLeaseService.getCostLease(baseParams);
    expect(sumScopeCost).toHaveBeenCalledTimes(1);
  });

  it("fails open (null) when the cache read throws", async () => {
    const redis = makeReadyRedis(null);
    redis.get.mockRejectedValue(new Error("redis down"));
    getRedis.mockReturnValue(redis as never);
    const lease = await BucketLeaseService.getCostLease(baseParams);
    expect(lease).toBeNull();
  });
});

describe("BucketLeaseService.refreshCostLeaseFromDb", () => {
  it("builds a lease from the DB usage and the OPT-B slice", async () => {
    sumScopeCost.mockResolvedValue(20);
    const lease = await BucketLeaseService.refreshCostLeaseFromDb(baseParams);
    // base slice = limit(100) * percent(0.05) = 5; remaining(80) does not clamp it
    expect(lease?.currentUsage).toBe(20);
    expect(lease?.remainingBudget).toBe(5);
    expect(lease?.limitAmount).toBe(100);
  });

  it("uses costResetAt as the window start when it is later than the natural start", async () => {
    const costResetAt = new Date();
    await BucketLeaseService.refreshCostLeaseFromDb({ ...baseParams, costResetAt });
    const startArg = sumScopeCost.mock.calls[0]?.[3];
    expect(startArg).toBe(costResetAt);
  });

  it("writes the refreshed lease back to Redis when ready", async () => {
    const redis = makeReadyRedis(null);
    getRedis.mockReturnValue(redis as never);
    await BucketLeaseService.refreshCostLeaseFromDb(baseParams);
    const expectedKey = buildModelGroupLeaseKey("user", 7, 42, "daily", "fixed");
    expect(redis.setex).toHaveBeenCalledWith(expectedKey, 10, expect.any(String));
  });

  it("returns null when the DB aggregation throws", async () => {
    sumScopeCost.mockRejectedValue(new Error("db down"));
    const lease = await BucketLeaseService.refreshCostLeaseFromDb(baseParams);
    expect(lease).toBeNull();
  });
});

describe("BucketLeaseService.decrementLeaseBudget", () => {
  it("delegates to the shared atomic decrement with a model-group lease key override", async () => {
    await BucketLeaseService.decrementLeaseBudget({
      axis: "key",
      scopeId: 3,
      modelGroupId: 9,
      window: "weekly",
      cost: 2.5,
      resetMode: "fixed",
    });

    const expectedKey = buildModelGroupLeaseKey("key", 3, 9, "weekly", "fixed");
    expect(decrementModelLease).toHaveBeenCalledWith({
      scopeType: "key",
      scopeId: 3,
      model: "",
      window: "weekly",
      cost: 2.5,
      resetMode: "fixed",
      leaseKeyOverride: expectedKey,
    });
  });
});
