import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let redisClient: { status: string } | null = null;

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => redisClient,
}));

const statisticsMock = {
  sumKeyTotalCost: vi.fn(async () => 0),
  sumUserTotalCost: vi.fn(async () => 0),
  sumUserCostToday: vi.fn(async () => 0),
  sumUserCostInTimeRange: vi.fn(async () => 0),
  sumKeyCostInTimeRange: vi.fn(async () => 0),
  sumProviderCostInTimeRange: vi.fn(async () => 0),
  findKeyCostEntriesInTimeRange: vi.fn(async () => []),
  findProviderCostEntriesInTimeRange: vi.fn(async () => []),
  findUserCostEntriesInTimeRange: vi.fn(async () => []),
};

vi.mock("@/repository/statistics", () => statisticsMock);

describe("RateLimitService.checkUserDailyCost - dailyResetTime/dailyResetMode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    redisClient = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fixed 模式：当前时间在重置点之前时，应从昨天重置点开始统计", async () => {
    // Asia/Shanghai: 2026-01-02 17:00 => 2026-01-02T09:00:00.000Z
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 2, 9, 0, 0)));
    statisticsMock.sumUserCostInTimeRange.mockResolvedValueOnce(1.23);

    const { RateLimitService } = await import("@/lib/rate-limit");
    const result = await RateLimitService.checkUserDailyCost(123, 10, "18:00", "fixed");

    expect(result.allowed).toBe(true);
    expect(result.current).toBeCloseTo(1.23, 10);

    expect(statisticsMock.sumUserCostInTimeRange).toHaveBeenCalledTimes(1);
    const [, startTime, endTime] = statisticsMock.sumUserCostInTimeRange.mock.calls[0];

    // 2026-01-01 18:00 Asia/Shanghai => 2026-01-01T10:00:00.000Z
    expect((startTime as Date).toISOString()).toBe("2026-01-01T10:00:00.000Z");
    expect((endTime as Date).toISOString()).toBe("2026-01-02T09:00:00.000Z");
    expect(statisticsMock.sumUserCostToday).not.toHaveBeenCalled();
  });

  it("fixed 模式：当前时间在重置点之后时，应从今天重置点开始统计", async () => {
    // Asia/Shanghai: 2026-01-02 20:00 => 2026-01-02T12:00:00.000Z
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 2, 12, 0, 0)));
    statisticsMock.sumUserCostInTimeRange.mockResolvedValueOnce(2);

    const { RateLimitService } = await import("@/lib/rate-limit");
    const result = await RateLimitService.checkUserDailyCost(123, 10, "18:00", "fixed");

    expect(result.allowed).toBe(true);
    expect(result.current).toBeCloseTo(2, 10);

    const [, startTime] = statisticsMock.sumUserCostInTimeRange.mock.calls[0];
    // 2026-01-02 18:00 Asia/Shanghai => 2026-01-02T10:00:00.000Z
    expect((startTime as Date).toISOString()).toBe("2026-01-02T10:00:00.000Z");
    expect(statisticsMock.sumUserCostToday).not.toHaveBeenCalled();
  });

  it("rolling 模式：Redis 不可用时应使用过去 24 小时窗口统计", async () => {
    const now = new Date(Date.UTC(2026, 0, 2, 12, 0, 0));
    vi.setSystemTime(now);
    statisticsMock.sumUserCostInTimeRange.mockResolvedValueOnce(3);

    const { RateLimitService } = await import("@/lib/rate-limit");
    const result = await RateLimitService.checkUserDailyCost(123, 10, "18:00", "rolling");

    expect(result.allowed).toBe(true);
    expect(result.current).toBeCloseTo(3, 10);

    const [, startTime, endTime] = statisticsMock.sumUserCostInTimeRange.mock.calls[0];
    expect((endTime as Date).toISOString()).toBe(now.toISOString());
    expect((startTime as Date).toISOString()).toBe(
      new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    );
    expect(statisticsMock.sumUserCostToday).not.toHaveBeenCalled();
  });
});
