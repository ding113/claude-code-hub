import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: vi.fn(async () => "UTC"),
}));

vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: vi.fn(async () => ({ quotaDbRefreshIntervalSeconds: 10 })),
}));

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
    exec: vi.fn(async () => {
      pipelineCalls.push(["exec"]);
      return pipelineCalls
        .filter((c) => c[0] === "get")
        .map(() => [null, null] as [Error | null, unknown]);
    }),
  };
  return pipeline;
};

const redisClient = {
  status: "ready",
  mget: vi.fn(async (..._keys: string[]) => _keys.map(() => null) as Array<string | null>),
  pipeline: vi.fn(() => makePipeline()),
};

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => redisClient,
}));

const statisticsMock = {
  sumKeyTotalCost: vi.fn(async () => 0),
  sumUserTotalCost: vi.fn(async () => 0),
  sumUserCostInTimeRange: vi.fn(async () => 0),
  sumKeyCostInTimeRange: vi.fn(async () => 0),
  sumProviderCostInTimeRange: vi.fn(async () => 0),
  sumProviderCostBatchInTimeRange: vi.fn(async () => new Map<number, number>()),
  getProviderCostResetAtMap: vi.fn(async () => new Map<number, Date | null>()),
  findEarliestLedgerCreatedAtInWindow: vi.fn(async () => null as number | null),
  findKeyCostEntriesInTimeRange: vi.fn(async () => []),
  findProviderCostEntriesInTimeRange: vi.fn(async () => []),
  findUserCostEntriesInTimeRange: vi.fn(async () => []),
};

vi.mock("@/repository/statistics", () => statisticsMock);

describe("getCurrentCostBatch — display cache + batch DB SUM", () => {
  const nowMs = 1_700_000_000_000;

  beforeEach(() => {
    pipelineCalls.length = 0;
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    redisClient.mget.mockReset();
    redisClient.mget.mockImplementation(async (..._keys: string[]) => _keys.map(() => null));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns zero-filled map and skips Redis when providerIds is empty", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");
    const result = await RateLimitService.getCurrentCostBatch([], new Map());
    expect(result.size).toBe(0);
    expect(redisClient.mget).not.toHaveBeenCalled();
    expect(statisticsMock.sumProviderCostBatchInTimeRange).not.toHaveBeenCalled();
  });

  it("uses display cache for 5h rolling, no Lua eval", async () => {
    redisClient.mget.mockResolvedValueOnce(["1.5", "3.0"]); // 5h cache: both hit
    redisClient.mget.mockResolvedValueOnce([null, null]); // daily cache (irrelevant here, all fixed)

    const { RateLimitService } = await import("@/lib/rate-limit");
    const result = await RateLimitService.getCurrentCostBatch(
      [1, 2],
      new Map([
        [1, { resetTime: "00:00", resetMode: "fixed" }],
        [2, { resetTime: "00:00", resetMode: "fixed" }],
      ])
    );

    expect(result.get(1)?.cost5h).toBeCloseTo(1.5, 10);
    expect(result.get(2)?.cost5h).toBeCloseTo(3.0, 10);
    expect(statisticsMock.sumProviderCostBatchInTimeRange).not.toHaveBeenCalled();
    expect(pipelineCalls.some((c) => c[0] === "eval")).toBe(false);
  });

  it("queries DB once for misses and writes back display cache", async () => {
    redisClient.mget.mockResolvedValueOnce([null, "0.25", null]); // 5h: 1 hit, 2 misses

    statisticsMock.sumProviderCostBatchInTimeRange.mockResolvedValueOnce(
      new Map([
        [1, 4.0],
        [3, 1.5],
      ])
    );

    const { RateLimitService } = await import("@/lib/rate-limit");
    const result = await RateLimitService.getCurrentCostBatch(
      [1, 2, 3],
      new Map([
        [1, { resetTime: "00:00", resetMode: "fixed" }],
        [2, { resetTime: "00:00", resetMode: "fixed" }],
        [3, { resetTime: "00:00", resetMode: "fixed" }],
      ])
    );

    expect(result.get(1)?.cost5h).toBeCloseTo(4.0, 10);
    expect(result.get(2)?.cost5h).toBeCloseTo(0.25, 10);
    expect(result.get(3)?.cost5h).toBeCloseTo(1.5, 10);

    // DB called once with only the miss providerIds (bug07: object-array overload)
    expect(statisticsMock.sumProviderCostBatchInTimeRange).toHaveBeenCalledTimes(1);
    const dbArgs = statisticsMock.sumProviderCostBatchInTimeRange.mock.calls[0];
    const params = dbArgs[0] as Array<{ providerId: number; startTime: Date }>;
    expect(params.map((p) => p.providerId)).toEqual([1, 3]);
    for (const p of params) {
      expect(p.startTime).toBeInstanceOf(Date);
    }

    // No Lua eval should appear in pipeline
    expect(pipelineCalls.some((c) => c[0] === "eval")).toBe(false);
  });

  it("clips per-provider startTime by costResetAt (bug07)", async () => {
    redisClient.mget.mockResolvedValueOnce([null, null]); // 5h: both miss

    const veryRecentReset = new Date(nowMs - 30 * 60 * 1000); // 30m ago
    statisticsMock.getProviderCostResetAtMap.mockResolvedValueOnce(
      new Map<number, Date | null>([
        [1, veryRecentReset],
        [2, null],
      ])
    );

    statisticsMock.sumProviderCostBatchInTimeRange.mockResolvedValueOnce(
      new Map<number, number>([
        [1, 0],
        [2, 7.5],
      ])
    );

    const { RateLimitService } = await import("@/lib/rate-limit");
    await RateLimitService.getCurrentCostBatch(
      [1, 2],
      new Map([
        [1, { resetTime: "00:00", resetMode: "fixed" }],
        [2, { resetTime: "00:00", resetMode: "fixed" }],
      ])
    );

    const dbArgs = statisticsMock.sumProviderCostBatchInTimeRange.mock.calls[0];
    const params = dbArgs[0] as Array<{ providerId: number; startTime: Date }>;
    // provider 1 clipped forward to its reset time
    const p1 = params.find((p) => p.providerId === 1)!;
    expect(p1.startTime.getTime()).toBe(veryRecentReset.getTime());
    // provider 2 keeps the default 5h window start
    const p2 = params.find((p) => p.providerId === 2)!;
    expect(p2.startTime.getTime()).toBe(nowMs - 5 * 60 * 60 * 1000);
  });

  it("returns zeroed map when Redis is unavailable", async () => {
    redisClient.status = "end" as unknown as "ready";

    try {
      const { RateLimitService } = await import("@/lib/rate-limit");
      const result = await RateLimitService.getCurrentCostBatch(
        [1, 2],
        new Map([
          [1, { resetTime: "00:00", resetMode: "fixed" }],
          [2, { resetTime: "00:00", resetMode: "fixed" }],
        ])
      );

      expect(result.get(1)?.cost5h).toBe(0);
      expect(result.get(2)?.cost5h).toBe(0);
      expect(redisClient.mget).not.toHaveBeenCalled();
      expect(statisticsMock.sumProviderCostBatchInTimeRange).not.toHaveBeenCalled();
    } finally {
      redisClient.status = "ready";
    }
  });

  it("does not call DB batch SUM for daily rolling when all providers configured fixed", async () => {
    redisClient.mget.mockResolvedValueOnce(["0.5", "0.5"]); // 5h all hits
    // daily mget not expected (no rolling providers)

    const { RateLimitService } = await import("@/lib/rate-limit");
    await RateLimitService.getCurrentCostBatch(
      [10, 11],
      new Map([
        [10, { resetTime: "00:00", resetMode: "fixed" }],
        [11, { resetTime: "00:00", resetMode: "fixed" }],
      ])
    );

    // DB batch SUM only called when there are rolling misses
    expect(statisticsMock.sumProviderCostBatchInTimeRange).not.toHaveBeenCalled();
  });
});
