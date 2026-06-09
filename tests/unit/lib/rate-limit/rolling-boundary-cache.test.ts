import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// bugfix #09: when the rolling-window cache is warmed by a DB SUM, the TTL must
// be clamped to the moment the earliest in-window row will fall out — otherwise
// "limit reached" persists in cache for the full configured TTL after the
// window has slid past that row.

let redisClientRef: any;

const makePipeline = () => {
  const pipeline = {
    eval: vi.fn(async () => 0),
    get: vi.fn(),
    exec: vi.fn(async () => []),
  };
  return pipeline;
};

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => redisClientRef,
}));

vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: vi.fn(async () => ({ quotaDbRefreshIntervalSeconds: 10 })),
}));

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: vi.fn(async () => "UTC"),
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

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    getKeySessionCount: vi.fn(async () => 0),
    getProviderSessionCount: vi.fn(async () => 0),
    getUserSessionCount: vi.fn(async () => 0),
  },
}));

describe("checkCostLimits — rolling boundary-aware cache TTL (bug09)", () => {
  const nowMs = 1_700_000_000_000;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));

    redisClientRef = {
      status: "ready",
      get: vi.fn(async () => null), // cache miss → fall to DB
      set: vi.fn(async () => "OK"),
      setex: vi.fn(async () => "OK"),
      eval: vi.fn(async () => 0),
      pipeline: vi.fn(() => makePipeline()),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("on 5h cache miss + DB SUM, looks up earliest ledger and clamps TTL to boundary", async () => {
    statisticsMock.sumUserCostInTimeRange.mockResolvedValue(2.5);
    // Earliest row is at now - 5h + 2s → boundary in ~2 seconds.
    const earliestMs = nowMs - 5 * 60 * 60 * 1000 + 2000;
    statisticsMock.findEarliestLedgerCreatedAtInWindow.mockResolvedValue(earliestMs);

    const { RateLimitService } = await import("@/lib/rate-limit");
    await RateLimitService.checkCostLimits(1, "user", {
      limit_5h_usd: 10,
      limit_5h_reset_mode: "rolling",
      limit_daily_usd: null,
      daily_reset_mode: "fixed",
      daily_reset_time: "00:00",
      limit_weekly_usd: null,
      limit_monthly_usd: null,
    });

    expect(statisticsMock.findEarliestLedgerCreatedAtInWindow).toHaveBeenCalled();
    const setCalls = redisClientRef.set.mock.calls;
    expect(setCalls.length).toBeGreaterThan(0);
    const rollingSet = setCalls.find((c: unknown[]) => String(c[0]).endsWith(":5h_rolling"));
    expect(rollingSet).toBeDefined();
    const ttl = rollingSet[3] as number;
    expect(ttl).toBeLessThanOrEqual(3);
    expect(ttl).toBeGreaterThanOrEqual(1);
  });

  it("when no earliest row is found, falls back to configured TTL", async () => {
    statisticsMock.sumUserCostInTimeRange.mockResolvedValue(0);
    statisticsMock.findEarliestLedgerCreatedAtInWindow.mockResolvedValue(null);

    const { RateLimitService } = await import("@/lib/rate-limit");
    await RateLimitService.checkCostLimits(1, "user", {
      limit_5h_usd: 10,
      limit_5h_reset_mode: "rolling",
      limit_daily_usd: null,
      daily_reset_mode: "fixed",
      daily_reset_time: "00:00",
      limit_weekly_usd: null,
      limit_monthly_usd: null,
    });

    const rollingSet = redisClientRef.set.mock.calls.find((c: unknown[]) =>
      String(c[0]).endsWith(":5h_rolling")
    );
    const ttl = rollingSet[3] as number;
    expect(ttl).toBeGreaterThanOrEqual(9);
    expect(ttl).toBeLessThanOrEqual(11);
  });
});
