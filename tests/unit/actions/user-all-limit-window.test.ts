/**
 * user-all-limit-window tests
 *
 * Verify getUserAllLimitUsage correctly uses getTimeRangeForPeriodWithMode for daily window,
 * respecting user.dailyResetMode configuration.
 *
 * Rolling mode: past 24 hours window
 * Fixed mode: since reset time window
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock functions
const getSessionMock = vi.fn();
const findUserByIdMock = vi.fn();
const getTimeRangeForPeriodMock = vi.fn();
const getTimeRangeForPeriodWithModeMock = vi.fn();
const sumUserCostInTimeRangeMock = vi.fn();
const sumUserTotalCostMock = vi.fn();

// Mock modules
vi.mock("@/lib/auth", () => ({
  getSession: () => getSessionMock(),
}));

vi.mock("@/repository/user", () => ({
  findUserById: (...args: unknown[]) => findUserByIdMock(...args),
}));

vi.mock("@/lib/rate-limit/time-utils", () => ({
  getTimeRangeForPeriod: (...args: unknown[]) => getTimeRangeForPeriodMock(...args),
  getTimeRangeForPeriodWithMode: (...args: unknown[]) => getTimeRangeForPeriodWithModeMock(...args),
}));

vi.mock("@/repository/statistics", () => ({
  sumUserCostInTimeRange: (...args: unknown[]) => sumUserCostInTimeRangeMock(...args),
  sumUserTotalCost: (...args: unknown[]) => sumUserTotalCostMock(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(() => async (key: string) => key),
  getLocale: vi.fn(() => "en"),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("getUserAllLimitUsage - daily window mode handling", () => {
  const now = new Date("2024-06-15T12:00:00.000Z");
  const past24h = new Date("2024-06-14T12:00:00.000Z");
  const fixedReset = new Date("2024-06-15T00:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    // Default: admin session
    getSessionMock.mockResolvedValue({
      user: { id: 1, role: "admin" },
      key: { id: 1 },
    });

    // Default time range mocks
    getTimeRangeForPeriodMock.mockImplementation(async (period: string) => {
      switch (period) {
        case "5h":
          return { startTime: new Date(now.getTime() - 5 * 60 * 60 * 1000), endTime: now };
        case "weekly":
          return { startTime: new Date("2024-06-10T00:00:00.000Z"), endTime: now };
        case "monthly":
          return { startTime: new Date("2024-06-01T00:00:00.000Z"), endTime: now };
        default:
          return { startTime: fixedReset, endTime: now };
      }
    });

    getTimeRangeForPeriodWithModeMock.mockImplementation(
      async (period: string, _resetTime: string, mode: string) => {
        if (period === "daily" && mode === "rolling") {
          return { startTime: past24h, endTime: now };
        }
        // fixed mode
        return { startTime: fixedReset, endTime: now };
      }
    );

    // Default cost mocks
    sumUserCostInTimeRangeMock.mockResolvedValue(1.0);
    sumUserTotalCostMock.mockResolvedValue(10.0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should use rolling mode (past 24h) when user.dailyResetMode is rolling", async () => {
    // User with rolling mode
    findUserByIdMock.mockResolvedValue({
      id: 1,
      name: "Test User",
      dailyResetMode: "rolling",
      dailyResetTime: "00:00",
      dailyQuota: 10,
      limit5hUsd: null,
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
    });

    const { getUserAllLimitUsage } = await import("@/actions/users");
    const result = await getUserAllLimitUsage(1);

    expect(result.ok).toBe(true);

    // Verify getTimeRangeForPeriodWithMode was called with rolling mode
    expect(getTimeRangeForPeriodWithModeMock).toHaveBeenCalledWith("daily", "00:00", "rolling");
  });

  it("should use fixed mode when user.dailyResetMode is fixed", async () => {
    // User with fixed mode
    findUserByIdMock.mockResolvedValue({
      id: 1,
      name: "Test User",
      dailyResetMode: "fixed",
      dailyResetTime: "18:00",
      dailyQuota: 10,
      limit5hUsd: null,
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
    });

    const { getUserAllLimitUsage } = await import("@/actions/users");
    const result = await getUserAllLimitUsage(1);

    expect(result.ok).toBe(true);

    // Verify getTimeRangeForPeriodWithMode was called with fixed mode and custom reset time
    expect(getTimeRangeForPeriodWithModeMock).toHaveBeenCalledWith("daily", "18:00", "fixed");
  });

  it("should default to fixed mode when dailyResetMode is not set", async () => {
    // User without explicit dailyResetMode (defaults to fixed)
    findUserByIdMock.mockResolvedValue({
      id: 1,
      name: "Test User",
      dailyResetMode: undefined, // or null
      dailyResetTime: "00:00",
      dailyQuota: 10,
      limit5hUsd: null,
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
    });

    const { getUserAllLimitUsage } = await import("@/actions/users");
    const result = await getUserAllLimitUsage(1);

    expect(result.ok).toBe(true);

    // Should default to fixed mode
    expect(getTimeRangeForPeriodWithModeMock).toHaveBeenCalledWith("daily", "00:00", "fixed");
  });

  it("should pass correct dailyResetTime from user config", async () => {
    findUserByIdMock.mockResolvedValue({
      id: 1,
      name: "Test User",
      dailyResetMode: "fixed",
      dailyResetTime: "09:30", // Custom reset time
      dailyQuota: 10,
      limit5hUsd: null,
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
    });

    const { getUserAllLimitUsage } = await import("@/actions/users");
    await getUserAllLimitUsage(1);

    // Verify custom reset time is passed
    expect(getTimeRangeForPeriodWithModeMock).toHaveBeenCalledWith("daily", "09:30", "fixed");
  });

  it("should default to 00:00 when dailyResetTime is not set", async () => {
    findUserByIdMock.mockResolvedValue({
      id: 1,
      name: "Test User",
      dailyResetMode: "fixed",
      dailyResetTime: undefined, // or null
      dailyQuota: 10,
      limit5hUsd: null,
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
    });

    const { getUserAllLimitUsage } = await import("@/actions/users");
    await getUserAllLimitUsage(1);

    // Should default to "00:00"
    expect(getTimeRangeForPeriodWithModeMock).toHaveBeenCalledWith("daily", "00:00", "fixed");
  });

  it("should NOT use getTimeRangeForPeriod for daily (consistency with getUserLimitUsage)", async () => {
    findUserByIdMock.mockResolvedValue({
      id: 1,
      name: "Test User",
      dailyResetMode: "rolling",
      dailyResetTime: "00:00",
      dailyQuota: 10,
      limit5hUsd: null,
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
    });

    const { getUserAllLimitUsage } = await import("@/actions/users");
    await getUserAllLimitUsage(1);

    // getTimeRangeForPeriod should only be called for 5h, weekly, monthly - NOT daily
    const dailyCalls = getTimeRangeForPeriodMock.mock.calls.filter((call) => call[0] === "daily");
    expect(dailyCalls).toHaveLength(0);
  });

  it("should still use getTimeRangeForPeriod for non-daily periods", async () => {
    findUserByIdMock.mockResolvedValue({
      id: 1,
      name: "Test User",
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      dailyQuota: 10,
      limit5hUsd: 5,
      limitWeeklyUsd: 50,
      limitMonthlyUsd: 200,
      limitTotalUsd: null,
    });

    const { getUserAllLimitUsage } = await import("@/actions/users");
    await getUserAllLimitUsage(1);

    // Verify other periods still use getTimeRangeForPeriod
    expect(getTimeRangeForPeriodMock).toHaveBeenCalledWith("5h");
    expect(getTimeRangeForPeriodMock).toHaveBeenCalledWith("weekly");
    expect(getTimeRangeForPeriodMock).toHaveBeenCalledWith("monthly");
  });
});

describe("getUserAllLimitUsage - consistency with key-quota.ts", () => {
  const now = new Date("2024-06-15T12:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    getSessionMock.mockResolvedValue({
      user: { id: 1, role: "admin" },
      key: { id: 1 },
    });

    getTimeRangeForPeriodMock.mockImplementation(async (period: string) => {
      switch (period) {
        case "5h":
          return { startTime: new Date(now.getTime() - 5 * 60 * 60 * 1000), endTime: now };
        case "weekly":
          return { startTime: new Date("2024-06-10T00:00:00.000Z"), endTime: now };
        case "monthly":
          return { startTime: new Date("2024-06-01T00:00:00.000Z"), endTime: now };
        default:
          return { startTime: new Date("2024-06-15T00:00:00.000Z"), endTime: now };
      }
    });

    getTimeRangeForPeriodWithModeMock.mockResolvedValue({
      startTime: new Date("2024-06-15T00:00:00.000Z"),
      endTime: now,
    });

    sumUserCostInTimeRangeMock.mockResolvedValue(1.0);
    sumUserTotalCostMock.mockResolvedValue(10.0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should match key-quota.ts pattern: getTimeRangeForPeriodWithMode for daily", async () => {
    // key-quota.ts line 91-95:
    // const keyDailyTimeRange = await getTimeRangeForPeriodWithMode(
    //   "daily",
    //   keyRow.dailyResetTime ?? "00:00",
    //   (keyRow.dailyResetMode as DailyResetMode | undefined) ?? "fixed"
    // );

    findUserByIdMock.mockResolvedValue({
      id: 1,
      name: "Test User",
      dailyResetMode: "rolling",
      dailyResetTime: "12:00",
      dailyQuota: 10,
      limit5hUsd: null,
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
    });

    const { getUserAllLimitUsage } = await import("@/actions/users");
    await getUserAllLimitUsage(1);

    // Should use getTimeRangeForPeriodWithMode matching key-quota.ts pattern
    expect(getTimeRangeForPeriodWithModeMock).toHaveBeenCalledWith("daily", "12:00", "rolling");
  });
});
