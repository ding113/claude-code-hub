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
  incrbyfloat: vi.fn(() => pipeline),
  exec: vi.fn(async () => {
    pipelineCommands.push(["exec"]);
    return [];
  }),
};

const redisClient = {
  status: "ready",
  eval: vi.fn(async () => "0"),
  exists: vi.fn(async () => 0),
  pipeline: vi.fn(() => pipeline),
  get: vi.fn(async () => null),
  set: vi.fn(async () => "OK"),
};

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => redisClient,
}));

const statisticsMock = {
  sumKeyTotalCost: vi.fn(async () => 0),
  sumUserCostToday: vi.fn(async () => 0),
  sumUserTotalCost: vi.fn(async () => 0),
  sumKeyCostInTimeRange: vi.fn(async () => 0),
  sumProviderCostInTimeRange: vi.fn(async () => 0),
  sumUserCostInTimeRange: vi.fn(async () => 0),
  findKeyCostEntriesInTimeRange: vi.fn(async () => []),
  findProviderCostEntriesInTimeRange: vi.fn(async () => []),
  findUserCostEntriesInTimeRange: vi.fn(async () => []),
};

vi.mock("@/repository/statistics", () => statisticsMock);

describe("RateLimitService rolling window cache warm", () => {
  const nowMs = 1_700_000_000_000;

  beforeEach(() => {
    pipelineCommands.length = 0;
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("getCurrentCost(5h) rebuilds ZSET from DB entries on cache miss", async () => {
    statisticsMock.findKeyCostEntriesInTimeRange.mockResolvedValueOnce([
      { id: 101, createdAt: new Date(nowMs - 4 * 60 * 60 * 1000), costUsd: 1.5 },
      { id: 102, createdAt: new Date(nowMs - 1 * 60 * 60 * 1000), costUsd: 2.0 },
    ]);

    const { RateLimitService } = await import("@/lib/rate-limit");

    const current = await RateLimitService.getCurrentCost(1, "key", "5h");
    expect(current).toBeCloseTo(3.5, 10);

    const zaddCalls = pipelineCommands.filter((c) => c[0] === "zadd");
    expect(zaddCalls).toHaveLength(2);

    const expireCalls = pipelineCommands.filter((c) => c[0] === "expire");
    expect(expireCalls).toHaveLength(1);
    expect(expireCalls[0][1]).toBe("key:1:cost_5h_rolling");
    expect(expireCalls[0][2]).toBe(21600);

    // member format: `${createdAtMs}:${requestId}:${costUsd}`
    const first = zaddCalls[0];
    expect(first[1]).toBe("key:1:cost_5h_rolling");
    expect(first[2]).toBe(nowMs - 4 * 60 * 60 * 1000);
    expect(first[3]).toBe(`${nowMs - 4 * 60 * 60 * 1000}:101:1.5`);
  });

  it("trackCost passes requestId and uses createdAtMs for rolling windows", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    await RateLimitService.trackCost(1, 2, "sess", 0.5, {
      requestId: 123,
      createdAtMs: nowMs - 1000,
      keyResetMode: "fixed",
      providerResetMode: "fixed",
    });

    const evalCalls = redisClient.eval.mock.calls;
    expect(evalCalls.length).toBeGreaterThanOrEqual(2);

    const [firstCall] = evalCalls;
    expect(firstCall[2]).toBe("key:1:cost_5h_rolling");
    expect(firstCall[4]).toBe(String(nowMs - 1000));
    expect(firstCall[6]).toBe("123");
  });
});
