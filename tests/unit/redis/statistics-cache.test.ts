import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRedisClient } from "@/lib/redis/client";
import { getStatisticsWithCache, invalidateStatisticsCache } from "@/lib/redis/statistics-cache";
import {
  getKeyStatisticsFromDB,
  getMixedStatisticsFromDB,
  getUserStatisticsFromDB,
} from "@/repository/statistics";
import type { DatabaseKeyStatRow, DatabaseStatRow } from "@/types/statistics";

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

vi.mock("@/repository/statistics", () => ({
  getUserStatisticsFromDB: vi.fn(),
  getKeyStatisticsFromDB: vi.fn(),
  getMixedStatisticsFromDB: vi.fn(),
}));

type RedisMock = {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  setex: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  keys: ReturnType<typeof vi.fn>;
};

function createRedisMock(): RedisMock {
  return {
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    keys: vi.fn(),
  };
}

function createUserStats(): DatabaseStatRow[] {
  return [
    {
      user_id: 1,
      user_name: "alice",
      date: "2026-02-19",
      api_calls: 10,
      total_cost: "1.23",
    },
  ];
}

function createKeyStats(): DatabaseKeyStatRow[] {
  return [
    {
      key_id: 100,
      key_name: "test-key",
      date: "2026-02-19",
      api_calls: 6,
      total_cost: "0.56",
    },
  ];
}

describe("getStatisticsWithCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns cached data on cache hit", async () => {
    const redis = createRedisMock();
    const cached = createUserStats();
    redis.get.mockResolvedValueOnce(JSON.stringify(cached));

    vi.mocked(getRedisClient).mockReturnValue(
      redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
    );

    const result = await getStatisticsWithCache("today", "users");

    expect(result).toEqual(cached);
    expect(redis.get).toHaveBeenCalledWith("statistics:today:users:global");
    expect(getUserStatisticsFromDB).not.toHaveBeenCalled();
    expect(getKeyStatisticsFromDB).not.toHaveBeenCalled();
    expect(getMixedStatisticsFromDB).not.toHaveBeenCalled();
  });

  it("calls getUserStatisticsFromDB for mode=users on cache miss", async () => {
    const redis = createRedisMock();
    const rows = createUserStats();
    redis.get.mockResolvedValueOnce(null);
    redis.set.mockResolvedValueOnce("OK");
    redis.setex.mockResolvedValueOnce("OK");
    redis.del.mockResolvedValueOnce(1);

    vi.mocked(getRedisClient).mockReturnValue(
      redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
    );
    vi.mocked(getUserStatisticsFromDB).mockResolvedValueOnce(rows);

    const result = await getStatisticsWithCache("today", "users");

    expect(result).toEqual(rows);
    expect(getUserStatisticsFromDB).toHaveBeenCalledWith("today");
    expect(getKeyStatisticsFromDB).not.toHaveBeenCalled();
    expect(getMixedStatisticsFromDB).not.toHaveBeenCalled();
  });

  it("calls getKeyStatisticsFromDB for mode=keys on cache miss", async () => {
    const redis = createRedisMock();
    const rows = createKeyStats();
    redis.get.mockResolvedValueOnce(null);
    redis.set.mockResolvedValueOnce("OK");
    redis.setex.mockResolvedValueOnce("OK");
    redis.del.mockResolvedValueOnce(1);

    vi.mocked(getRedisClient).mockReturnValue(
      redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
    );
    vi.mocked(getKeyStatisticsFromDB).mockResolvedValueOnce(rows);

    const result = await getStatisticsWithCache("7days", "keys", 42);

    expect(result).toEqual(rows);
    expect(getKeyStatisticsFromDB).toHaveBeenCalledWith(42, "7days");
    expect(getUserStatisticsFromDB).not.toHaveBeenCalled();
    expect(getMixedStatisticsFromDB).not.toHaveBeenCalled();
  });

  it("calls getMixedStatisticsFromDB for mode=mixed on cache miss", async () => {
    const redis = createRedisMock();
    const mixedResult = {
      ownKeys: createKeyStats(),
      othersAggregate: createUserStats(),
    };
    redis.get.mockResolvedValueOnce(null);
    redis.set.mockResolvedValueOnce("OK");
    redis.setex.mockResolvedValueOnce("OK");
    redis.del.mockResolvedValueOnce(1);

    vi.mocked(getRedisClient).mockReturnValue(
      redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
    );
    vi.mocked(getMixedStatisticsFromDB).mockResolvedValueOnce(mixedResult);

    const result = await getStatisticsWithCache("30days", "mixed", 42);

    expect(result).toEqual(mixedResult);
    expect(getMixedStatisticsFromDB).toHaveBeenCalledWith(42, "30days");
    expect(getUserStatisticsFromDB).not.toHaveBeenCalled();
    expect(getKeyStatisticsFromDB).not.toHaveBeenCalled();
  });

  it("stores result with 30s TTL", async () => {
    const redis = createRedisMock();
    const rows = createUserStats();
    redis.get.mockResolvedValueOnce(null);
    redis.set.mockResolvedValueOnce("OK");
    redis.setex.mockResolvedValueOnce("OK");
    redis.del.mockResolvedValueOnce(1);

    vi.mocked(getRedisClient).mockReturnValue(
      redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
    );
    vi.mocked(getUserStatisticsFromDB).mockResolvedValueOnce(rows);

    await getStatisticsWithCache("today", "users");

    expect(redis.setex).toHaveBeenCalledWith(
      "statistics:today:users:global",
      30,
      JSON.stringify(rows)
    );
  });

  it("falls back to direct DB on Redis unavailable", async () => {
    const rows = createUserStats();
    vi.mocked(getRedisClient).mockReturnValue(null);
    vi.mocked(getUserStatisticsFromDB).mockResolvedValueOnce(rows);

    const result = await getStatisticsWithCache("today", "users");

    expect(result).toEqual(rows);
    expect(getUserStatisticsFromDB).toHaveBeenCalledWith("today");
  });

  it("uses retry path and returns cached data when lock is held", async () => {
    vi.useFakeTimers();
    try {
      const redis = createRedisMock();
      const rows = createUserStats();
      redis.get.mockResolvedValueOnce(null).mockResolvedValueOnce(JSON.stringify(rows));
      redis.set.mockResolvedValueOnce(null);

      vi.mocked(getRedisClient).mockReturnValue(
        redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
      );

      const pending = getStatisticsWithCache("today", "users");
      await vi.advanceTimersByTimeAsync(100);
      const result = await pending;

      expect(result).toEqual(rows);
      expect(redis.set).toHaveBeenCalledWith(
        "statistics:today:users:global:lock",
        "1",
        "EX",
        5,
        "NX"
      );
      expect(getUserStatisticsFromDB).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to direct DB when retry times out", async () => {
    vi.useFakeTimers();
    try {
      const redis = createRedisMock();
      const rows = createUserStats();
      redis.get.mockResolvedValue(null);
      redis.set.mockResolvedValueOnce(null);

      vi.mocked(getRedisClient).mockReturnValue(
        redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
      );
      vi.mocked(getUserStatisticsFromDB).mockResolvedValueOnce(rows);

      const pending = getStatisticsWithCache("today", "users");
      await vi.advanceTimersByTimeAsync(5100);
      const result = await pending;

      expect(result).toEqual(rows);
      expect(getUserStatisticsFromDB).toHaveBeenCalledWith("today");
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to direct DB on Redis error", async () => {
    const redis = createRedisMock();
    const rows = createUserStats();
    redis.get.mockRejectedValueOnce(new Error("redis get failed"));

    vi.mocked(getRedisClient).mockReturnValue(
      redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
    );
    vi.mocked(getUserStatisticsFromDB).mockResolvedValueOnce(rows);

    const result = await getStatisticsWithCache("today", "users");

    expect(result).toEqual(rows);
    expect(getUserStatisticsFromDB).toHaveBeenCalledWith("today");
  });

  it("uses different cache keys for different timeRanges", async () => {
    const redis = createRedisMock();
    const rows = createUserStats();
    redis.get.mockResolvedValue(JSON.stringify(rows));

    vi.mocked(getRedisClient).mockReturnValue(
      redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
    );

    await getStatisticsWithCache("today", "users");
    await getStatisticsWithCache("7days", "users");

    expect(redis.get).toHaveBeenNthCalledWith(1, "statistics:today:users:global");
    expect(redis.get).toHaveBeenNthCalledWith(2, "statistics:7days:users:global");
  });

  it("uses different cache keys for global vs user scope", async () => {
    const redis = createRedisMock();
    const rows = createUserStats();
    redis.get.mockResolvedValue(JSON.stringify(rows));

    vi.mocked(getRedisClient).mockReturnValue(
      redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
    );

    await getStatisticsWithCache("today", "users");
    await getStatisticsWithCache("today", "users", 42);

    expect(redis.get).toHaveBeenNthCalledWith(1, "statistics:today:users:global");
    expect(redis.get).toHaveBeenNthCalledWith(2, "statistics:today:users:42");
  });
});

describe("invalidateStatisticsCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes all mode keys for a given timeRange", async () => {
    const redis = createRedisMock();
    redis.del.mockResolvedValueOnce(3);

    vi.mocked(getRedisClient).mockReturnValue(
      redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
    );

    await invalidateStatisticsCache("today", 42);

    expect(redis.del).toHaveBeenCalledWith(
      "statistics:today:users:42",
      "statistics:today:keys:42",
      "statistics:today:mixed:42"
    );
  });

  it("deletes all keys for scope when timeRange is undefined", async () => {
    const redis = createRedisMock();
    const matchedKeys = [
      "statistics:today:users:global",
      "statistics:7days:keys:global",
      "statistics:30days:mixed:global",
    ];
    redis.keys.mockResolvedValueOnce(matchedKeys);
    redis.del.mockResolvedValueOnce(matchedKeys.length);

    vi.mocked(getRedisClient).mockReturnValue(
      redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
    );

    await invalidateStatisticsCache(undefined, undefined);

    expect(redis.keys).toHaveBeenCalledWith("statistics:*:*:global");
    expect(redis.del).toHaveBeenCalledWith(...matchedKeys);
  });

  it("does nothing when Redis is unavailable", async () => {
    vi.mocked(getRedisClient).mockReturnValue(null);

    await expect(invalidateStatisticsCache("today", 42)).resolves.toBeUndefined();
  });

  it("does not call del when wildcard query returns no key", async () => {
    const redis = createRedisMock();
    redis.keys.mockResolvedValueOnce([]);

    vi.mocked(getRedisClient).mockReturnValue(
      redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
    );

    await invalidateStatisticsCache(undefined, 42);

    expect(redis.keys).toHaveBeenCalledWith("statistics:*:*:42");
    expect(redis.del).not.toHaveBeenCalled();
  });

  it("swallows Redis errors during invalidation", async () => {
    const redis = createRedisMock();
    redis.del.mockRejectedValueOnce(new Error("delete failed"));

    vi.mocked(getRedisClient).mockReturnValue(
      redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
    );

    await expect(invalidateStatisticsCache("today", 42)).resolves.toBeUndefined();
  });
});
