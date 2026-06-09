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
  eval: vi.fn(),
  get: vi.fn(async () => null),
  set: vi.fn(async () => "OK"),
  exists: vi.fn(async () => 0),
  mget: vi.fn(async (..._keys: string[]) => _keys.map(() => null) as Array<string | null>),
  pipeline: vi.fn(() => makePipeline()),
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
  sumProviderCostBatchInTimeRange: vi.fn(async () => new Map<number, number>()),
  getProviderCostResetAtMap: vi.fn(async () => new Map<number, Date | null>()),
  findEarliestLedgerCreatedAtInWindow: vi.fn(async () => null as number | null),
  findKeyCostEntriesInTimeRange: vi.fn(async () => []),
  findProviderCostEntriesInTimeRange: vi.fn(async () => []),
  findUserCostEntriesInTimeRange: vi.fn(async () => []),
};

vi.mock("@/repository/statistics", () => statisticsMock);

describe("cost display cache write semantics (bug01)", () => {
  const nowMs = 1_700_000_000_000;

  beforeEach(() => {
    pipelineCalls.length = 0;
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    redisClient.get.mockResolvedValue(null);
    cacheMock.getCachedRollingCost.mockResolvedValue(null);
    redisClient.mget.mockImplementation(async (..._keys: string[]) => _keys.map(() => null));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("getCurrentCost (key, 5h rolling) warms cache using global-counted SUM", async () => {
    cacheMock.getCachedRollingCost.mockResolvedValueOnce(null);
    statisticsMock.sumKeyCostInTimeRange.mockResolvedValueOnce(5);

    const { RateLimitService } = await import("@/lib/rate-limit");
    const current = await RateLimitService.getCurrentCost(42, "key", "5h");

    expect(current).toBeCloseTo(5, 10);
    expect(statisticsMock.sumKeyCostInTimeRange).toHaveBeenCalledWith(
      42,
      expect.any(Date),
      expect.any(Date),
      true
    );
    expect(cacheMock.setCachedRollingCost).toHaveBeenCalledWith(redisClient, "key", 42, "5h", 5);
  });

  it("getCurrentCost (user, daily rolling) warms cache using global-counted SUM", async () => {
    cacheMock.getCachedRollingCost.mockResolvedValueOnce(null);
    statisticsMock.sumUserCostInTimeRange.mockResolvedValueOnce(3.5);

    const { RateLimitService } = await import("@/lib/rate-limit");
    const current = await RateLimitService.getCurrentCost(7, "user", "daily", "00:00", "rolling");

    expect(current).toBeCloseTo(3.5, 10);
    expect(statisticsMock.sumUserCostInTimeRange).toHaveBeenCalledWith(
      7,
      expect.any(Date),
      expect.any(Date),
      true
    );
  });

  it("getCurrentCostBatch uses per-provider param overload (bug07 supersedes bug01 4th arg)", async () => {
    cacheMock.mgetCachedRollingCost.mockResolvedValueOnce([null, null]); // 5h: 2 misses
    statisticsMock.sumProviderCostBatchInTimeRange.mockResolvedValueOnce(
      new Map([
        [1, 1.2],
        [2, 2.3],
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

    expect(statisticsMock.sumProviderCostBatchInTimeRange).toHaveBeenCalledTimes(1);
    const args = statisticsMock.sumProviderCostBatchInTimeRange.mock.calls[0];
    const params = args[0] as Array<{ providerId: number; startTime: Date }>;
    expect(params.map((p) => p.providerId)).toEqual([1, 2]);
    for (const p of params) {
      expect(p.startTime).toBeInstanceOf(Date);
    }
  });
});
