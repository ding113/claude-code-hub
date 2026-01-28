/**
 * Provider Limit Usage Actions Tests
 *
 * Verifies that getProviderLimitUsage and getProviderLimitUsageBatch
 * use DB direct sums (sumProviderCostInTimeRange) instead of Redis-first reads.
 *
 * Test scenarios:
 * 1. getProviderLimitUsage uses sumProviderCostInTimeRange for all periods
 * 2. getProviderLimitUsageBatch uses parallel DB queries for all providers
 * 3. Correct time ranges are computed for 5h/daily/weekly/monthly
 * 4. dailyResetMode is respected for daily window calculation
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
const getSessionMock = vi.fn();
const findProviderByIdMock = vi.fn();
const sumProviderCostInTimeRangeMock = vi.fn();
const getProviderSessionCountMock = vi.fn();
const getProviderSessionCountBatchMock = vi.fn();
const getTimeRangeForPeriodMock = vi.fn();
const getTimeRangeForPeriodWithModeMock = vi.fn();
const getResetInfoMock = vi.fn();
const getResetInfoWithModeMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getSession: () => getSessionMock(),
}));

vi.mock("@/repository/provider", () => ({
  findProviderById: (id: number) => findProviderByIdMock(id),
  findAllProvidersFresh: vi.fn(async () => []),
  getProviderStatistics: vi.fn(async () => []),
}));

vi.mock("@/repository/statistics", () => ({
  sumProviderCostInTimeRange: (providerId: number, startTime: Date, endTime: Date) =>
    sumProviderCostInTimeRangeMock(providerId, startTime, endTime),
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    getProviderSessionCount: (providerId: number) => getProviderSessionCountMock(providerId),
    getProviderSessionCountBatch: (providerIds: number[]) =>
      getProviderSessionCountBatchMock(providerIds),
  },
}));

vi.mock("@/lib/rate-limit/time-utils", () => ({
  getTimeRangeForPeriod: (period: string, resetTime?: string) =>
    getTimeRangeForPeriodMock(period, resetTime),
  getTimeRangeForPeriodWithMode: (period: string, resetTime?: string, mode?: string) =>
    getTimeRangeForPeriodWithModeMock(period, resetTime, mode),
  getResetInfo: (period: string, resetTime?: string) => getResetInfoMock(period, resetTime),
  getResetInfoWithMode: (period: string, resetTime?: string, mode?: string) =>
    getResetInfoWithModeMock(period, resetTime, mode),
}));

// Mock logger
vi.mock("@/lib/logger", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock rate-limit service - should NOT be called after refactor
const getCurrentCostMock = vi.fn();
const getCurrentCostBatchMock = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  RateLimitService: {
    getCurrentCost: (...args: unknown[]) => getCurrentCostMock(...args),
    getCurrentCostBatch: (...args: unknown[]) => getCurrentCostBatchMock(...args),
  },
}));

describe("getProviderLimitUsage", () => {
  const nowMs = 1700000000000; // Fixed timestamp for testing
  const mockProvider = {
    id: 1,
    name: "Test Provider",
    dailyResetTime: "18:00",
    dailyResetMode: "fixed" as const,
    limit5hUsd: 10,
    limitDailyUsd: 50,
    limitWeeklyUsd: 200,
    limitMonthlyUsd: 500,
    limitConcurrentSessions: 5,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));

    // Default: admin session
    getSessionMock.mockResolvedValue({ user: { role: "admin" } });

    // Default provider lookup
    findProviderByIdMock.mockResolvedValue(mockProvider);

    // Default session count
    getProviderSessionCountMock.mockResolvedValue(2);

    // Default time ranges
    const range5h = {
      startTime: new Date(nowMs - 5 * 60 * 60 * 1000),
      endTime: new Date(nowMs),
    };
    const rangeDaily = {
      startTime: new Date(nowMs - 24 * 60 * 60 * 1000),
      endTime: new Date(nowMs),
    };
    const rangeWeekly = {
      startTime: new Date(nowMs - 7 * 24 * 60 * 60 * 1000),
      endTime: new Date(nowMs),
    };
    const rangeMonthly = {
      startTime: new Date(nowMs - 30 * 24 * 60 * 60 * 1000),
      endTime: new Date(nowMs),
    };

    getTimeRangeForPeriodMock.mockImplementation((period: string) => {
      switch (period) {
        case "5h":
          return Promise.resolve(range5h);
        case "weekly":
          return Promise.resolve(rangeWeekly);
        case "monthly":
          return Promise.resolve(rangeMonthly);
        default:
          return Promise.resolve(rangeDaily);
      }
    });

    getTimeRangeForPeriodWithModeMock.mockResolvedValue(rangeDaily);

    // Default reset info
    getResetInfoMock.mockImplementation((period: string) => {
      if (period === "5h") {
        return Promise.resolve({ type: "rolling", period: "5 小时" });
      }
      return Promise.resolve({
        type: "natural",
        resetAt: new Date(nowMs + 24 * 60 * 60 * 1000),
      });
    });

    getResetInfoWithModeMock.mockResolvedValue({
      type: "custom",
      resetAt: new Date(nowMs + 6 * 60 * 60 * 1000),
    });

    // Default DB costs
    sumProviderCostInTimeRangeMock.mockResolvedValue(5.5);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should use sumProviderCostInTimeRange for all periods instead of RateLimitService", async () => {
    const { getProviderLimitUsage } = await import("@/actions/providers");

    const result = await getProviderLimitUsage(1);

    expect(result.ok).toBe(true);

    // Verify DB function was called for all 4 periods
    expect(sumProviderCostInTimeRangeMock).toHaveBeenCalledTimes(4);

    // Verify RateLimitService.getCurrentCost was NOT called
    expect(getCurrentCostMock).not.toHaveBeenCalled();
  });

  it("should call getTimeRangeForPeriod for 5h/weekly/monthly", async () => {
    const { getProviderLimitUsage } = await import("@/actions/providers");

    await getProviderLimitUsage(1);

    // 5h should use getTimeRangeForPeriod (note: second arg is optional resetTime, defaults to undefined)
    expect(getTimeRangeForPeriodMock).toHaveBeenCalledWith("5h", undefined);
    expect(getTimeRangeForPeriodMock).toHaveBeenCalledWith("weekly", undefined);
    expect(getTimeRangeForPeriodMock).toHaveBeenCalledWith("monthly", undefined);
  });

  it("should call getTimeRangeForPeriodWithMode for daily with provider config", async () => {
    const { getProviderLimitUsage } = await import("@/actions/providers");

    await getProviderLimitUsage(1);

    // daily should use getTimeRangeForPeriodWithMode with provider's reset config
    expect(getTimeRangeForPeriodWithModeMock).toHaveBeenCalledWith(
      "daily",
      "18:00", // provider.dailyResetTime
      "fixed" // provider.dailyResetMode
    );
  });

  it("should respect rolling mode for daily when provider uses rolling", async () => {
    findProviderByIdMock.mockResolvedValue({
      ...mockProvider,
      dailyResetMode: "rolling",
    });

    const { getProviderLimitUsage } = await import("@/actions/providers");

    await getProviderLimitUsage(1);

    expect(getTimeRangeForPeriodWithModeMock).toHaveBeenCalledWith("daily", "18:00", "rolling");
  });

  it("should pass correct time ranges to sumProviderCostInTimeRange", async () => {
    const range5h = {
      startTime: new Date(nowMs - 5 * 60 * 60 * 1000),
      endTime: new Date(nowMs),
    };
    getTimeRangeForPeriodMock.mockImplementation((period: string) => {
      if (period === "5h") return Promise.resolve(range5h);
      return Promise.resolve({
        startTime: new Date(nowMs - 24 * 60 * 60 * 1000),
        endTime: new Date(nowMs),
      });
    });

    const { getProviderLimitUsage } = await import("@/actions/providers");

    await getProviderLimitUsage(1);

    // Check that 5h call received correct time range
    expect(sumProviderCostInTimeRangeMock).toHaveBeenCalledWith(
      1,
      range5h.startTime,
      range5h.endTime
    );
  });

  it("should return correct structure with DB-sourced costs", async () => {
    sumProviderCostInTimeRangeMock
      .mockResolvedValueOnce(1.5) // 5h
      .mockResolvedValueOnce(10.0) // daily
      .mockResolvedValueOnce(45.0) // weekly
      .mockResolvedValueOnce(120.0); // monthly

    const { getProviderLimitUsage } = await import("@/actions/providers");

    const result = await getProviderLimitUsage(1);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.cost5h.current).toBe(1.5);
      expect(result.data.costDaily.current).toBe(10.0);
      expect(result.data.costWeekly.current).toBe(45.0);
      expect(result.data.costMonthly.current).toBe(120.0);
    }
  });

  it("should return error for non-admin user", async () => {
    getSessionMock.mockResolvedValue({ user: { role: "user" } });

    const { getProviderLimitUsage } = await import("@/actions/providers");

    const result = await getProviderLimitUsage(1);

    expect(result.ok).toBe(false);
    expect(sumProviderCostInTimeRangeMock).not.toHaveBeenCalled();
  });

  it("should return error for non-existent provider", async () => {
    findProviderByIdMock.mockResolvedValue(null);

    const { getProviderLimitUsage } = await import("@/actions/providers");

    const result = await getProviderLimitUsage(999);

    expect(result.ok).toBe(false);
    expect(sumProviderCostInTimeRangeMock).not.toHaveBeenCalled();
  });
});

describe("getProviderLimitUsageBatch", () => {
  const nowMs = 1700000000000;
  const mockProviders = [
    {
      id: 1,
      dailyResetTime: "00:00",
      dailyResetMode: "fixed" as const,
      limit5hUsd: 10,
      limitDailyUsd: 50,
      limitWeeklyUsd: 200,
      limitMonthlyUsd: 500,
      limitConcurrentSessions: 5,
    },
    {
      id: 2,
      dailyResetTime: "18:00",
      dailyResetMode: "rolling" as const,
      limit5hUsd: 20,
      limitDailyUsd: 100,
      limitWeeklyUsd: 400,
      limitMonthlyUsd: 1000,
      limitConcurrentSessions: 10,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));

    getSessionMock.mockResolvedValue({ user: { role: "admin" } });

    // Mock batch session counts
    getProviderSessionCountBatchMock.mockResolvedValue(
      new Map([
        [1, 2],
        [2, 5],
      ])
    );

    // Default time ranges
    const range5h = {
      startTime: new Date(nowMs - 5 * 60 * 60 * 1000),
      endTime: new Date(nowMs),
    };
    const rangeDaily = {
      startTime: new Date(nowMs - 24 * 60 * 60 * 1000),
      endTime: new Date(nowMs),
    };
    const rangeWeekly = {
      startTime: new Date(nowMs - 7 * 24 * 60 * 60 * 1000),
      endTime: new Date(nowMs),
    };
    const rangeMonthly = {
      startTime: new Date(nowMs - 30 * 24 * 60 * 60 * 1000),
      endTime: new Date(nowMs),
    };

    getTimeRangeForPeriodMock.mockImplementation((period: string) => {
      switch (period) {
        case "5h":
          return Promise.resolve(range5h);
        case "weekly":
          return Promise.resolve(rangeWeekly);
        case "monthly":
          return Promise.resolve(rangeMonthly);
        default:
          return Promise.resolve(rangeDaily);
      }
    });

    getTimeRangeForPeriodWithModeMock.mockResolvedValue(rangeDaily);

    getResetInfoMock.mockImplementation((period: string) => {
      if (period === "5h") {
        return Promise.resolve({ type: "rolling", period: "5 小时" });
      }
      return Promise.resolve({
        type: "natural",
        resetAt: new Date(nowMs + 24 * 60 * 60 * 1000),
      });
    });

    getResetInfoWithModeMock.mockResolvedValue({
      type: "custom",
      resetAt: new Date(nowMs + 6 * 60 * 60 * 1000),
    });

    sumProviderCostInTimeRangeMock.mockResolvedValue(5.5);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should use sumProviderCostInTimeRange for all providers instead of RateLimitService batch", async () => {
    const { getProviderLimitUsageBatch } = await import("@/actions/providers");

    await getProviderLimitUsageBatch(mockProviders);

    // 2 providers * 4 periods = 8 calls
    expect(sumProviderCostInTimeRangeMock).toHaveBeenCalledTimes(8);

    // Verify RateLimitService.getCurrentCostBatch was NOT called
    expect(getCurrentCostBatchMock).not.toHaveBeenCalled();
  });

  it("should compute time ranges per provider for daily with their specific resetMode", async () => {
    const { getProviderLimitUsageBatch } = await import("@/actions/providers");

    await getProviderLimitUsageBatch(mockProviders);

    // Provider 1: fixed mode
    expect(getTimeRangeForPeriodWithModeMock).toHaveBeenCalledWith("daily", "00:00", "fixed");

    // Provider 2: rolling mode
    expect(getTimeRangeForPeriodWithModeMock).toHaveBeenCalledWith("daily", "18:00", "rolling");
  });

  it("should return empty map for empty providers array", async () => {
    const { getProviderLimitUsageBatch } = await import("@/actions/providers");

    const result = await getProviderLimitUsageBatch([]);

    expect(result.size).toBe(0);
    expect(sumProviderCostInTimeRangeMock).not.toHaveBeenCalled();
  });

  it("should return empty map for non-admin user", async () => {
    getSessionMock.mockResolvedValue({ user: { role: "user" } });

    const { getProviderLimitUsageBatch } = await import("@/actions/providers");

    const result = await getProviderLimitUsageBatch(mockProviders);

    expect(result.size).toBe(0);
    expect(sumProviderCostInTimeRangeMock).not.toHaveBeenCalled();
  });

  it("should return correct costs from DB for each provider", async () => {
    // Mock different costs for different calls
    // Provider 1: 5h=1, daily=10, weekly=40, monthly=100
    // Provider 2: 5h=2, daily=20, weekly=80, monthly=200
    sumProviderCostInTimeRangeMock
      .mockResolvedValueOnce(1) // P1 5h
      .mockResolvedValueOnce(10) // P1 daily
      .mockResolvedValueOnce(40) // P1 weekly
      .mockResolvedValueOnce(100) // P1 monthly
      .mockResolvedValueOnce(2) // P2 5h
      .mockResolvedValueOnce(20) // P2 daily
      .mockResolvedValueOnce(80) // P2 weekly
      .mockResolvedValueOnce(200); // P2 monthly

    const { getProviderLimitUsageBatch } = await import("@/actions/providers");

    const result = await getProviderLimitUsageBatch(mockProviders);

    expect(result.size).toBe(2);

    const p1Data = result.get(1);
    expect(p1Data?.cost5h.current).toBe(1);
    expect(p1Data?.costDaily.current).toBe(10);
    expect(p1Data?.costWeekly.current).toBe(40);
    expect(p1Data?.costMonthly.current).toBe(100);

    const p2Data = result.get(2);
    expect(p2Data?.cost5h.current).toBe(2);
    expect(p2Data?.costDaily.current).toBe(20);
    expect(p2Data?.costWeekly.current).toBe(80);
    expect(p2Data?.costMonthly.current).toBe(200);
  });

  it("should still use SessionTracker for concurrent session counts", async () => {
    const { getProviderLimitUsageBatch } = await import("@/actions/providers");

    await getProviderLimitUsageBatch(mockProviders);

    expect(getProviderSessionCountBatchMock).toHaveBeenCalledWith([1, 2]);
  });
});
