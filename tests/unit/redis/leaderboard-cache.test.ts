import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRedisClient } from "@/lib/redis/client";
import { getLeaderboardWithCache } from "@/lib/redis/leaderboard-cache";
import {
  findDailyUserCacheHitRateLeaderboard,
  type UserCacheHitRateLeaderboardEntry,
} from "@/repository/leaderboard";

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

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: vi.fn().mockResolvedValue("UTC"),
}));

vi.mock("@/repository/leaderboard", async () => {
  const actual = await vi.importActual<typeof import("@/repository/leaderboard")>(
    "@/repository/leaderboard"
  );

  return {
    ...actual,
    findDailyUserCacheHitRateLeaderboard: vi.fn(),
  };
});

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

function createUserCacheHitRateRows(): UserCacheHitRateLeaderboardEntry[] {
  return [
    {
      userId: 1,
      userName: "alice",
      totalRequests: 12,
      totalCost: 1.23,
      cacheReadTokens: 456,
      cacheCreationCost: 0.45,
      totalInputTokens: 789,
      totalTokens: 789,
      cacheHitRate: 0.577,
    },
  ];
}

describe("getLeaderboardWithCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("passes user filters to userCacheHitRate queries on Redis cache miss", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-13T00:00:00Z"));

    const redis = createRedisMock();
    const rows = createUserCacheHitRateRows();
    redis.get.mockResolvedValueOnce(null);
    redis.set.mockResolvedValueOnce("OK");
    redis.setex.mockResolvedValueOnce("OK");
    redis.del.mockResolvedValueOnce(1);

    vi.mocked(getRedisClient).mockReturnValue(
      redis as unknown as NonNullable<ReturnType<typeof getRedisClient>>
    );
    vi.mocked(findDailyUserCacheHitRateLeaderboard).mockResolvedValueOnce(rows);

    const result = await getLeaderboardWithCache("daily", "USD", "userCacheHitRate", undefined, {
      userTags: ["vip", "team-a"],
      userGroups: ["group-1"],
      includeModelStats: true,
    });

    expect(result).toEqual(rows);
    expect(findDailyUserCacheHitRateLeaderboard).toHaveBeenCalledWith(
      { userTags: ["vip", "team-a"], userGroups: ["group-1"] },
      true
    );
    expect(redis.setex).toHaveBeenCalledWith(
      "leaderboard:userCacheHitRate:daily:2026-04-13:USD:includeModelStats:tags:team-a,vip:groups:group-1",
      60,
      JSON.stringify(rows)
    );
  });

  it("falls back to direct query when Redis is unavailable and still preserves userCacheHitRate filters", async () => {
    const rows = createUserCacheHitRateRows();
    vi.mocked(getRedisClient).mockReturnValue(null);
    vi.mocked(findDailyUserCacheHitRateLeaderboard).mockResolvedValueOnce(rows);

    const result = await getLeaderboardWithCache("daily", "USD", "userCacheHitRate", undefined, {
      userTags: ["vip"],
      userGroups: ["group-1"],
    });

    expect(result).toEqual(rows);
    expect(findDailyUserCacheHitRateLeaderboard).toHaveBeenCalledWith(
      { userTags: ["vip"], userGroups: ["group-1"] },
      undefined
    );
  });
});
