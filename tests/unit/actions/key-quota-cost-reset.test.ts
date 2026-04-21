import { beforeEach, describe, expect, test, vi } from "vitest";
import { ERROR_CODES } from "@/lib/utils/error-messages";

// Mock getSession
const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

// Mock next-intl
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
  getLocale: vi.fn(async () => "en"),
}));

// Mock getSystemSettings
const getSystemSettingsMock = vi.fn();
vi.mock("@/repository/system-config", () => ({
  getSystemSettings: getSystemSettingsMock,
}));

// Mock statistics
const sumKeyCostInTimeRangeMock = vi.fn();
const sumKeyTotalCostMock = vi.fn();
vi.mock("@/repository/statistics", () => ({
  sumKeyCostInTimeRange: sumKeyCostInTimeRangeMock,
  sumKeyTotalCost: sumKeyTotalCostMock,
}));

// Mock time-utils
const getTimeRangeForPeriodWithModeMock = vi.fn();
const getTimeRangeForPeriodMock = vi.fn();
vi.mock("@/lib/rate-limit/time-utils", () => ({
  getTimeRangeForPeriodWithMode: getTimeRangeForPeriodWithModeMock,
  getTimeRangeForPeriod: getTimeRangeForPeriodMock,
}));

const getCurrentCostMock = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  RateLimitService: {
    getCurrentCost: getCurrentCostMock,
  },
}));

// Mock SessionTracker
const getKeySessionCountMock = vi.fn();
vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: { getKeySessionCount: getKeySessionCountMock },
}));

// Mock resolveKeyConcurrentSessionLimit
vi.mock("@/lib/rate-limit/concurrent-session-limit", () => ({
  resolveKeyConcurrentSessionLimit: vi.fn(() => 0),
}));

// Mock logger
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock drizzle db - need select().from().leftJoin().where().limit() chain
const dbLimitMock = vi.fn();
const dbWhereMock = vi.fn(() => ({ limit: dbLimitMock }));
const dbLeftJoinMock = vi.fn(() => ({ where: dbWhereMock }));
const dbFromMock = vi.fn(() => ({ leftJoin: dbLeftJoinMock }));
const dbSelectMock = vi.fn(() => ({ from: dbFromMock }));
vi.mock("@/drizzle/db", () => ({
  db: { select: dbSelectMock },
}));

// Common date fixtures
const NOW = new Date("2026-03-01T12:00:00Z");
const FIVE_HOURS_AGO = new Date("2026-03-01T07:00:00Z");
const DAILY_START = new Date("2026-03-01T00:00:00Z");
const WEEKLY_START = new Date("2026-02-23T00:00:00Z");
const MONTHLY_START = new Date("2026-02-01T00:00:00Z");

function makeTimeRange(startTime: Date, endTime: Date = NOW) {
  return { startTime, endTime };
}

const DEFAULT_KEY_ROW = {
  id: 42,
  key: "sk-test-key-hash",
  name: "Test Key",
  userId: 10,
  isEnabled: true,
  dailyResetTime: "00:00",
  dailyResetMode: "fixed",
  limit5hUsd: "10.00",
  limit5hResetMode: "rolling",
  limitDailyUsd: "20.00",
  limitWeeklyUsd: "50.00",
  limitMonthlyUsd: "100.00",
  limitTotalUsd: "500.00",
  limitConcurrentSessions: 0,
  deletedAt: null,
};

function setupTimeRangeMocks() {
  getTimeRangeForPeriodWithModeMock.mockResolvedValue(makeTimeRange(DAILY_START));
  getTimeRangeForPeriodMock.mockImplementation(async (period: string) => {
    switch (period) {
      case "5h":
        return makeTimeRange(FIVE_HOURS_AGO);
      case "weekly":
        return makeTimeRange(WEEKLY_START);
      case "monthly":
        return makeTimeRange(MONTHLY_START);
      default:
        return makeTimeRange(DAILY_START);
    }
  });
}

function setupDefaultMocks(costResetAt: Date | null = null) {
  getSessionMock.mockResolvedValue({ user: { id: 10, role: "user" } });
  getSystemSettingsMock.mockResolvedValue({ currencyDisplay: "USD" });
  dbLimitMock.mockResolvedValue([
    {
      key: DEFAULT_KEY_ROW,
      userLimitConcurrentSessions: null,
      userCostResetAt: costResetAt,
    },
  ]);
  setupTimeRangeMocks();
  getCurrentCostMock.mockResolvedValue(1.5);
  sumKeyCostInTimeRangeMock.mockResolvedValue(1.5);
  sumKeyTotalCostMock.mockResolvedValue(10.0);
  getKeySessionCountMock.mockResolvedValue(2);
}

describe("getKeyQuotaUsage costResetAt clipping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("user with costResetAt -- period costs use clipped startTime", async () => {
    // costResetAt is 2 hours ago -- should clip 5h range (7h ago) but not daily (midnight)
    const costResetAt = new Date("2026-03-01T10:00:00Z");
    setupDefaultMocks(costResetAt);

    const { getKeyQuotaUsage } = await import("@/actions/key-quota");
    const result = await getKeyQuotaUsage(42);

    expect(result.ok).toBe(true);

    expect(sumKeyCostInTimeRangeMock).toHaveBeenCalledTimes(4);
    // 1st call = 5h: clipped (07:00 < 10:00)
    expect(sumKeyCostInTimeRangeMock).toHaveBeenNthCalledWith(1, 42, costResetAt, NOW);
    // 2nd call = daily: clipped (00:00 < 10:00)
    expect(sumKeyCostInTimeRangeMock).toHaveBeenNthCalledWith(2, 42, costResetAt, NOW);
    // 3rd call = weekly: clipped (Feb 23 < Mar 1 10:00)
    expect(sumKeyCostInTimeRangeMock).toHaveBeenNthCalledWith(3, 42, costResetAt, NOW);
    // 4th call = monthly: clipped (Feb 1 < Mar 1 10:00)
    expect(sumKeyCostInTimeRangeMock).toHaveBeenNthCalledWith(4, 42, costResetAt, NOW);

    // sumKeyTotalCost receives costResetAt as 3rd argument
    expect(sumKeyTotalCostMock).toHaveBeenCalledWith("sk-test-key-hash", Infinity, costResetAt);
  });

  test("user without costResetAt (null) -- original time ranges unchanged", async () => {
    setupDefaultMocks(null);

    const { getKeyQuotaUsage } = await import("@/actions/key-quota");
    const result = await getKeyQuotaUsage(42);

    expect(result.ok).toBe(true);

    // 5h: original start used (no clipping)
    expect(sumKeyCostInTimeRangeMock).toHaveBeenCalledWith(42, FIVE_HOURS_AGO, NOW);
    // daily: original start
    expect(sumKeyCostInTimeRangeMock).toHaveBeenCalledWith(42, DAILY_START, NOW);
    // weekly
    expect(sumKeyCostInTimeRangeMock).toHaveBeenCalledWith(42, WEEKLY_START, NOW);
    // monthly
    expect(sumKeyCostInTimeRangeMock).toHaveBeenCalledWith(42, MONTHLY_START, NOW);
    // total cost: null costResetAt
    expect(sumKeyTotalCostMock).toHaveBeenCalledWith("sk-test-key-hash", Infinity, null);
  });

  test("costResetAt older than all period starts -- no clipping effect", async () => {
    // costResetAt is 1 year ago, older than even monthly start
    const costResetAt = new Date("2025-01-01T00:00:00Z");
    setupDefaultMocks(costResetAt);

    const { getKeyQuotaUsage } = await import("@/actions/key-quota");
    const result = await getKeyQuotaUsage(42);

    expect(result.ok).toBe(true);

    // clipStart returns original start because costResetAt < start
    expect(sumKeyCostInTimeRangeMock).toHaveBeenCalledWith(42, FIVE_HOURS_AGO, NOW);
    expect(sumKeyCostInTimeRangeMock).toHaveBeenCalledWith(42, DAILY_START, NOW);
    expect(sumKeyCostInTimeRangeMock).toHaveBeenCalledWith(42, WEEKLY_START, NOW);
    expect(sumKeyCostInTimeRangeMock).toHaveBeenCalledWith(42, MONTHLY_START, NOW);
    // total still receives costResetAt (sumKeyTotalCost handles it internally)
    expect(sumKeyTotalCostMock).toHaveBeenCalledWith("sk-test-key-hash", Infinity, costResetAt);
  });

  test("costResetAt in the middle of daily range -- clips daily correctly", async () => {
    // costResetAt is 6AM today -- after daily start (midnight) but before now (noon)
    const costResetAt = new Date("2026-03-01T06:00:00Z");
    setupDefaultMocks(costResetAt);

    const { getKeyQuotaUsage } = await import("@/actions/key-quota");
    const result = await getKeyQuotaUsage(42);

    expect(result.ok).toBe(true);

    // Daily start (midnight) < costResetAt (6AM) => clipped
    // Check the second call (daily) uses costResetAt
    const calls = sumKeyCostInTimeRangeMock.mock.calls;
    // 5h call: 7AM > 6AM => 5h start is AFTER costResetAt, so original 5h start used
    expect(calls[0]).toEqual([42, FIVE_HOURS_AGO, NOW]);
    // daily call: midnight < 6AM => clipped to costResetAt
    expect(calls[1]).toEqual([42, costResetAt, NOW]);
    // weekly: before costResetAt => clipped
    expect(calls[2]).toEqual([42, costResetAt, NOW]);
    // monthly: before costResetAt => clipped
    expect(calls[3]).toEqual([42, costResetAt, NOW]);
  });

  test("permission denied for non-owner non-admin", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 99, role: "user" } });
    getSystemSettingsMock.mockResolvedValue({ currencyDisplay: "USD" });
    dbLimitMock.mockResolvedValue([
      {
        key: { ...DEFAULT_KEY_ROW, userId: 10 },
        userLimitConcurrentSessions: null,
        userCostResetAt: null,
      },
    ]);

    const { getKeyQuotaUsage } = await import("@/actions/key-quota");
    const result = await getKeyQuotaUsage(42);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.PERMISSION_DENIED);
    expect(sumKeyCostInTimeRangeMock).not.toHaveBeenCalled();
  });

  test("key not found", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 10, role: "admin" } });
    dbLimitMock.mockResolvedValue([]);

    const { getKeyQuotaUsage } = await import("@/actions/key-quota");
    const result = await getKeyQuotaUsage(999);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODES.NOT_FOUND);
  });
});
