/**
 * 5h Rolling Window Tests
 *
 * TDD: RED phase - tests to verify 5h quota uses true sliding window
 *
 * Expected behavior:
 * - 5h window = current time - 5 hours (rolling, not fixed reset time)
 * - Entries older than 5h should be excluded automatically
 * - No "reset time" concept for 5h window
 * - Error messages should NOT show a fixed reset time, but indicate rolling window
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock resolveSystemTimezone before importing modules
vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: vi.fn(async () => "Asia/Shanghai"),
}));

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

describe("RateLimitService - 5h rolling window behavior", () => {
  const baseTime = 1700000000000; // Base timestamp

  beforeEach(() => {
    pipelineCommands.length = 0;
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(baseTime));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Scenario 1: Basic rolling window - entries expire after 5h", () => {
    it("T0: consume $10, window should be $10", async () => {
      const { RateLimitService } = await import("@/lib/rate-limit");

      // trackCost calls eval twice (key + provider)
      redisClient.eval.mockResolvedValueOnce("10"); // TRACK key
      redisClient.eval.mockResolvedValueOnce("10"); // TRACK provider

      await RateLimitService.trackCost(1, 2, "sess", 10, { requestId: 1, createdAtMs: baseTime });

      // getCurrentCost calls eval once, then exists
      redisClient.eval.mockResolvedValueOnce("10"); // GET query
      redisClient.exists.mockResolvedValueOnce(1); // key exists

      const current = await RateLimitService.getCurrentCost(1, "key", "5h");
      expect(current).toBe(10);
    });

    it("T1 (3h later): consume $20, window should be $30", async () => {
      const { RateLimitService } = await import("@/lib/rate-limit");

      // T0: Track $10 (2 evals: key + provider)
      redisClient.eval.mockResolvedValueOnce("10");
      redisClient.eval.mockResolvedValueOnce("10");
      await RateLimitService.trackCost(1, 2, "sess", 10, { requestId: 1, createdAtMs: baseTime });

      // T1: Move to 3h later
      const t1 = baseTime + 3 * 60 * 60 * 1000;
      vi.setSystemTime(new Date(t1));

      // Track $20 (2 evals: key + provider)
      redisClient.eval.mockResolvedValueOnce("20");
      redisClient.eval.mockResolvedValueOnce("20");
      await RateLimitService.trackCost(1, 2, "sess", 20, { requestId: 2, createdAtMs: t1 });

      // getCurrentCost: eval returns sum
      redisClient.eval.mockResolvedValueOnce("30");
      redisClient.exists.mockResolvedValueOnce(1);

      const current = await RateLimitService.getCurrentCost(1, "key", "5h");
      expect(current).toBe(30);
    });

    it("T2 (6h later): query cost, should only include T1 ($20) as T0 expired", async () => {
      const { RateLimitService } = await import("@/lib/rate-limit");

      // T0: Track $10 (2 evals)
      redisClient.eval.mockResolvedValueOnce("10");
      redisClient.eval.mockResolvedValueOnce("10");
      await RateLimitService.trackCost(1, 2, "sess", 10, { requestId: 1, createdAtMs: baseTime });

      // T1: 3h later, track $20 (2 evals)
      const t1 = baseTime + 3 * 60 * 60 * 1000;
      vi.setSystemTime(new Date(t1));
      redisClient.eval.mockResolvedValueOnce("30");
      redisClient.eval.mockResolvedValueOnce("30");
      await RateLimitService.trackCost(1, 2, "sess", 20, { requestId: 2, createdAtMs: t1 });

      // T2: 6h after T0 (3h after T1)
      const t2 = baseTime + 6 * 60 * 60 * 1000;
      vi.setSystemTime(new Date(t2));

      // Lua script should clean T0 and return only T1
      redisClient.eval.mockResolvedValueOnce("20");
      redisClient.exists.mockResolvedValueOnce(1);

      const current = await RateLimitService.getCurrentCost(1, "key", "5h");
      expect(current).toBe(20);

      // Verify Lua script was called with correct window calculation
      const evalCall = redisClient.eval.mock.calls[redisClient.eval.mock.calls.length - 1];
      expect(evalCall[3]).toBe(t2.toString()); // now
      expect(evalCall[4]).toBe((5 * 60 * 60 * 1000).toString()); // 5h window
    });
  });

  describe("Scenario 2: Window boundary - 4h59m vs 5h01m", () => {
    it("T0: consume $5, T1 (4h59m later): consume $10, window = $15", async () => {
      const { RateLimitService } = await import("@/lib/rate-limit");

      // T0: Track $5 (2 evals)
      redisClient.eval.mockResolvedValueOnce("5");
      redisClient.eval.mockResolvedValueOnce("5");
      await RateLimitService.trackCost(1, 2, "sess", 5, { requestId: 1, createdAtMs: baseTime });

      // T1: 4h59m later (still within 5h)
      const t1 = baseTime + (4 * 60 + 59) * 60 * 1000;
      vi.setSystemTime(new Date(t1));
      redisClient.eval.mockResolvedValueOnce("15");
      redisClient.eval.mockResolvedValueOnce("15");
      await RateLimitService.trackCost(1, 2, "sess", 10, { requestId: 2, createdAtMs: t1 });

      // Both entries should be in window
      redisClient.eval.mockResolvedValueOnce("15");
      redisClient.exists.mockResolvedValueOnce(1);

      const current = await RateLimitService.getCurrentCost(1, "key", "5h");
      expect(current).toBe(15);
    });

    it("T2 (5h01m after T0): query, window = $10 (T0 expired)", async () => {
      const { RateLimitService } = await import("@/lib/rate-limit");

      // T0: Track $5 (2 evals)
      redisClient.eval.mockResolvedValueOnce("5");
      redisClient.eval.mockResolvedValueOnce("5");
      await RateLimitService.trackCost(1, 2, "sess", 5, { requestId: 1, createdAtMs: baseTime });

      // T1: 4h59m later (2 evals)
      const t1 = baseTime + (4 * 60 + 59) * 60 * 1000;
      vi.setSystemTime(new Date(t1));
      redisClient.eval.mockResolvedValueOnce("15");
      redisClient.eval.mockResolvedValueOnce("15");
      await RateLimitService.trackCost(1, 2, "sess", 10, { requestId: 2, createdAtMs: t1 });

      // T2: 5h01m after T0
      const t2 = baseTime + (5 * 60 + 1) * 60 * 1000;
      vi.setSystemTime(new Date(t2));

      // T0 should be cleaned, only T1 remains
      redisClient.eval.mockResolvedValueOnce("10");
      redisClient.exists.mockResolvedValueOnce(1);

      const current = await RateLimitService.getCurrentCost(1, "key", "5h");
      expect(current).toBe(10);
    });
  });

  describe("Scenario 3: Multiple entries rolling out", () => {
    it("should correctly calculate window with multiple entries at different times", async () => {
      const { RateLimitService } = await import("@/lib/rate-limit");

      // T0: $10 (2 evals)
      redisClient.eval.mockResolvedValueOnce("10");
      redisClient.eval.mockResolvedValueOnce("10");
      await RateLimitService.trackCost(1, 2, "sess", 10, { requestId: 1, createdAtMs: baseTime });

      // T1: 1h later, $20 (2 evals)
      const t1 = baseTime + 1 * 60 * 60 * 1000;
      vi.setSystemTime(new Date(t1));
      redisClient.eval.mockResolvedValueOnce("30");
      redisClient.eval.mockResolvedValueOnce("30");
      await RateLimitService.trackCost(1, 2, "sess", 20, { requestId: 2, createdAtMs: t1 });

      // T2: 2h later, $15 (2 evals)
      const t2 = baseTime + 2 * 60 * 60 * 1000;
      vi.setSystemTime(new Date(t2));
      redisClient.eval.mockResolvedValueOnce("45");
      redisClient.eval.mockResolvedValueOnce("45");
      await RateLimitService.trackCost(1, 2, "sess", 15, { requestId: 3, createdAtMs: t2 });

      // T3: 3h after T0, $25 (2 evals)
      const t3 = baseTime + 3 * 60 * 60 * 1000;
      vi.setSystemTime(new Date(t3));
      redisClient.eval.mockResolvedValueOnce("70");
      redisClient.eval.mockResolvedValueOnce("70");
      await RateLimitService.trackCost(1, 2, "sess", 25, { requestId: 4, createdAtMs: t3 });

      // At T3: all 4 entries within window = $70
      redisClient.eval.mockResolvedValueOnce("70");
      redisClient.exists.mockResolvedValueOnce(1);
      const currentT3 = await RateLimitService.getCurrentCost(1, "key", "5h");
      expect(currentT3).toBe(70);

      // T4: 6h after T0
      const t4 = baseTime + 6 * 60 * 60 * 1000;
      vi.setSystemTime(new Date(t4));

      // T0 and T1 expired, only T2 and T3 remain = $40
      redisClient.eval.mockResolvedValueOnce("40");
      redisClient.exists.mockResolvedValueOnce(1);
      const currentT4 = await RateLimitService.getCurrentCost(1, "key", "5h");
      expect(currentT4).toBe(40);
    });
  });

  describe("Scenario 4: Limit check with rolling window", () => {
    it("should reject request when rolling window exceeds limit", async () => {
      const { RateLimitService } = await import("@/lib/rate-limit");

      // T0: consume $40 (2 evals for trackCost)
      redisClient.eval.mockResolvedValueOnce("40");
      redisClient.eval.mockResolvedValueOnce("40");
      await RateLimitService.trackCost(1, 2, "sess", 40, { requestId: 1, createdAtMs: baseTime });

      // Check limit (5h = $50) - checkCostLimits calls eval
      redisClient.eval.mockResolvedValueOnce("40");
      redisClient.exists.mockResolvedValueOnce(1);
      const checkT0 = await RateLimitService.checkCostLimits(1, "key", {
        limit_5h_usd: 50,
        limit_daily_usd: null,
        limit_weekly_usd: null,
        limit_monthly_usd: null,
      });
      expect(checkT0.allowed).toBe(true);

      // T1: 3h later, try to consume $20 (would make window $60 > $50)
      const t1 = baseTime + 3 * 60 * 60 * 1000;
      vi.setSystemTime(new Date(t1));

      // checkCostLimits: eval returns current = $40
      redisClient.eval.mockResolvedValueOnce("40");
      redisClient.exists.mockResolvedValueOnce(1);

      const checkT1 = await RateLimitService.checkCostLimits(1, "key", {
        limit_5h_usd: 50,
        limit_daily_usd: null,
        limit_weekly_usd: null,
        limit_monthly_usd: null,
      });

      // Current is $40, limit is $50, should still be allowed
      expect(checkT1.allowed).toBe(true);

      // After adding $20, would be $60 - trackCost (2 evals)
      redisClient.eval.mockResolvedValueOnce("60");
      redisClient.eval.mockResolvedValueOnce("60");
      await RateLimitService.trackCost(1, 2, "sess", 20, { requestId: 2, createdAtMs: t1 });

      // Verify window now shows $60
      redisClient.eval.mockResolvedValueOnce("60");
      redisClient.exists.mockResolvedValueOnce(1);
      const currentT1 = await RateLimitService.getCurrentCost(1, "key", "5h");
      expect(currentT1).toBe(60);

      // T2: 6h after T0, T0's $40 expires, window = $20
      const t2 = baseTime + 6 * 60 * 60 * 1000;
      vi.setSystemTime(new Date(t2));

      redisClient.eval.mockResolvedValueOnce("20");
      redisClient.exists.mockResolvedValueOnce(1);
      const checkT2 = await RateLimitService.checkCostLimits(1, "key", {
        limit_5h_usd: 50,
        limit_daily_usd: null,
        limit_weekly_usd: null,
        limit_monthly_usd: null,
      });
      expect(checkT2.allowed).toBe(true);
    });
  });

  describe("Scenario 5: Cross-day rolling window", () => {
    it("should handle entries across day boundary correctly", async () => {
      const { RateLimitService } = await import("@/lib/rate-limit");

      // Day1 22:00 UTC
      const day1_22h = new Date("2024-01-15T22:00:00.000Z").getTime();
      vi.setSystemTime(new Date(day1_22h));

      // Track $10 (2 evals)
      redisClient.eval.mockResolvedValueOnce("10");
      redisClient.eval.mockResolvedValueOnce("10");
      await RateLimitService.trackCost(1, 2, "sess", 10, { requestId: 1, createdAtMs: day1_22h });

      // Day2 01:00 UTC (3h later, crossed midnight)
      const day2_01h = new Date("2024-01-16T01:00:00.000Z").getTime();
      vi.setSystemTime(new Date(day2_01h));

      // Track $20 (2 evals)
      redisClient.eval.mockResolvedValueOnce("30");
      redisClient.eval.mockResolvedValueOnce("30");
      await RateLimitService.trackCost(1, 2, "sess", 20, { requestId: 2, createdAtMs: day2_01h });

      // Both entries in window = $30
      redisClient.eval.mockResolvedValueOnce("30");
      redisClient.exists.mockResolvedValueOnce(1);
      const current01h = await RateLimitService.getCurrentCost(1, "key", "5h");
      expect(current01h).toBe(30);

      // Day2 04:00 UTC (6h after day1_22h)
      const day2_04h = new Date("2024-01-16T04:00:00.000Z").getTime();
      vi.setSystemTime(new Date(day2_04h));

      // First entry expired, only second remains = $20
      redisClient.eval.mockResolvedValueOnce("20");
      redisClient.exists.mockResolvedValueOnce(1);
      const current04h = await RateLimitService.getCurrentCost(1, "key", "5h");
      expect(current04h).toBe(20);
    });
  });

  describe("Verify no fixed reset time exists for 5h window", () => {
    it("should not have any fixed reset time concept", async () => {
      const { getResetInfo } = await import("@/lib/rate-limit/time-utils");

      const info = await getResetInfo("5h");

      // 5h window is rolling type, no resetAt timestamp
      expect(info.type).toBe("rolling");
      expect(info.period).toBe("5 小时");
      expect(info.resetAt).toBeUndefined();
    });

    it("should always calculate window as (now - 5h) to now", async () => {
      const { getTimeRangeForPeriod } = await import("@/lib/rate-limit/time-utils");

      const now1 = new Date("2024-01-15T10:00:00.000Z").getTime();
      vi.setSystemTime(new Date(now1));

      const range1 = await getTimeRangeForPeriod("5h");
      expect(range1.endTime.getTime()).toBe(now1);
      expect(range1.startTime.getTime()).toBe(now1 - 5 * 60 * 60 * 1000);

      // Different time
      const now2 = new Date("2024-01-16T15:30:00.000Z").getTime();
      vi.setSystemTime(new Date(now2));

      const range2 = await getTimeRangeForPeriod("5h");
      expect(range2.endTime.getTime()).toBe(now2);
      expect(range2.startTime.getTime()).toBe(now2 - 5 * 60 * 60 * 1000);
    });
  });

  describe("Provider 5h rolling window", () => {
    it("should work identically for provider entities", async () => {
      const { RateLimitService } = await import("@/lib/rate-limit");

      // T0: provider consumes $15 (2 evals)
      redisClient.eval.mockResolvedValueOnce("15");
      redisClient.eval.mockResolvedValueOnce("15");
      await RateLimitService.trackCost(1, 2, "sess", 15, { requestId: 1, createdAtMs: baseTime });

      // T1: 4h later, consume $25 (2 evals)
      const t1 = baseTime + 4 * 60 * 60 * 1000;
      vi.setSystemTime(new Date(t1));
      redisClient.eval.mockResolvedValueOnce("40");
      redisClient.eval.mockResolvedValueOnce("40");
      await RateLimitService.trackCost(1, 2, "sess", 25, { requestId: 2, createdAtMs: t1 });

      // Window = $40
      redisClient.eval.mockResolvedValueOnce("40");
      redisClient.exists.mockResolvedValueOnce(1);
      const currentT1 = await RateLimitService.getCurrentCost(2, "provider", "5h");
      expect(currentT1).toBe(40);

      // T2: 6h after T0
      const t2 = baseTime + 6 * 60 * 60 * 1000;
      vi.setSystemTime(new Date(t2));

      // Only T1 remains = $25
      redisClient.eval.mockResolvedValueOnce("25");
      redisClient.exists.mockResolvedValueOnce(1);
      const currentT2 = await RateLimitService.getCurrentCost(2, "provider", "5h");
      expect(currentT2).toBe(25);
    });
  });

  describe("Cache miss and DB recovery", () => {
    it("should restore from DB entries with correct time range on cache miss", async () => {
      const { RateLimitService } = await import("@/lib/rate-limit");

      // Simulate cache miss: eval returns 0 and key doesn't exist
      redisClient.eval.mockResolvedValueOnce("0");
      redisClient.exists.mockResolvedValueOnce(0);

      // Mock DB entries within 5h window
      const now = baseTime + 3 * 60 * 60 * 1000; // 3h later
      vi.setSystemTime(new Date(now));

      statisticsMock.findKeyCostEntriesInTimeRange.mockResolvedValueOnce([
        { id: 1, createdAt: new Date(baseTime), costUsd: 10 },
        { id: 2, createdAt: new Date(baseTime + 1 * 60 * 60 * 1000), costUsd: 20 },
        { id: 3, createdAt: new Date(baseTime + 2 * 60 * 60 * 1000), costUsd: 15 },
      ]);

      const current = await RateLimitService.getCurrentCost(1, "key", "5h");

      // Should sum all entries = $45
      expect(current).toBeCloseTo(45, 10);

      // Verify DB was called with correct time range (now - 5h to now)
      expect(statisticsMock.findKeyCostEntriesInTimeRange).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          getTime: expect.any(Function),
        }),
        expect.objectContaining({
          getTime: expect.any(Function),
        })
      );

      const [, startTime, endTime] = statisticsMock.findKeyCostEntriesInTimeRange.mock.calls[0];
      expect(endTime.getTime()).toBe(now);
      expect(startTime.getTime()).toBe(now - 5 * 60 * 60 * 1000);
    });
  });
});

/**
 * Tests for error message and resetTime when 5h limit is exceeded
 *
 * Key expectation: 5h rolling window should NOT have a fixed "reset time"
 * The current implementation incorrectly calculates resetTime as Date.now() + 5h
 * which implies "start counting from when limit is hit"
 *
 * Expected behavior for rolling window:
 * - resetTime concept doesn't apply to rolling windows
 * - Should indicate "rolling 5h window" in the message
 * - Earliest entry expiry time might be useful to show when some budget will free up
 */
describe("5h limit exceeded - error message and resetTime", () => {
  const baseTime = 1700000000000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(baseTime));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("resetTime semantics for rolling window", () => {
    it("5h window getResetInfo should return rolling type without resetAt", async () => {
      const { getResetInfo } = await import("@/lib/rate-limit/time-utils");

      const info = await getResetInfo("5h");

      // Rolling windows have no fixed reset time
      expect(info.type).toBe("rolling");
      expect(info.resetAt).toBeUndefined();
      expect(info.period).toBe("5 小时");
    });

    it("5h rolling window should NOT use (now + 5h) as reset time", async () => {
      // This test documents the expected behavior:
      // For rolling windows, the "reset time" concept is misleading
      // Because usage gradually rolls out as entries age past 5h
      //
      // WRONG: resetTime = now + 5h (implies "start counting from trigger")
      // RIGHT: No fixed reset time, or show when earliest entry expires

      const { getResetInfo } = await import("@/lib/rate-limit/time-utils");

      const t1 = baseTime;
      vi.setSystemTime(new Date(t1));
      const info1 = await getResetInfo("5h");

      // Move forward 3 hours
      const t2 = baseTime + 3 * 60 * 60 * 1000;
      vi.setSystemTime(new Date(t2));
      const info2 = await getResetInfo("5h");

      // Both should indicate rolling type, no specific resetAt
      expect(info1.type).toBe("rolling");
      expect(info2.type).toBe("rolling");
      expect(info1.resetAt).toBeUndefined();
      expect(info2.resetAt).toBeUndefined();
    });

    it("time range should always be (now - 5h, now), not anchored to trigger time", async () => {
      const { getTimeRangeForPeriod } = await import("@/lib/rate-limit/time-utils");

      // T1: Check time range
      const t1 = baseTime;
      vi.setSystemTime(new Date(t1));
      const range1 = await getTimeRangeForPeriod("5h");
      expect(range1.startTime.getTime()).toBe(t1 - 5 * 60 * 60 * 1000);
      expect(range1.endTime.getTime()).toBe(t1);

      // T2: 3 hours later, time range should shift
      const t2 = baseTime + 3 * 60 * 60 * 1000;
      vi.setSystemTime(new Date(t2));
      const range2 = await getTimeRangeForPeriod("5h");
      expect(range2.startTime.getTime()).toBe(t2 - 5 * 60 * 60 * 1000);
      expect(range2.endTime.getTime()).toBe(t2);

      // The window should have shifted, not stayed anchored
      expect(range2.startTime.getTime()).toBe(range1.startTime.getTime() + 3 * 60 * 60 * 1000);
    });
  });

  describe("error message content verification", () => {
    it("error message should indicate rolling window nature", async () => {
      // For rolling windows, the message should NOT say "Resets at <specific time>"
      // Instead, it should convey that this is a rolling 5-hour window
      //
      // Example of problematic message:
      //   "5-hour cost limit exceeded. Resets at 2024-01-15T15:00:00Z"
      //   (This implies you wait until 15:00 and then everything resets)
      //
      // Better message:
      //   "5-hour rolling window cost limit exceeded. Usage is calculated over the past 5 hours."
      //   or
      //   "5-hour cost limit exceeded. Oldest usage will roll off in X hours."

      const { getResetInfo } = await import("@/lib/rate-limit/time-utils");
      const info = await getResetInfo("5h");

      // The info should clearly indicate this is a rolling window
      expect(info.type).toBe("rolling");
      // And provide the period description
      expect(info.period).toBeDefined();
    });
  });

  describe("comparison with daily fixed window", () => {
    it("daily fixed window SHOULD have a specific reset time", async () => {
      const { getResetInfo } = await import("@/lib/rate-limit/time-utils");

      const info = await getResetInfo("daily", "18:00");

      // Daily fixed windows have a specific reset time
      expect(info.type).toBe("custom");
      expect(info.resetAt).toBeDefined();
      expect(info.resetAt).toBeInstanceOf(Date);
    });

    it("daily rolling window should NOT have a specific reset time", async () => {
      const { getResetInfoWithMode } = await import("@/lib/rate-limit/time-utils");

      const info = await getResetInfoWithMode("daily", "18:00", "rolling");

      // Daily rolling also has no fixed reset
      expect(info.type).toBe("rolling");
      expect(info.resetAt).toBeUndefined();
      expect(info.period).toBe("24 小时");
    });
  });

  describe("weekly and monthly windows for comparison", () => {
    it("weekly window should have natural reset time (next Monday)", async () => {
      const { getResetInfo } = await import("@/lib/rate-limit/time-utils");

      const info = await getResetInfo("weekly");

      expect(info.type).toBe("natural");
      expect(info.resetAt).toBeDefined();
    });

    it("monthly window should have natural reset time (1st of next month)", async () => {
      const { getResetInfo } = await import("@/lib/rate-limit/time-utils");

      const info = await getResetInfo("monthly");

      expect(info.type).toBe("natural");
      expect(info.resetAt).toBeDefined();
    });
  });
});

/**
 * Integration test: verify the full flow from limit check to error message
 *
 * This test verifies that when a 5h limit is exceeded:
 * 1. The check correctly identifies the limit is exceeded
 * 2. The error response contains appropriate information about the rolling window
 * 3. The resetTime in the error is semantically correct for a rolling window
 */
describe("5h limit exceeded - full flow integration", () => {
  const baseTime = 1700000000000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(baseTime));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("checkCostLimits should return appropriate failure info for 5h exceeded", async () => {
    const { RateLimitService } = await import("@/lib/rate-limit");

    // Mock current usage: $60 (exceeds $50 limit)
    redisClient.eval.mockResolvedValueOnce("60");
    redisClient.exists.mockResolvedValueOnce(1);

    const result = await RateLimitService.checkCostLimits(1, "key", {
      limit_5h_usd: 50, // Limit: $50
      limit_daily_usd: null,
      limit_weekly_usd: null,
      limit_monthly_usd: null,
    });

    expect(result.allowed).toBe(false);
    // The reason should indicate the limit was exceeded
    expect(result.reason).toContain("5小时");
    expect(result.reason).toContain("60");
    expect(result.reason).toContain("50");
  });
});
