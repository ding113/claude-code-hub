import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pipelineCommands: Array<unknown[]> = [];

const pipeline = {
  zadd: vi.fn((...args: unknown[]) => {
    pipelineCommands.push(["zadd", ...args]);
    return pipeline;
  }),
  expire: vi.fn((...args: unknown[]) => {
    pipelineCommands.push(["expire", ...args]);
    return pipeline;
  }),
  exec: vi.fn(async () => {
    pipelineCommands.push(["exec"]);
    return [];
  }),
  incrbyfloat: vi.fn(() => pipeline),
  zremrangebyscore: vi.fn(() => pipeline),
  zcard: vi.fn(() => pipeline),
};

const redisClient = {
  status: "ready",
  eval: vi.fn(async () => "0"),
  exists: vi.fn(async () => 1),
  get: vi.fn(async () => null),
  set: vi.fn(async () => "OK"),
  setex: vi.fn(async () => "OK"),
  pipeline: vi.fn(() => pipeline),
};

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => redisClient,
}));

const statisticsMock = {
  // total cost
  sumKeyTotalCost: vi.fn(async () => 0),
  sumUserTotalCost: vi.fn(async () => 0),
  sumProviderTotalCost: vi.fn(async () => 0),

  // fixed-window sums
  sumKeyCostInTimeRange: vi.fn(async () => 0),
  sumProviderCostInTimeRange: vi.fn(async () => 0),
  sumUserCostInTimeRange: vi.fn(async () => 0),

  // rolling-window entries
  findKeyCostEntriesInTimeRange: vi.fn(async () => []),
  findProviderCostEntriesInTimeRange: vi.fn(async () => []),
  findUserCostEntriesInTimeRange: vi.fn(async () => []),
};

vi.mock("@/repository/statistics", () => statisticsMock);

describe("RateLimitService - cost limits and quota checks", () => {
  const nowMs = 1_700_000_000_000;

  beforeEach(() => {
    pipelineCommands.length = 0;
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("checkCostLimits：未设置任何限额时应直接放行", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    const result = await RateLimitService.checkCostLimits(1, "key", {
      limit_5h_usd: null,
      limit_daily_usd: null,
      limit_weekly_usd: null,
      limit_monthly_usd: null,
    });

    expect(result).toEqual({ allowed: true });
    expect(redisClient.eval).not.toHaveBeenCalled();
    expect(redisClient.get).not.toHaveBeenCalled();
  });

  it("checkCostLimits：Key 每日 fixed 超限时应返回 not allowed", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    redisClient.get.mockImplementation(async (key: string) => {
      if (key === "key:1:cost_daily_0000") return "12";
      return "0";
    });

    const result = await RateLimitService.checkCostLimits(1, "key", {
      limit_5h_usd: null,
      limit_daily_usd: 10,
      daily_reset_mode: "fixed",
      daily_reset_time: "00:00",
      limit_weekly_usd: null,
      limit_monthly_usd: null,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Key 每日消费上限已达到（12.0000/10）");
  });

  it("checkCostLimits：Provider 每日 rolling 超限时应返回 not allowed", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    redisClient.eval.mockResolvedValueOnce("11");

    const result = await RateLimitService.checkCostLimits(9, "provider", {
      limit_5h_usd: null,
      limit_daily_usd: 10,
      daily_reset_mode: "rolling",
      daily_reset_time: "00:00",
      limit_weekly_usd: null,
      limit_monthly_usd: null,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("供应商 每日消费上限已达到（11.0000/10）");
  });

  it("checkCostLimits：User fast-path 的类型标识应为 User（避免错误标为“供应商”）", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    redisClient.get.mockImplementation(async (key: string) => {
      if (key === "user:1:cost_weekly") return "20";
      return "0";
    });

    const result = await RateLimitService.checkCostLimits(1, "user", {
      limit_5h_usd: null,
      limit_daily_usd: null,
      limit_weekly_usd: 10,
      limit_monthly_usd: null,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("User 周消费上限已达到（20.0000/10）");
  });

  it("checkCostLimits：Redis cache miss 时应 fallback 到 DB 查询", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    redisClient.get.mockResolvedValueOnce(null);
    statisticsMock.sumKeyCostInTimeRange.mockResolvedValueOnce(20);

    const result = await RateLimitService.checkCostLimits(1, "key", {
      limit_5h_usd: null,
      limit_daily_usd: 10,
      daily_reset_mode: "fixed",
      daily_reset_time: "00:00",
      limit_weekly_usd: null,
      limit_monthly_usd: null,
    });

    expect(result.allowed).toBe(false);
    expect(statisticsMock.sumKeyCostInTimeRange).toHaveBeenCalledTimes(1);
    expect(redisClient.set).toHaveBeenCalled();
  });

  it("checkTotalCostLimit：limitTotalUsd 未设置时应放行", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    expect(await RateLimitService.checkTotalCostLimit(1, "user", null)).toEqual({ allowed: true });
    expect(await RateLimitService.checkTotalCostLimit(1, "user", undefined as any)).toEqual({
      allowed: true,
    });
    expect(await RateLimitService.checkTotalCostLimit(1, "user", 0)).toEqual({ allowed: true });
  });

  it("checkTotalCostLimit：Key 缺失 keyHash 时应跳过 enforcement", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    const result = await RateLimitService.checkTotalCostLimit(1, "key", 10, undefined);
    expect(result).toEqual({ allowed: true });
  });

  it("checkTotalCostLimit：Redis cache hit 且已超限时应返回 not allowed", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    redisClient.get.mockImplementation(async (key: string) => {
      if (key === "total_cost:user:7") return "20";
      return null;
    });

    const result = await RateLimitService.checkTotalCostLimit(7, "user", 10);
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(20);
  });

  it("checkTotalCostLimit：Redis miss 时应 fallback DB 并写回缓存", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    redisClient.get.mockResolvedValueOnce(null);
    statisticsMock.sumUserTotalCost.mockResolvedValueOnce(5);

    const result = await RateLimitService.checkTotalCostLimit(7, "user", 10);
    expect(result.allowed).toBe(true);
    expect(result.current).toBe(5);
    expect(redisClient.setex).toHaveBeenCalledWith("total_cost:user:7", 300, "5");
  });

  it("checkTotalCostLimit：Provider Redis miss 时应 fallback DB 并写回缓存（cache key 应包含 resetAt）", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    const resetAt = new Date(nowMs - 123_000);

    redisClient.get.mockResolvedValueOnce(null);
    statisticsMock.sumProviderTotalCost.mockResolvedValueOnce(5);

    const result = await RateLimitService.checkTotalCostLimit(9, "provider", 10, {
      resetAt,
    });

    expect(result.allowed).toBe(true);
    expect(result.current).toBe(5);
    expect(statisticsMock.sumProviderTotalCost).toHaveBeenCalledTimes(1);
    expect(statisticsMock.sumProviderTotalCost).toHaveBeenCalledWith(9, resetAt);
    expect(redisClient.setex).toHaveBeenCalledWith(
      `total_cost:provider:9:${resetAt.getTime()}`,
      300,
      "5"
    );
  });

  it("checkTotalCostLimit：Provider resetAt 为空时应使用 none key 并回退到 DB", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    redisClient.get.mockResolvedValueOnce(null);
    statisticsMock.sumProviderTotalCost.mockResolvedValueOnce(5);

    const result = await RateLimitService.checkTotalCostLimit(9, "provider", 10, {
      resetAt: null,
    });

    expect(result.allowed).toBe(true);
    expect(result.current).toBe(5);
    expect(statisticsMock.sumProviderTotalCost).toHaveBeenCalledWith(9, null);
    expect(redisClient.setex).toHaveBeenCalledWith("total_cost:provider:9:none", 300, "5");
  });

  it("checkTotalCostLimit：Provider Redis cache hit 且已超限时应返回 not allowed（按 resetAt key 命中）", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    const resetAt = new Date(nowMs - 456_000);

    redisClient.get.mockImplementation(async (key: string) => {
      if (key === `total_cost:provider:9:${resetAt.getTime()}`) return "20";
      return null;
    });

    const result = await RateLimitService.checkTotalCostLimit(9, "provider", 10, {
      resetAt,
    });
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(20);
  });

  it("checkUserDailyCost：fixed 模式 cache hit 超限时应拦截", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    redisClient.get.mockImplementation(async (key: string) => {
      if (key === "user:1:cost_daily_0000") return "20";
      return null;
    });

    const result = await RateLimitService.checkUserDailyCost(1, 10, "00:00", "fixed");
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(20);
  });

  it("checkUserDailyCost：fixed 模式 cache miss 时应 fallback DB 并写回缓存", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    redisClient.get.mockResolvedValueOnce(null);
    statisticsMock.sumUserCostInTimeRange.mockResolvedValueOnce(12);

    const result = await RateLimitService.checkUserDailyCost(1, 10, "00:00", "fixed");
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(12);
    expect(redisClient.set).toHaveBeenCalled();
  });

  it("checkUserDailyCost：rolling 模式 cache miss 时应走明细查询并 warm ZSET", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    redisClient.eval.mockResolvedValueOnce("0");
    redisClient.exists.mockResolvedValueOnce(0);
    statisticsMock.findUserCostEntriesInTimeRange.mockResolvedValueOnce([
      { id: 101, createdAt: new Date(nowMs - 60_000), costUsd: 3 },
      { id: 102, createdAt: new Date(nowMs - 30_000), costUsd: 8 },
    ]);

    const result = await RateLimitService.checkUserDailyCost(1, 10, "00:00", "rolling");
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(11);

    const zaddCalls = pipelineCommands.filter((c) => c[0] === "zadd");
    expect(zaddCalls).toHaveLength(2);
    expect(pipelineCommands.some((c) => c[0] === "expire")).toBe(true);
  });
});
