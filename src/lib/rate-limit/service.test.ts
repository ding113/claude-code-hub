import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { RateLimitService } from "./service";
import * as redisModule from "@/lib/redis";
import * as luaScriptsModule from "@/lib/redis/lua-scripts";
import * as sessionTrackerModule from "@/lib/session-tracker";
import * as statisticsModule from "@/repository/statistics";
import * as timeUtilsModule from "./time-utils";
import type { Redis } from "ioredis";

// Mock modules
vi.mock("@/lib/redis");
vi.mock("@/lib/redis/lua-scripts");
vi.mock("@/lib/session-tracker");
vi.mock("@/repository/statistics");
vi.mock("./time-utils");
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("RateLimitService", () => {
  let mockRedis: Partial<Redis>;
  let getRedisClientMock: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock Redis client
    mockRedis = {
      status: "ready",
      eval: vi.fn(),
      get: vi.fn(),
      set: vi.fn(),
      exists: vi.fn(),
      pipeline: vi.fn(() => ({
        incrbyfloat: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        zremrangebyscore: vi.fn().mockReturnThis(),
        zcard: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 0],
          [null, 5],
        ]),
      })),
      zremrangebyscore: vi.fn(),
      zcard: vi.fn(),
      zadd: vi.fn(),
    } as unknown as Partial<Redis>;

    getRedisClientMock = vi.mocked(redisModule.getRedisClient);
    getRedisClientMock.mockReturnValue(mockRedis as Redis);

    // Setup default time utils mocks
    vi.mocked(timeUtilsModule.getTimeRangeForPeriod).mockReturnValue({
      startTime: new Date("2025-01-01T00:00:00.000Z"),
      endTime: new Date("2025-01-01T10:00:00.000Z"),
    });
    vi.mocked(timeUtilsModule.getTTLForPeriod).mockReturnValue(3600);
    vi.mocked(timeUtilsModule.getSecondsUntilMidnight).mockReturnValue(43200);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("checkCostLimits", () => {
    it("should allow request when no limits are set", async () => {
      const result = await RateLimitService.checkCostLimits(1, "key", {
        limit_5h_usd: null,
        limit_weekly_usd: null,
        limit_monthly_usd: null,
      });

      expect(result).toEqual({ allowed: true });
    });

    it("should allow request when under all limits (5h rolling window)", async () => {
      const evalMock = vi.mocked(mockRedis.eval) as Mock;
      evalMock.mockResolvedValue("0.5");

      const existsMock = vi.mocked(mockRedis.exists) as Mock;
      existsMock.mockResolvedValue(1);

      const result = await RateLimitService.checkCostLimits(1, "key", {
        limit_5h_usd: 1.0,
        limit_weekly_usd: null,
        limit_monthly_usd: null,
      });

      expect(result).toEqual({ allowed: true });
      expect(evalMock).toHaveBeenCalledWith(
        luaScriptsModule.GET_COST_5H_ROLLING_WINDOW,
        1,
        "key:1:cost_5h_rolling",
        expect.any(String),
        expect.any(String)
      );
    });

    it("should deny request when 5h limit exceeded", async () => {
      const evalMock = vi.mocked(mockRedis.eval) as Mock;
      evalMock.mockResolvedValue("1.5");

      const existsMock = vi.mocked(mockRedis.exists) as Mock;
      existsMock.mockResolvedValue(1);

      const result = await RateLimitService.checkCostLimits(1, "key", {
        limit_5h_usd: 1.0,
        limit_weekly_usd: null,
        limit_monthly_usd: null,
      });

      expect(result).toEqual({
        allowed: false,
        reason: "Key 5小时消费上限已达到（1.5000/1）",
      });
    });

    it("should allow request when under weekly limit", async () => {
      const getMock = vi.mocked(mockRedis.get) as Mock;
      getMock.mockResolvedValue("5.0");

      const result = await RateLimitService.checkCostLimits(1, "provider", {
        limit_5h_usd: null,
        limit_weekly_usd: 10.0,
        limit_monthly_usd: null,
      });

      expect(result).toEqual({ allowed: true });
      expect(getMock).toHaveBeenCalledWith("provider:1:cost_weekly");
    });

    it("should deny request when weekly limit exceeded", async () => {
      const getMock = vi.mocked(mockRedis.get) as Mock;
      getMock.mockResolvedValue("10.5");

      const result = await RateLimitService.checkCostLimits(1, "provider", {
        limit_5h_usd: null,
        limit_weekly_usd: 10.0,
        limit_monthly_usd: null,
      });

      expect(result).toEqual({
        allowed: false,
        reason: "供应商 周消费上限已达到（10.5000/10）",
      });
    });

    it("should fallback to database when Redis returns null (cache miss)", async () => {
      const getMock = vi.mocked(mockRedis.get) as Mock;
      getMock.mockResolvedValue(null);

      const sumKeyCostMock = vi.fn().mockResolvedValue(2.5);
      vi.mocked(statisticsModule).sumKeyCostInTimeRange = sumKeyCostMock;

      const result = await RateLimitService.checkCostLimits(1, "key", {
        limit_5h_usd: null,
        limit_weekly_usd: 5.0,
        limit_monthly_usd: null,
      });

      expect(result).toEqual({ allowed: true });
      expect(sumKeyCostMock).toHaveBeenCalledWith(1, expect.any(Date), expect.any(Date));
    });

    it("should fallback to database when 5h cache miss detected", async () => {
      const evalMock = vi.mocked(mockRedis.eval) as Mock;
      evalMock.mockResolvedValue("0");

      const existsMock = vi.mocked(mockRedis.exists) as Mock;
      existsMock.mockResolvedValue(0); // Key doesn't exist

      const sumProviderCostMock = vi.fn().mockResolvedValue(1.5);
      vi.mocked(statisticsModule).sumProviderCostInTimeRange = sumProviderCostMock;

      const result = await RateLimitService.checkCostLimits(1, "provider", {
        limit_5h_usd: 5.0,
        limit_weekly_usd: null,
        limit_monthly_usd: null,
      });

      expect(result).toEqual({ allowed: true });
      expect(sumProviderCostMock).toHaveBeenCalled();
    });

    it("should fallback to database when Redis is unavailable (Fail Open)", async () => {
      getRedisClientMock.mockReturnValue(null as unknown as Redis);

      const sumKeyCostMock = vi.fn().mockResolvedValue(0.5);
      vi.mocked(statisticsModule).sumKeyCostInTimeRange = sumKeyCostMock;

      const result = await RateLimitService.checkCostLimits(1, "key", {
        limit_5h_usd: 1.0,
        limit_weekly_usd: null,
        limit_monthly_usd: null,
      });

      expect(result).toEqual({ allowed: true });
      expect(sumKeyCostMock).toHaveBeenCalled();
    });

    it("should fallback to database when Redis status is not ready", async () => {
      mockRedis.status = "connecting";

      const sumProviderCostMock = vi.fn().mockResolvedValue(2.0);
      vi.mocked(statisticsModule).sumProviderCostInTimeRange = sumProviderCostMock;

      const result = await RateLimitService.checkCostLimits(1, "provider", {
        limit_5h_usd: null,
        limit_weekly_usd: 5.0,
        limit_monthly_usd: null,
      });

      expect(result).toEqual({ allowed: true });
      expect(sumProviderCostMock).toHaveBeenCalled();
    });

    it("should warm cache after database query for 5h period", async () => {
      const evalMock = vi.mocked(mockRedis.eval) as Mock;
      evalMock.mockResolvedValue("0");

      const existsMock = vi.mocked(mockRedis.exists) as Mock;
      existsMock.mockResolvedValue(0);

      const sumKeyCostMock = vi.fn().mockResolvedValue(1.5);
      vi.mocked(statisticsModule).sumKeyCostInTimeRange = sumKeyCostMock;

      await RateLimitService.checkCostLimits(1, "key", {
        limit_5h_usd: 5.0,
        limit_weekly_usd: null,
        limit_monthly_usd: null,
      });

      // Should call TRACK_COST_5H_ROLLING_WINDOW to warm cache
      expect(evalMock).toHaveBeenCalledWith(
        luaScriptsModule.TRACK_COST_5H_ROLLING_WINDOW,
        1,
        "key:1:cost_5h_rolling",
        "1.5",
        expect.any(String),
        expect.any(String)
      );
    });

    it("should warm cache after database query for weekly period", async () => {
      const getMock = vi.mocked(mockRedis.get) as Mock;
      getMock.mockResolvedValue(null);

      const setMock = vi.mocked(mockRedis.set) as Mock;
      setMock.mockResolvedValue("OK");

      const sumProviderCostMock = vi.fn().mockResolvedValue(3.5);
      vi.mocked(statisticsModule).sumProviderCostInTimeRange = sumProviderCostMock;

      await RateLimitService.checkCostLimits(1, "provider", {
        limit_5h_usd: null,
        limit_weekly_usd: 10.0,
        limit_monthly_usd: null,
      });

      expect(setMock).toHaveBeenCalledWith("provider:1:cost_weekly", "3.5", "EX", 3600);
    });

    it("should check all periods and deny on first exceeded limit", async () => {
      const getMock = vi.mocked(mockRedis.get) as Mock;
      getMock
        .mockResolvedValueOnce("3.0") // weekly
        .mockResolvedValueOnce("15.0"); // monthly - exceeds limit

      const result = await RateLimitService.checkCostLimits(1, "key", {
        limit_5h_usd: null,
        limit_weekly_usd: 5.0,
        limit_monthly_usd: 10.0,
      });

      expect(result).toEqual({
        allowed: false,
        reason: "Key 月消费上限已达到（15.0000/10）",
      });
    });

    it("should handle Redis errors and fallback to database", async () => {
      const evalMock = vi.mocked(mockRedis.eval) as Mock;
      evalMock.mockRejectedValue(new Error("Redis connection error"));

      const sumKeyCostMock = vi.fn().mockResolvedValue(0.5);
      vi.mocked(statisticsModule).sumKeyCostInTimeRange = sumKeyCostMock;

      const result = await RateLimitService.checkCostLimits(1, "key", {
        limit_5h_usd: 1.0,
        limit_weekly_usd: null,
        limit_monthly_usd: null,
      });

      expect(result).toEqual({ allowed: true });
      expect(sumKeyCostMock).toHaveBeenCalled();
    });
  });

  describe("checkSessionLimit", () => {
    it("should allow request when limit is 0 or negative", async () => {
      const result = await RateLimitService.checkSessionLimit(1, "key", 0);
      expect(result).toEqual({ allowed: true });

      const result2 = await RateLimitService.checkSessionLimit(1, "key", -1);
      expect(result2).toEqual({ allowed: true });
    });

    it("should allow request when under session limit (key)", async () => {
      vi.mocked(sessionTrackerModule.SessionTracker.getKeySessionCount).mockResolvedValue(3);

      const result = await RateLimitService.checkSessionLimit(1, "key", 5);

      expect(result).toEqual({ allowed: true });
      expect(sessionTrackerModule.SessionTracker.getKeySessionCount).toHaveBeenCalledWith(1);
    });

    it("should deny request when session limit exceeded (key)", async () => {
      vi.mocked(sessionTrackerModule.SessionTracker.getKeySessionCount).mockResolvedValue(5);

      const result = await RateLimitService.checkSessionLimit(1, "key", 5);

      expect(result).toEqual({
        allowed: false,
        reason: "Key并发 Session 上限已达到（5/5）",
      });
    });

    it("should allow request when under session limit (provider)", async () => {
      vi.mocked(sessionTrackerModule.SessionTracker.getProviderSessionCount).mockResolvedValue(2);

      const result = await RateLimitService.checkSessionLimit(10, "provider", 5);

      expect(result).toEqual({ allowed: true });
      expect(sessionTrackerModule.SessionTracker.getProviderSessionCount).toHaveBeenCalledWith(10);
    });

    it("should deny request when session limit exceeded (provider)", async () => {
      vi.mocked(sessionTrackerModule.SessionTracker.getProviderSessionCount).mockResolvedValue(10);

      const result = await RateLimitService.checkSessionLimit(10, "provider", 10);

      expect(result).toEqual({
        allowed: false,
        reason: "供应商并发 Session 上限已达到（10/10）",
      });
    });

    it("should implement Fail Open on SessionTracker errors", async () => {
      vi.mocked(sessionTrackerModule.SessionTracker.getKeySessionCount).mockRejectedValue(
        new Error("Redis error")
      );

      const result = await RateLimitService.checkSessionLimit(1, "key", 5);

      expect(result).toEqual({ allowed: true });
    });
  });

  describe("checkAndTrackProviderSession", () => {
    it("should allow and track new session when under limit", async () => {
      const evalMock = vi.mocked(mockRedis.eval) as Mock;
      evalMock.mockResolvedValue([1, 3, 1]); // allowed=1, count=3, tracked=1

      const result = await RateLimitService.checkAndTrackProviderSession(10, "session-123", 5);

      expect(result).toEqual({
        allowed: true,
        count: 3,
        tracked: true,
      });

      expect(evalMock).toHaveBeenCalledWith(
        luaScriptsModule.CHECK_AND_TRACK_SESSION,
        1,
        "provider:10:active_sessions",
        "session-123",
        "5",
        expect.any(String)
      );
    });

    it("should allow without tracking when session already tracked", async () => {
      const evalMock = vi.mocked(mockRedis.eval) as Mock;
      evalMock.mockResolvedValue([1, 5, 0]); // allowed=1, count=5, tracked=0

      const result = await RateLimitService.checkAndTrackProviderSession(
        10,
        "session-existing",
        10
      );

      expect(result).toEqual({
        allowed: true,
        count: 5,
        tracked: false,
      });
    });

    it("should deny request when limit exceeded", async () => {
      const evalMock = vi.mocked(mockRedis.eval) as Mock;
      evalMock.mockResolvedValue([0, 5, 0]); // allowed=0, count=5, tracked=0

      const result = await RateLimitService.checkAndTrackProviderSession(10, "session-new", 5);

      expect(result).toEqual({
        allowed: false,
        count: 5,
        tracked: false,
        reason: "供应商并发 Session 上限已达到（5/5）",
      });
    });

    it("should bypass check when limit is 0 or negative", async () => {
      const evalMock = vi.mocked(mockRedis.eval) as Mock;

      const result = await RateLimitService.checkAndTrackProviderSession(10, "session-123", 0);

      expect(result).toEqual({
        allowed: true,
        count: 0,
        tracked: false,
      });
      expect(evalMock).not.toHaveBeenCalled();
    });

    it("should implement Fail Open when Redis is not ready", async () => {
      mockRedis.status = "connecting";

      const result = await RateLimitService.checkAndTrackProviderSession(10, "session-123", 5);

      expect(result).toEqual({
        allowed: true,
        count: 0,
        tracked: false,
      });
    });

    it("should implement Fail Open when Redis is unavailable", async () => {
      getRedisClientMock.mockReturnValue(null as unknown as Redis);

      const result = await RateLimitService.checkAndTrackProviderSession(10, "session-123", 5);

      expect(result).toEqual({
        allowed: true,
        count: 0,
        tracked: false,
      });
    });

    it("should implement Fail Open on Lua script execution errors", async () => {
      const evalMock = vi.mocked(mockRedis.eval) as Mock;
      evalMock.mockRejectedValue(new Error("Lua script error"));

      const result = await RateLimitService.checkAndTrackProviderSession(10, "session-123", 5);

      expect(result).toEqual({
        allowed: true,
        count: 0,
        tracked: false,
      });
    });
  });

  describe("trackCost", () => {
    it("should track cost for key and provider (5h, weekly, monthly)", async () => {
      const evalMock = vi.mocked(mockRedis.eval) as Mock;
      const pipelineMock = vi.mocked(mockRedis.pipeline) as Mock;
      const mockPipeline = {
        incrbyfloat: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      };
      pipelineMock.mockReturnValue(mockPipeline);

      await RateLimitService.trackCost(1, 10, "session-123", 0.5);

      // Should call Lua script for 5h rolling windows (twice: key and provider)
      expect(evalMock).toHaveBeenCalledTimes(2);
      expect(evalMock).toHaveBeenCalledWith(
        luaScriptsModule.TRACK_COST_5H_ROLLING_WINDOW,
        1,
        "key:1:cost_5h_rolling",
        "0.5",
        expect.any(String),
        expect.any(String)
      );
      expect(evalMock).toHaveBeenCalledWith(
        luaScriptsModule.TRACK_COST_5H_ROLLING_WINDOW,
        1,
        "provider:10:cost_5h_rolling",
        "0.5",
        expect.any(String),
        expect.any(String)
      );

      // Should use pipeline for weekly/monthly
      expect(mockPipeline.incrbyfloat).toHaveBeenCalledWith("key:1:cost_weekly", 0.5);
      expect(mockPipeline.incrbyfloat).toHaveBeenCalledWith("key:1:cost_monthly", 0.5);
      expect(mockPipeline.incrbyfloat).toHaveBeenCalledWith("provider:10:cost_weekly", 0.5);
      expect(mockPipeline.incrbyfloat).toHaveBeenCalledWith("provider:10:cost_monthly", 0.5);
      expect(mockPipeline.expire).toHaveBeenCalledTimes(4);
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it("should skip tracking when Redis is unavailable", async () => {
      getRedisClientMock.mockReturnValue(null as unknown as Redis);

      const evalMock = vi.mocked(mockRedis.eval) as Mock;
      await RateLimitService.trackCost(1, 10, "session-123", 0.5);

      expect(evalMock).not.toHaveBeenCalled();
    });

    it("should skip tracking when cost is 0 or negative", async () => {
      const evalMock = vi.mocked(mockRedis.eval) as Mock;

      await RateLimitService.trackCost(1, 10, "session-123", 0);
      expect(evalMock).not.toHaveBeenCalled();

      await RateLimitService.trackCost(1, 10, "session-123", -0.5);
      expect(evalMock).not.toHaveBeenCalled();
    });

    it("should silently fail on Redis errors", async () => {
      const evalMock = vi.mocked(mockRedis.eval) as Mock;
      evalMock.mockRejectedValue(new Error("Redis error"));

      await expect(RateLimitService.trackCost(1, 10, "session-123", 0.5)).resolves.not.toThrow();
    });
  });

  describe("getCurrentCost", () => {
    it("should return cost from Redis for 5h period", async () => {
      const evalMock = vi.mocked(mockRedis.eval) as Mock;
      evalMock.mockResolvedValue("2.5");

      const existsMock = vi.mocked(mockRedis.exists) as Mock;
      existsMock.mockResolvedValue(1);

      const cost = await RateLimitService.getCurrentCost(1, "key", "5h");

      expect(cost).toBe(2.5);
      expect(evalMock).toHaveBeenCalledWith(
        luaScriptsModule.GET_COST_5H_ROLLING_WINDOW,
        1,
        "key:1:cost_5h_rolling",
        expect.any(String),
        expect.any(String)
      );
    });

    it("should return cost from Redis for weekly period", async () => {
      const getMock = vi.mocked(mockRedis.get) as Mock;
      getMock.mockResolvedValue("5.0");

      const cost = await RateLimitService.getCurrentCost(10, "provider", "weekly");

      expect(cost).toBe(5.0);
      expect(getMock).toHaveBeenCalledWith("provider:10:cost_weekly");
    });

    it("should fallback to database on cache miss for 5h period", async () => {
      const evalMock = vi.mocked(mockRedis.eval) as Mock;
      evalMock.mockResolvedValue("0");

      const existsMock = vi.mocked(mockRedis.exists) as Mock;
      existsMock.mockResolvedValue(0);

      const sumKeyCostMock = vi.fn().mockResolvedValue(1.5);
      vi.mocked(statisticsModule).sumKeyCostInTimeRange = sumKeyCostMock;

      const cost = await RateLimitService.getCurrentCost(1, "key", "5h");

      expect(cost).toBe(1.5);
      expect(sumKeyCostMock).toHaveBeenCalled();
    });

    it("should fallback to database on cache miss for weekly period", async () => {
      const getMock = vi.mocked(mockRedis.get) as Mock;
      getMock.mockResolvedValue(null);

      const sumProviderCostMock = vi.fn().mockResolvedValue(3.5);
      vi.mocked(statisticsModule).sumProviderCostInTimeRange = sumProviderCostMock;

      const setMock = vi.mocked(mockRedis.set) as Mock;
      setMock.mockResolvedValue("OK");

      const cost = await RateLimitService.getCurrentCost(10, "provider", "weekly");

      expect(cost).toBe(3.5);
      expect(sumProviderCostMock).toHaveBeenCalled();
      expect(setMock).toHaveBeenCalledWith("provider:10:cost_weekly", "3.5", "EX", 3600);
    });

    it("should return 0 when key exists but value is 0 (not cache miss)", async () => {
      const evalMock = vi.mocked(mockRedis.eval) as Mock;
      evalMock.mockResolvedValue("0");

      const existsMock = vi.mocked(mockRedis.exists) as Mock;
      existsMock.mockResolvedValue(1); // Key exists

      const cost = await RateLimitService.getCurrentCost(1, "key", "5h");

      expect(cost).toBe(0);
    });

    it("should fallback to database when Redis is unavailable", async () => {
      getRedisClientMock.mockReturnValue(null as unknown as Redis);

      const sumKeyCostMock = vi.fn().mockResolvedValue(2.0);
      vi.mocked(statisticsModule).sumKeyCostInTimeRange = sumKeyCostMock;

      const cost = await RateLimitService.getCurrentCost(1, "key", "5h");

      expect(cost).toBe(2.0);
      expect(sumKeyCostMock).toHaveBeenCalled();
    });

    it("should return 0 on errors", async () => {
      const evalMock = vi.mocked(mockRedis.eval) as Mock;
      evalMock.mockRejectedValue(new Error("Redis error"));

      const cost = await RateLimitService.getCurrentCost(1, "key", "5h");

      expect(cost).toBe(0);
    });
  });

  describe("checkUserRPM", () => {
    it("should allow request when RPM limit is not set", async () => {
      const result = await RateLimitService.checkUserRPM(1, 0);
      expect(result).toEqual({ allowed: true });

      const result2 = await RateLimitService.checkUserRPM(1, -1);
      expect(result2).toEqual({ allowed: true });
    });

    it("should allow request when under RPM limit", async () => {
      const pipelineMock = vi.mocked(mockRedis.pipeline) as Mock;
      const mockPipeline = {
        zremrangebyscore: vi.fn().mockReturnThis(),
        zcard: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi
          .fn()
          .mockResolvedValueOnce([
            [null, 0],
            [null, 5], // current count
          ])
          .mockResolvedValueOnce([[null, 1]]),
      };
      pipelineMock.mockReturnValue(mockPipeline);

      const result = await RateLimitService.checkUserRPM(1, 10);

      expect(result).toEqual({ allowed: true, current: 6 });
      expect(mockPipeline.zadd).toHaveBeenCalled();
    });

    it("should deny request when RPM limit exceeded", async () => {
      const pipelineMock = vi.mocked(mockRedis.pipeline) as Mock;
      const mockPipeline = {
        zremrangebyscore: vi.fn().mockReturnThis(),
        zcard: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 0],
          [null, 10], // count = 10
        ]),
      };
      pipelineMock.mockReturnValue(mockPipeline);

      const result = await RateLimitService.checkUserRPM(1, 10);

      expect(result).toEqual({
        allowed: false,
        reason: "用户每分钟请求数上限已达到（10/10）",
        current: 10,
      });
    });

    it("should implement Fail Open when Redis is unavailable", async () => {
      getRedisClientMock.mockReturnValue(null as unknown as Redis);

      const result = await RateLimitService.checkUserRPM(1, 10);

      expect(result).toEqual({ allowed: true });
    });

    it("should implement Fail Open on Redis errors", async () => {
      const pipelineMock = vi.mocked(mockRedis.pipeline) as Mock;
      pipelineMock.mockReturnValue({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zcard: vi.fn().mockReturnThis(),
        exec: vi.fn().mockRejectedValue(new Error("Redis error")),
      });

      const result = await RateLimitService.checkUserRPM(1, 10);

      expect(result).toEqual({ allowed: true });
    });

    it("should clean up old requests in sliding window", async () => {
      const pipelineMock = vi.mocked(mockRedis.pipeline) as Mock;
      const mockPipeline = {
        zremrangebyscore: vi.fn().mockReturnThis(),
        zcard: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi
          .fn()
          .mockResolvedValueOnce([
            [null, 0],
            [null, 3],
          ])
          .mockResolvedValueOnce([[null, 1]]),
      };
      pipelineMock.mockReturnValue(mockPipeline);

      await RateLimitService.checkUserRPM(1, 10);

      // Should clean up requests older than 1 minute
      expect(mockPipeline.zremrangebyscore).toHaveBeenCalledWith(
        "user:1:rpm_window",
        "-inf",
        expect.any(Number)
      );
    });
  });

  describe("checkUserDailyCost", () => {
    it("should allow request when daily limit is not set", async () => {
      const result = await RateLimitService.checkUserDailyCost(1, 0);
      expect(result).toEqual({ allowed: true });

      const result2 = await RateLimitService.checkUserDailyCost(1, -1);
      expect(result2).toEqual({ allowed: true });
    });

    it("should allow request when under daily limit (Redis cache hit)", async () => {
      const getMock = vi.mocked(mockRedis.get) as Mock;
      getMock.mockResolvedValue("5.0");

      const result = await RateLimitService.checkUserDailyCost(1, 10.0);

      expect(result).toEqual({ allowed: true, current: 5.0 });
      expect(getMock).toHaveBeenCalledWith("user:1:daily_cost");
    });

    it("should deny request when daily limit exceeded", async () => {
      const getMock = vi.mocked(mockRedis.get) as Mock;
      getMock.mockResolvedValue("10.5");

      const result = await RateLimitService.checkUserDailyCost(1, 10.0);

      expect(result).toEqual({
        allowed: false,
        reason: "用户每日消费上限已达到（$10.5000/$10）",
        current: 10.5,
      });
    });

    it("should fallback to database on cache miss", async () => {
      const getMock = vi.mocked(mockRedis.get) as Mock;
      getMock.mockResolvedValue(null);

      const setMock = vi.mocked(mockRedis.set) as Mock;
      setMock.mockResolvedValue("OK");

      const sumUserCostMock = vi.fn().mockResolvedValue(3.5);
      vi.mocked(statisticsModule).sumUserCostToday = sumUserCostMock;

      const result = await RateLimitService.checkUserDailyCost(1, 10.0);

      expect(result).toEqual({ allowed: true, current: 3.5 });
      expect(sumUserCostMock).toHaveBeenCalledWith(1);
      expect(setMock).toHaveBeenCalledWith("user:1:daily_cost", "3.5", "EX", 43200);
    });

    it("should fallback to database when Redis is unavailable", async () => {
      getRedisClientMock.mockReturnValue(null as unknown as Redis);

      const sumUserCostMock = vi.fn().mockResolvedValue(2.0);
      vi.mocked(statisticsModule).sumUserCostToday = sumUserCostMock;

      const result = await RateLimitService.checkUserDailyCost(1, 10.0);

      expect(result).toEqual({ allowed: true, current: 2.0 });
      expect(sumUserCostMock).toHaveBeenCalled();
    });

    it("should implement Fail Open on errors", async () => {
      const getMock = vi.mocked(mockRedis.get) as Mock;
      getMock.mockRejectedValue(new Error("Redis error"));

      const result = await RateLimitService.checkUserDailyCost(1, 10.0);

      expect(result).toEqual({ allowed: true });
    });
  });

  describe("trackUserDailyCost", () => {
    it("should track user daily cost with correct TTL", async () => {
      const pipelineMock = vi.mocked(mockRedis.pipeline) as Mock;
      const mockPipeline = {
        incrbyfloat: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      };
      pipelineMock.mockReturnValue(mockPipeline);

      await RateLimitService.trackUserDailyCost(1, 0.5);

      expect(mockPipeline.incrbyfloat).toHaveBeenCalledWith("user:1:daily_cost", 0.5);
      expect(mockPipeline.expire).toHaveBeenCalledWith("user:1:daily_cost", 43200);
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it("should skip tracking when Redis is unavailable", async () => {
      getRedisClientMock.mockReturnValue(null as unknown as Redis);

      const pipelineMock = vi.mocked(mockRedis.pipeline) as Mock;
      await RateLimitService.trackUserDailyCost(1, 0.5);

      expect(pipelineMock).not.toHaveBeenCalled();
    });

    it("should skip tracking when cost is 0 or negative", async () => {
      const pipelineMock = vi.mocked(mockRedis.pipeline) as Mock;

      await RateLimitService.trackUserDailyCost(1, 0);
      expect(pipelineMock).not.toHaveBeenCalled();

      await RateLimitService.trackUserDailyCost(1, -0.5);
      expect(pipelineMock).not.toHaveBeenCalled();
    });

    it("should silently fail on Redis errors", async () => {
      const pipelineMock = vi.mocked(mockRedis.pipeline) as Mock;
      pipelineMock.mockReturnValue({
        incrbyfloat: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockRejectedValue(new Error("Redis error")),
      });

      await expect(RateLimitService.trackUserDailyCost(1, 0.5)).resolves.not.toThrow();
    });
  });
});
