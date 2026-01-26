import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let redisClientRef: any;

const pipelineCalls: Array<unknown[]> = [];
const makePipeline = () => {
  const pipeline = {
    eval: vi.fn((...args: unknown[]) => {
      pipelineCalls.push(["eval", ...args]);
      return pipeline;
    }),
    get: vi.fn((...args: unknown[]) => {
      pipelineCalls.push(["get", ...args]);
      return pipeline;
    }),
    incrbyfloat: vi.fn((...args: unknown[]) => {
      pipelineCalls.push(["incrbyfloat", ...args]);
      return pipeline;
    }),
    expire: vi.fn((...args: unknown[]) => {
      pipelineCalls.push(["expire", ...args]);
      return pipeline;
    }),
    zremrangebyscore: vi.fn((...args: unknown[]) => {
      pipelineCalls.push(["zremrangebyscore", ...args]);
      return pipeline;
    }),
    zcard: vi.fn((...args: unknown[]) => {
      pipelineCalls.push(["zcard", ...args]);
      return pipeline;
    }),
    zadd: vi.fn((...args: unknown[]) => {
      pipelineCalls.push(["zadd", ...args]);
      return pipeline;
    }),
    exec: vi.fn(async () => {
      pipelineCalls.push(["exec"]);
      return [];
    }),
  };
  return pipeline;
};

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => redisClientRef,
}));

const statisticsMock = {
  // service.ts 顶层静态导入需要这些 export 存在
  sumKeyTotalCost: vi.fn(async () => 0),
  sumUserTotalCost: vi.fn(async () => 0),
  sumUserCostInTimeRange: vi.fn(async () => 0),

  // getCurrentCost / checkCostLimitsFromDatabase 动态导入会解构这些 export
  findKeyCostEntriesInTimeRange: vi.fn(async () => []),
  findProviderCostEntriesInTimeRange: vi.fn(async () => []),
  findUserCostEntriesInTimeRange: vi.fn(async () => []),
  sumKeyCostInTimeRange: vi.fn(async () => 0),
  sumProviderCostInTimeRange: vi.fn(async () => 0),
};

vi.mock("@/repository/statistics", () => statisticsMock);

const sessionTrackerMock = {
  getKeySessionCount: vi.fn(async () => 0),
  getProviderSessionCount: vi.fn(async () => 0),
  getUserSessionCount: vi.fn(async () => 0),
};

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: sessionTrackerMock,
}));

describe("RateLimitService - other quota paths", () => {
  const nowMs = 1_700_000_000_000;

  beforeEach(() => {
    vi.resetAllMocks();
    pipelineCalls.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));

    redisClientRef = {
      status: "ready",
      eval: vi.fn(async () => "0"),
      exists: vi.fn(async () => 1),
      get: vi.fn(async () => null),
      set: vi.fn(async () => "OK"),
      setex: vi.fn(async () => "OK"),
      pipeline: vi.fn(() => makePipeline()),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("checkSessionLimit：limit<=0 时应放行", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    await expect(RateLimitService.checkSessionLimit(1, "key", 0)).resolves.toEqual({
      allowed: true,
    });
  });

  it("checkSessionLimit：Key 并发数达到上限时应拦截", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    sessionTrackerMock.getKeySessionCount.mockResolvedValueOnce(2);

    const result = await RateLimitService.checkSessionLimit(1, "key", 2);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Key并发 Session 上限已达到（2/2）");
  });

  it("checkSessionLimit：Provider 并发数未达上限时应放行", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    sessionTrackerMock.getProviderSessionCount.mockResolvedValueOnce(1);

    await expect(RateLimitService.checkSessionLimit(9, "provider", 2)).resolves.toEqual({
      allowed: true,
    });
  });

  it("checkAndTrackProviderSession：limit<=0 时应放行且不追踪", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    const result = await RateLimitService.checkAndTrackProviderSession(9, "sess", 0);
    expect(result).toEqual({ allowed: true, count: 0, tracked: false });
  });

  it("checkAndTrackProviderSession：Redis 非 ready 时应 Fail Open", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    redisClientRef.status = "end";
    const result = await RateLimitService.checkAndTrackProviderSession(9, "sess", 2);
    expect(result).toEqual({ allowed: true, count: 0, tracked: false });
  });

  it("checkAndTrackProviderSession：达到上限时应返回 not allowed", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    redisClientRef.eval.mockResolvedValueOnce([0, 2, 0]);
    const result = await RateLimitService.checkAndTrackProviderSession(9, "sess", 2);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("供应商并发 Session 上限已达到（2/2）");
  });

  it("checkAndTrackProviderSession：未达到上限时应返回 allowed 且可标记 tracked", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    redisClientRef.eval.mockResolvedValueOnce([1, 1, 1]);
    const result = await RateLimitService.checkAndTrackProviderSession(9, "sess", 2);
    expect(result).toEqual({ allowed: true, count: 1, tracked: true });
  });

  it("trackUserDailyCost：fixed 模式应使用 STRING + TTL", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    await RateLimitService.trackUserDailyCost(1, 1.25, "00:00", "fixed");

    expect(pipelineCalls.some((c) => c[0] === "incrbyfloat")).toBe(true);
    expect(pipelineCalls.some((c) => c[0] === "expire")).toBe(true);
  });

  it("trackUserDailyCost：rolling 模式应使用 ZSET Lua 脚本", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    await RateLimitService.trackUserDailyCost(1, 1.25, "00:00", "rolling", { requestId: 123 });

    expect(redisClientRef.eval).toHaveBeenCalled();
  });

  it("checkUserRPM：达到上限时应拦截", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    const pipeline = makePipeline();
    pipeline.exec
      .mockResolvedValueOnce([
        [null, 0],
        [null, 5], // zcard 返回 5
      ])
      .mockResolvedValueOnce([]); // 写入 pipeline

    redisClientRef.pipeline.mockReturnValueOnce(pipeline);

    const result = await RateLimitService.checkUserRPM(1, 5);
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(5);
  });

  it("checkUserRPM：未达到上限时应写入本次请求并放行", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    const readPipeline = makePipeline();
    readPipeline.exec.mockResolvedValueOnce([
      [null, 0],
      [null, 3], // zcard 返回 3
    ]);

    const writePipeline = makePipeline();
    writePipeline.exec.mockResolvedValueOnce([]);

    redisClientRef.pipeline.mockReturnValueOnce(readPipeline).mockReturnValueOnce(writePipeline);

    const result = await RateLimitService.checkUserRPM(1, 5);
    expect(result.allowed).toBe(true);
    expect(result.current).toBe(4);
    expect(writePipeline.zadd).toHaveBeenCalledTimes(1);
  });

  it("checkRpmLimit：user 类型应复用 checkUserRPM 逻辑", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    const readPipeline = makePipeline();
    readPipeline.exec.mockResolvedValueOnce([
      [null, 0],
      [null, 1],
    ]);

    const writePipeline = makePipeline();
    writePipeline.exec.mockResolvedValueOnce([]);

    redisClientRef.pipeline.mockReturnValueOnce(readPipeline).mockReturnValueOnce(writePipeline);

    const result = await RateLimitService.checkRpmLimit(1, "user", 2);
    expect(result.allowed).toBe(true);
    expect(result.current).toBe(2);
  });

  it("getCurrentCostBatch：providerIds 为空时应返回空 Map", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    const result = await RateLimitService.getCurrentCostBatch([], new Map());
    expect(result.size).toBe(0);
  });

  it("getCurrentCostBatch：Redis 非 ready 时应返回默认 0", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    redisClientRef.status = "end";
    const result = await RateLimitService.getCurrentCostBatch([1], new Map());
    expect(result.get(1)).toEqual({ cost5h: 0, costDaily: 0, costWeekly: 0, costMonthly: 0 });
  });

  it("getCurrentCostBatch：应按 pipeline 返回解析 5h/daily/weekly/monthly", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    const pipeline = makePipeline();
    // queryMeta: 5h(eval), daily(get fixed), weekly(get), monthly(get)
    pipeline.exec.mockResolvedValueOnce([
      [null, "1.5"],
      [null, "2.5"],
      [null, "3.5"],
      [null, "4.5"],
    ]);
    redisClientRef.pipeline.mockReturnValueOnce(pipeline);

    const dailyResetConfigs = new Map<
      number,
      { resetTime?: string | null; resetMode?: string | null }
    >();
    dailyResetConfigs.set(1, { resetTime: "00:00", resetMode: "fixed" });

    const result = await RateLimitService.getCurrentCostBatch([1], dailyResetConfigs);
    expect(result.get(1)).toEqual({
      cost5h: 1.5,
      costDaily: 2.5,
      costWeekly: 3.5,
      costMonthly: 4.5,
    });
  });

  it("checkCostLimits：5h 滚动窗口超限时应返回 not allowed", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    redisClientRef.eval.mockResolvedValueOnce("11");
    const result = await RateLimitService.checkCostLimits(1, "provider", {
      limit_5h_usd: 10,
      limit_daily_usd: null,
      limit_weekly_usd: null,
      limit_monthly_usd: null,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("供应商 5小时消费上限已达到（11.0000/10）");
  });

  it("checkCostLimits：daily rolling cache miss 时应回退 DB 并 warm ZSET", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    redisClientRef.eval.mockResolvedValueOnce("0");
    redisClientRef.exists.mockResolvedValueOnce(0);
    statisticsMock.findProviderCostEntriesInTimeRange.mockResolvedValueOnce([
      { id: 101, createdAt: new Date(nowMs - 60_000), costUsd: 3 },
      { id: 102, createdAt: new Date(nowMs - 30_000), costUsd: 9 },
    ]);

    const result = await RateLimitService.checkCostLimits(9, "provider", {
      limit_5h_usd: null,
      limit_daily_usd: 10,
      daily_reset_mode: "rolling",
      daily_reset_time: "00:00",
      limit_weekly_usd: null,
      limit_monthly_usd: null,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("供应商 每日消费上限已达到（12.0000/10）");
    expect(pipelineCalls.some((c) => c[0] === "zadd")).toBe(true);
  });

  it("getCurrentCost：daily fixed cache hit 时应直接返回当前值", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    redisClientRef.get.mockImplementation(async (key: string) => {
      if (key === "provider:9:cost_daily_0000") return "7.5";
      return null;
    });

    const current = await RateLimitService.getCurrentCost(9, "provider", "daily", "00:00", "fixed");
    expect(current).toBeCloseTo(7.5, 10);
  });

  it("getCurrentCost：daily rolling cache miss 时应从 DB 重建并返回", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    redisClientRef.eval.mockResolvedValueOnce("0");
    redisClientRef.exists.mockResolvedValueOnce(0);
    statisticsMock.findProviderCostEntriesInTimeRange.mockResolvedValueOnce([
      { id: 101, createdAt: new Date(nowMs - 60_000), costUsd: 2 },
      { id: 102, createdAt: new Date(nowMs - 30_000), costUsd: 3 },
    ]);

    const current = await RateLimitService.getCurrentCost(
      9,
      "provider",
      "daily",
      "00:00",
      "rolling"
    );
    expect(current).toBeCloseTo(5, 10);
    expect(pipelineCalls.some((c) => c[0] === "zadd")).toBe(true);
  });

  it("trackCost：fixed 模式应写入 key/provider 的 daily+weekly+monthly（STRING）", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    await RateLimitService.trackCost(1, 9, "sess", 1.25, {
      keyResetMode: "fixed",
      providerResetMode: "fixed",
      keyResetTime: "00:00",
      providerResetTime: "00:00",
      requestId: 123,
      createdAtMs: nowMs,
    });

    // 5h 的 Lua 脚本至少会执行两次（key/provider）
    expect(redisClientRef.eval).toHaveBeenCalled();
    expect(pipelineCalls.filter((c) => c[0] === "incrbyfloat").length).toBeGreaterThanOrEqual(4);
    expect(pipelineCalls.filter((c) => c[0] === "expire").length).toBeGreaterThanOrEqual(4);
  });

  it("trackCost：rolling 模式应写入 key/provider 的 daily_rolling（ZSET）", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    await RateLimitService.trackCost(1, 9, "sess", 1.25, {
      keyResetMode: "rolling",
      providerResetMode: "rolling",
      requestId: 123,
      createdAtMs: nowMs,
    });

    const evalArgs = redisClientRef.eval.mock.calls.map((c: unknown[]) => String(c[2]));
    expect(evalArgs.some((k) => k === "key:1:cost_daily_rolling")).toBe(true);
    expect(evalArgs.some((k) => k === "provider:9:cost_daily_rolling")).toBe(true);
  });

  it("getCurrentCostBatch：pipeline.exec 返回 null 时应返回默认值", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    const pipeline = makePipeline();
    pipeline.exec.mockResolvedValueOnce(null);
    redisClientRef.pipeline.mockReturnValueOnce(pipeline);

    const result = await RateLimitService.getCurrentCostBatch([1], new Map());
    expect(result.get(1)).toEqual({ cost5h: 0, costDaily: 0, costWeekly: 0, costMonthly: 0 });
  });

  it("getCurrentCostBatch：单个 query 出错时应跳过该项", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    const pipeline = makePipeline();
    pipeline.exec.mockResolvedValueOnce([
      [new Error("boom"), null],
      [null, "2.5"],
      [null, "3.5"],
      [null, "4.5"],
    ]);
    redisClientRef.pipeline.mockReturnValueOnce(pipeline);

    const result = await RateLimitService.getCurrentCostBatch([1], new Map());
    // 5h 出错，保持默认 0，其余正常
    expect(result.get(1)).toEqual({ cost5h: 0, costDaily: 2.5, costWeekly: 3.5, costMonthly: 4.5 });
  });
});
