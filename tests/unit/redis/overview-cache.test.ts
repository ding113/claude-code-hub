import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRedisClient } from "@/lib/redis/client";
import { getOverviewWithCache, invalidateOverviewCache } from "@/lib/redis/overview-cache";
import {
  getOverviewMetricsWithComparison,
  type OverviewMetricsWithComparison,
} from "@/repository/overview";

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/redis/client", () => ({
  getRedisClient: vi.fn(),
}));

vi.mock("@/repository/overview", () => ({
  getOverviewMetricsWithComparison: vi.fn(),
}));

type RedisMock = {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  setex: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
};

function createRedisMock(): RedisMock {
  return {
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
  };
}

function createOverviewData(): OverviewMetricsWithComparison {
  return {
    todayRequests: 100,
    todayCost: 12.34,
    avgResponseTime: 210,
    todayErrorRate: 1.25,
    yesterdaySamePeriodRequests: 80,
    yesterdaySamePeriodCost: 10.1,
    yesterdaySamePeriodAvgResponseTime: 230,
    recentMinuteRequests: 3,
  };
}

describe("getOverviewWithCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns cached data on cache hit (no DB call)", async () => {
    const data = createOverviewData();
    const redis = createRedisMock();
    redis.get.mockResolvedValueOnce(JSON.stringify(data));

    vi.mocked(getRedisClient).mockReturnValue(
      redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
    );

    const result = await getOverviewWithCache();

    expect(result).toEqual(data);
    expect(redis.get).toHaveBeenCalledWith("overview:global");
    expect(getOverviewMetricsWithComparison).not.toHaveBeenCalled();
  });

  it("calls DB on cache miss, stores in Redis with 10s TTL", async () => {
    const data = createOverviewData();
    const redis = createRedisMock();
    redis.get.mockResolvedValueOnce(null);
    redis.set.mockResolvedValueOnce("OK");
    redis.setex.mockResolvedValueOnce("OK");
    redis.del.mockResolvedValueOnce(1);

    vi.mocked(getRedisClient).mockReturnValue(
      redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
    );
    vi.mocked(getOverviewMetricsWithComparison).mockResolvedValueOnce(data);

    const result = await getOverviewWithCache(42);

    expect(result).toEqual(data);
    expect(getOverviewMetricsWithComparison).toHaveBeenCalledWith(42);
    expect(redis.set).toHaveBeenCalledWith("overview:user:42:lock", "1", "EX", 5, "NX");
    expect(redis.setex).toHaveBeenCalledWith("overview:user:42", 10, JSON.stringify(data));
    expect(redis.del).toHaveBeenCalledWith("overview:user:42:lock");
  });

  it("falls back to direct DB query when Redis is unavailable (null client)", async () => {
    const data = createOverviewData();
    vi.mocked(getRedisClient).mockReturnValue(null);
    vi.mocked(getOverviewMetricsWithComparison).mockResolvedValueOnce(data);

    const result = await getOverviewWithCache(7);

    expect(result).toEqual(data);
    expect(getOverviewMetricsWithComparison).toHaveBeenCalledWith(7);
  });

  it("falls back to direct DB query on Redis error", async () => {
    const data = createOverviewData();
    const redis = createRedisMock();
    redis.get.mockRejectedValueOnce(new Error("redis read failed"));

    vi.mocked(getRedisClient).mockReturnValue(
      redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
    );
    vi.mocked(getOverviewMetricsWithComparison).mockResolvedValueOnce(data);

    const result = await getOverviewWithCache();

    expect(result).toEqual(data);
    expect(getOverviewMetricsWithComparison).toHaveBeenCalledWith(undefined);
  });

  it("falls back to direct DB query when lock is held and retry is still empty", async () => {
    vi.useFakeTimers();
    try {
      const data = createOverviewData();
      const redis = createRedisMock();
      redis.get.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      redis.set.mockResolvedValueOnce(null);

      vi.mocked(getRedisClient).mockReturnValue(
        redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
      );
      vi.mocked(getOverviewMetricsWithComparison).mockResolvedValueOnce(data);

      const pending = getOverviewWithCache(99);
      await vi.advanceTimersByTimeAsync(100);
      const result = await pending;

      expect(result).toEqual(data);
      expect(redis.set).toHaveBeenCalledWith("overview:user:99:lock", "1", "EX", 5, "NX");
      expect(redis.get).toHaveBeenNthCalledWith(1, "overview:user:99");
      expect(redis.get).toHaveBeenNthCalledWith(2, "overview:user:99");
      expect(getOverviewMetricsWithComparison).toHaveBeenCalledWith(99);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses different cache keys for global vs user scope", async () => {
    const redis = createRedisMock();
    const data = createOverviewData();

    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue("OK");
    redis.setex.mockResolvedValue("OK");
    redis.del.mockResolvedValue(1);

    vi.mocked(getRedisClient).mockReturnValue(
      redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
    );
    vi.mocked(getOverviewMetricsWithComparison).mockResolvedValue(data);

    await getOverviewWithCache();
    await getOverviewWithCache(42);

    expect(redis.get).toHaveBeenNthCalledWith(1, "overview:global");
    expect(redis.get).toHaveBeenNthCalledWith(2, "overview:user:42");
    expect(redis.setex).toHaveBeenNthCalledWith(1, "overview:global", 10, JSON.stringify(data));
    expect(redis.setex).toHaveBeenNthCalledWith(2, "overview:user:42", 10, JSON.stringify(data));
  });
});

describe("invalidateOverviewCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes the correct cache key", async () => {
    const redis = createRedisMock();
    redis.del.mockResolvedValueOnce(1);

    vi.mocked(getRedisClient).mockReturnValue(
      redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
    );

    await invalidateOverviewCache(42);

    expect(redis.del).toHaveBeenCalledWith("overview:user:42");
  });

  it("does nothing when Redis is unavailable", async () => {
    vi.mocked(getRedisClient).mockReturnValue(null);

    await expect(invalidateOverviewCache(42)).resolves.toBeUndefined();
  });

  it("swallows Redis errors during invalidation", async () => {
    const redis = createRedisMock();
    redis.del.mockRejectedValueOnce(new Error("delete failed"));

    vi.mocked(getRedisClient).mockReturnValue(
      redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
    );

    await expect(invalidateOverviewCache()).resolves.toBeUndefined();
  });
});
