import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: vi.fn(async () => "UTC"),
}));

const redisClient = {
  status: "ready",
  eval: vi.fn(),
  get: vi.fn(async () => null),
  set: vi.fn(async () => "OK"),
  exists: vi.fn(async () => 0),
};

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => redisClient,
}));

const cacheMock = {
  getCachedRollingCost: vi.fn(async () => null as number | null),
  setCachedRollingCost: vi.fn(async () => undefined),
  mgetCachedRollingCost: vi.fn(async () => [] as Array<number | null>),
  buildCostDisplayCacheKey: vi.fn(
    (t: string, id: number, p: string) => `cost_cache:${t}:${id}:${p}_rolling`
  ),
};

vi.mock("@/lib/redis/cost-display-cache", () => cacheMock);

const statisticsMock = {
  sumKeyTotalCost: vi.fn(async () => 0),
  sumUserTotalCost: vi.fn(async () => 0),
  sumProviderTotalCost: vi.fn(async () => 0),
  sumKeyCostInTimeRange: vi.fn(async () => 0),
  sumProviderCostInTimeRange: vi.fn(async () => 0),
  sumUserCostInTimeRange: vi.fn(async () => 0),
  findKeyCostEntriesInTimeRange: vi.fn(async () => []),
  findProviderCostEntriesInTimeRange: vi.fn(async () => []),
  findUserCostEntriesInTimeRange: vi.fn(async () => []),
};

vi.mock("@/repository/statistics", () => statisticsMock);

describe("getCurrentCost (rolling) — DB authoritative + display cache", () => {
  const nowMs = 1_700_000_000_000;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    redisClient.get.mockResolvedValue(null);
    cacheMock.getCachedRollingCost.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("5h rolling cache hit returns cache value without touching DB or ZSET", async () => {
    cacheMock.getCachedRollingCost.mockResolvedValueOnce(4.25);

    const { RateLimitService } = await import("@/lib/rate-limit");
    const current = await RateLimitService.getCurrentCost(1, "key", "5h");

    expect(current).toBeCloseTo(4.25, 10);
    expect(redisClient.eval).not.toHaveBeenCalled();
    expect(statisticsMock.sumKeyCostInTimeRange).not.toHaveBeenCalled();
    expect(statisticsMock.findKeyCostEntriesInTimeRange).not.toHaveBeenCalled();
    expect(cacheMock.setCachedRollingCost).not.toHaveBeenCalled();
  });

  it("5h rolling cache miss queries DB SUM and writes back to cache", async () => {
    cacheMock.getCachedRollingCost.mockResolvedValueOnce(null);
    statisticsMock.sumKeyCostInTimeRange.mockResolvedValueOnce(3.5);

    const { RateLimitService } = await import("@/lib/rate-limit");
    const current = await RateLimitService.getCurrentCost(1, "key", "5h");

    expect(current).toBeCloseTo(3.5, 10);
    expect(statisticsMock.sumKeyCostInTimeRange).toHaveBeenCalledTimes(1);
    expect(redisClient.eval).not.toHaveBeenCalled();
    expect(cacheMock.setCachedRollingCost).toHaveBeenCalledWith(redisClient, "key", 1, "5h", 3.5);
  });

  it("user 5h rolling clips start time by the later 5h reset marker", async () => {
    const limit5hCostResetAt = new Date(nowMs - 2 * 60 * 60 * 1000);
    cacheMock.getCachedRollingCost.mockResolvedValueOnce(null);
    statisticsMock.sumUserCostInTimeRange.mockResolvedValueOnce(2.5);

    const { RateLimitService } = await import("@/lib/rate-limit");
    const current = await RateLimitService.getCurrentCost(7, "user", "5h", "00:00", "rolling", {
      costResetAt: new Date(nowMs - 3 * 60 * 60 * 1000),
      limit5hCostResetAt,
    });

    expect(current).toBeCloseTo(2.5, 10);
    const [calledUserId, calledStart, calledEnd] =
      statisticsMock.sumUserCostInTimeRange.mock.calls[0];
    expect(calledUserId).toBe(7);
    expect(calledStart).toEqual(limit5hCostResetAt);
    expect(calledEnd).toEqual(new Date(nowMs));
  });

  it("daily rolling cache miss queries DB SUM and writes back to cache", async () => {
    cacheMock.getCachedRollingCost.mockResolvedValueOnce(null);
    statisticsMock.sumProviderCostInTimeRange.mockResolvedValueOnce(7.25);

    const { RateLimitService } = await import("@/lib/rate-limit");
    const current = await RateLimitService.getCurrentCost(
      45,
      "provider",
      "daily",
      "00:00",
      "rolling"
    );

    expect(current).toBeCloseTo(7.25, 10);
    expect(statisticsMock.sumProviderCostInTimeRange).toHaveBeenCalledTimes(1);
    expect(redisClient.eval).not.toHaveBeenCalled();
    expect(cacheMock.setCachedRollingCost).toHaveBeenCalledWith(
      redisClient,
      "provider",
      45,
      "daily",
      7.25
    );
  });

  it("does not warm cache when Redis is unavailable, but still returns DB value", async () => {
    cacheMock.getCachedRollingCost.mockResolvedValueOnce(null);
    statisticsMock.sumKeyCostInTimeRange.mockResolvedValueOnce(1.0);
    redisClient.status = "end" as unknown as "ready";

    try {
      const { RateLimitService } = await import("@/lib/rate-limit");
      const current = await RateLimitService.getCurrentCost(1, "key", "5h");
      expect(current).toBeCloseTo(1.0, 10);
      expect(cacheMock.setCachedRollingCost).not.toHaveBeenCalled();
    } finally {
      redisClient.status = "ready";
    }
  });
});
