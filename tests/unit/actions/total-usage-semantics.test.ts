/**
 * total-usage-semantics tests
 *
 * Verify that total usage reads in display paths use ALL_TIME_MAX_AGE_DAYS (Infinity)
 * to skip the date filter entirely, querying all-time data.
 *
 * Key insight: The usage/quota aggregation functions default maxAgeDays to 365.
 * For display purposes (showing "total" usage), we want all-time semantics, which
 * means passing Infinity to skip the date filter.
 *
 * IMPORTANT: This test only covers DISPLAY paths. Enforcement paths (RateLimitService)
 * are intentionally NOT modified.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// All-time max age constant - Infinity means no date filter
const ALL_TIME_MAX_AGE_DAYS = Infinity;

// Mock functions
const getSessionMock = vi.fn();
const sumUserTotalCostMock = vi.fn();
const sumKeyQuotaCostsByIdMock = vi.fn();
const sumUserQuotaCostsMock = vi.fn();
const sumUserCostInTimeRangeMock = vi.fn();
const getTimeRangeForPeriodMock = vi.fn();
const getTimeRangeForPeriodWithModeMock = vi.fn();
const getCurrentCostMock = vi.fn();
const getKeySessionCountMock = vi.fn();
const getUserSessionCountMock = vi.fn();
const findUserByIdMock = vi.fn();

// Mock modules
vi.mock("@/lib/auth", () => ({
  getSession: () => getSessionMock(),
}));

vi.mock("@/repository/statistics", () => ({
  sumUserCostInTimeRange: (...args: unknown[]) => sumUserCostInTimeRangeMock(...args),
  sumUserTotalCost: (...args: unknown[]) => sumUserTotalCostMock(...args),
  sumKeyQuotaCostsById: (...args: unknown[]) => sumKeyQuotaCostsByIdMock(...args),
  sumUserQuotaCosts: (...args: unknown[]) => sumUserQuotaCostsMock(...args),
}));

vi.mock("@/lib/rate-limit/time-utils", () => ({
  getTimeRangeForPeriod: (...args: unknown[]) => getTimeRangeForPeriodMock(...args),
  getTimeRangeForPeriodWithMode: (...args: unknown[]) => getTimeRangeForPeriodWithModeMock(...args),
}));

vi.mock("@/lib/rate-limit/service", () => ({
  RateLimitService: {
    getCurrentCost: (...args: unknown[]) => getCurrentCostMock(...args),
  },
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    getKeySessionCount: (...args: unknown[]) => getKeySessionCountMock(...args),
    getUserSessionCount: (...args: unknown[]) => getUserSessionCountMock(...args),
  },
}));

vi.mock("@/repository/user", () => ({
  findUserById: (...args: unknown[]) => findUserByIdMock(...args),
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
  getTranslations: vi.fn(() => (key: string) => key),
}));

describe("total-usage-semantics", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default time range mocks
    const now = new Date();
    const defaultRange = { startTime: now, endTime: now };
    getTimeRangeForPeriodMock.mockResolvedValue(defaultRange);
    getTimeRangeForPeriodWithModeMock.mockResolvedValue(defaultRange);

    // Default cost mocks
    sumUserTotalCostMock.mockResolvedValue(0);
    sumUserCostInTimeRangeMock.mockResolvedValue(0);
    getCurrentCostMock.mockResolvedValue(0);
    getKeySessionCountMock.mockResolvedValue(0);
    getUserSessionCountMock.mockResolvedValue(0);

    const emptyCosts = {
      cost5h: 0,
      costDaily: 0,
      costWeekly: 0,
      costMonthly: 0,
      costTotal: 0,
    };
    sumKeyQuotaCostsByIdMock.mockResolvedValue(emptyCosts);
    sumUserQuotaCostsMock.mockResolvedValue(emptyCosts);
  });

  describe("getMyQuota in my-usage.ts", () => {
    it("should call sumKeyQuotaCostsById with ALL_TIME_MAX_AGE_DAYS for key total cost", async () => {
      // Setup session mock
      getSessionMock.mockResolvedValue({
        key: {
          id: 1,
          key: "test-key-hash",
          name: "Test Key",
          dailyResetTime: "00:00",
          dailyResetMode: "fixed",
          limit5hUsd: null,
          limitDailyUsd: null,
          limitWeeklyUsd: null,
          limitMonthlyUsd: null,
          limitTotalUsd: null,
          limitConcurrentSessions: null,
          providerGroup: null,
          isEnabled: true,
          expiresAt: null,
        },
        user: {
          id: 1,
          name: "Test User",
          dailyResetTime: "00:00",
          dailyResetMode: "fixed",
          limit5hUsd: null,
          dailyQuota: null,
          limitWeeklyUsd: null,
          limitMonthlyUsd: null,
          limitTotalUsd: null,
          limitConcurrentSessions: null,
          rpm: null,
          providerGroup: null,
          isEnabled: true,
          expiresAt: null,
          allowedModels: [],
          allowedClients: [],
        },
      });

      // Import and call the function
      const { getMyQuota } = await import("@/actions/my-usage");
      await getMyQuota();

      expect(sumKeyQuotaCostsByIdMock).toHaveBeenCalledWith(
        1,
        expect.any(Object),
        ALL_TIME_MAX_AGE_DAYS,
        null
      );
    });

    it("should call sumUserQuotaCosts with ALL_TIME_MAX_AGE_DAYS for user total cost", async () => {
      // Setup session mock
      getSessionMock.mockResolvedValue({
        key: {
          id: 1,
          key: "test-key-hash",
          name: "Test Key",
          dailyResetTime: "00:00",
          dailyResetMode: "fixed",
          limit5hUsd: null,
          limitDailyUsd: null,
          limitWeeklyUsd: null,
          limitMonthlyUsd: null,
          limitTotalUsd: null,
          limitConcurrentSessions: null,
          providerGroup: null,
          isEnabled: true,
          expiresAt: null,
        },
        user: {
          id: 1,
          name: "Test User",
          dailyResetTime: "00:00",
          dailyResetMode: "fixed",
          limit5hUsd: null,
          dailyQuota: null,
          limitWeeklyUsd: null,
          limitMonthlyUsd: null,
          limitTotalUsd: null,
          limitConcurrentSessions: null,
          rpm: null,
          providerGroup: null,
          isEnabled: true,
          expiresAt: null,
          allowedModels: [],
          allowedClients: [],
        },
      });

      // Import and call the function
      const { getMyQuota } = await import("@/actions/my-usage");
      await getMyQuota();

      expect(sumUserQuotaCostsMock).toHaveBeenCalledWith(
        1,
        expect.any(Object),
        ALL_TIME_MAX_AGE_DAYS,
        null
      );
    });

    it("should keep local usage API compatibility fields on getMyQuota", async () => {
      getSessionMock.mockResolvedValue({
        key: {
          id: 1,
          key: "test-key-hash",
          name: "Test Key",
          dailyResetTime: "00:00",
          dailyResetMode: "fixed",
          limit5hUsd: 10,
          limitDailyUsd: 20,
          limitWeeklyUsd: 30,
          limitMonthlyUsd: 40,
          limitTotalUsd: null,
          limitConcurrentSessions: 3,
          providerGroup: "default",
          isEnabled: true,
          expiresAt: null,
        },
        user: {
          id: 1,
          name: "Test User",
          dailyResetTime: "00:00",
          dailyResetMode: "fixed",
          limit5hUsd: 12,
          dailyQuota: 15,
          limitWeeklyUsd: 25,
          limitMonthlyUsd: 35,
          limitTotalUsd: null,
          limitConcurrentSessions: 2,
          rpm: 60,
          providerGroup: "default",
          isEnabled: true,
          expiresAt: null,
          allowedModels: ["gpt-5.3-codex"],
          allowedClients: ["codex-cli"],
        },
      });
      sumKeyQuotaCostsByIdMock.mockResolvedValue({
        cost5h: 2,
        costDaily: 3,
        costWeekly: 4,
        costMonthly: 5,
        costTotal: 6,
      });
      sumUserQuotaCostsMock.mockResolvedValue({
        cost5h: 1,
        costDaily: 2,
        costWeekly: 3,
        costMonthly: 4,
        costTotal: 5,
      });
      getKeySessionCountMock.mockResolvedValue(1);
      getUserSessionCountMock.mockResolvedValue(2);

      const { getMyQuota } = await import("@/actions/my-usage");
      const result = await getMyQuota();

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.providerGroup).toBe("default");
      expect(result.data.userRpmLimit).toBe(60);
      expect(result.data.rpmLimit).toBe(60);
      expect(result.data.unit).toBe("USD");
      expect(result.data.resetMode).toBe("fixed");
      expect(result.data.resetTime).toBe("00:00");
      expect(result.data.userAllowedModels).toEqual(["gpt-5.3-codex"]);
      expect(result.data.userAllowedClients).toEqual(["codex-cli"]);
      expect(result.data.limit5hUsd).toBe(10);
      expect(result.data.used5hUsd).toBe(2);
      expect(result.data.remaining5hUsd).toBe(8);
      expect(result.data.limitDailyUsd).toBe(15);
      expect(result.data.usedDailyUsd).toBe(2);
      expect(result.data.remainingDailyUsd).toBe(13);
      expect(result.data.limitWeeklyUsd).toBe(25);
      expect(result.data.usedWeeklyUsd).toBe(3);
      expect(result.data.remainingWeeklyUsd).toBe(22);
      expect(result.data.limitMonthlyUsd).toBe(35);
      expect(result.data.usedMonthlyUsd).toBe(4);
      expect(result.data.remainingMonthlyUsd).toBe(31);
      expect(result.data.limitTotalUsd).toBe(35);
      expect(result.data.usedTotalUsd).toBe(5);
      expect(result.data.remainingTotalUsd).toBe(30);
      expect(result.data.remaining).toBe(8);
      expect(result.data.remainingPercent).toBeCloseTo(80, 6);
      expect(result.data.concurrentSessions).toBe(2);
      expect(result.data.concurrentSessionsLimit).toBe(3);
      expect(result.data.todayUsedUsd).toBe(result.data.quotaWindows.daily.usedUsd);
      expect(result.data.todayRemainingUsd).toBe(result.data.quotaWindows.daily.remainingUsd);
      expect(result.data.todayUsedPercent).toBe(result.data.quotaWindows.daily.usedPercent);
      expect(result.data.todayRemainingPercent).toBe(
        result.data.quotaWindows.daily.remainingPercent
      );
      expect(result.data.quotaWindows.fiveHour).toMatchObject({
        period: "5h",
        limitUsd: 10,
        usedUsd: 2,
        remainingUsd: 8,
        isUnlimited: false,
        isExhausted: false,
      });
      expect(result.data.quotaWindows.daily).toMatchObject({
        period: "daily",
        limitUsd: 15,
        usedUsd: 2,
        remainingUsd: 13,
        isUnlimited: false,
        isExhausted: false,
      });
      expect(result.data.quotaWindows.weekly).toMatchObject({
        period: "weekly",
        limitUsd: 25,
        usedUsd: 3,
        remainingUsd: 22,
        isUnlimited: false,
        isExhausted: false,
      });
      expect(result.data.quotaWindows.monthly).toMatchObject({
        period: "monthly",
        limitUsd: 35,
        usedUsd: 4,
        remainingUsd: 31,
        isUnlimited: false,
        isExhausted: false,
      });
      expect(result.data.quotaWindows.total).toMatchObject({
        period: "total",
        limitUsd: 35,
        usedUsd: 5,
        remainingUsd: 30,
        isUnlimited: false,
        isExhausted: false,
      });
    });

    it("should treat zero quota limits as unlimited in compatibility fields", async () => {
      getSessionMock.mockResolvedValue({
        key: {
          id: 1,
          key: "test-key-hash",
          name: "Test Key",
          dailyResetTime: "00:00",
          dailyResetMode: "fixed",
          limit5hUsd: 0,
          limitDailyUsd: 0,
          limitWeeklyUsd: 0,
          limitMonthlyUsd: 0,
          limitTotalUsd: 0,
          limitConcurrentSessions: 0,
          providerGroup: null,
          isEnabled: true,
          expiresAt: null,
        },
        user: {
          id: 1,
          name: "Test User",
          dailyResetTime: "00:00",
          dailyResetMode: "fixed",
          limit5hUsd: 0,
          dailyQuota: 0,
          limitWeeklyUsd: 0,
          limitMonthlyUsd: 0,
          limitTotalUsd: 0,
          limitConcurrentSessions: 0,
          rpm: null,
          providerGroup: null,
          isEnabled: true,
          expiresAt: null,
          allowedModels: [],
          allowedClients: [],
        },
      });
      sumKeyQuotaCostsByIdMock.mockResolvedValue({
        cost5h: 2,
        costDaily: 3,
        costWeekly: 4,
        costMonthly: 5,
        costTotal: 6,
      });
      sumUserQuotaCostsMock.mockResolvedValue({
        cost5h: 1,
        costDaily: 2,
        costWeekly: 3,
        costMonthly: 4,
        costTotal: 5,
      });

      const { getMyQuota } = await import("@/actions/my-usage");
      const result = await getMyQuota();

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.limit5hUsd).toBeNull();
      expect(result.data.limitDailyUsd).toBeNull();
      expect(result.data.limitWeeklyUsd).toBeNull();
      expect(result.data.limitMonthlyUsd).toBeNull();
      expect(result.data.limitTotalUsd).toBeNull();
      expect(result.data.remaining).toBeNull();
      expect(result.data.remainingPercent).toBeNull();
      expect(result.data.todayRemainingUsd).toBeNull();
      expect(result.data.todayUsedPercent).toBeNull();
      expect(result.data.todayRemainingPercent).toBeNull();
      expect(result.data.concurrentSessionsLimit).toBeNull();
      expect(result.data.quotaWindows.fiveHour).toMatchObject({
        limitUsd: null,
        usedUsd: 2,
        remainingUsd: null,
        usedPercent: null,
        remainingPercent: null,
        isUnlimited: true,
        isExhausted: false,
      });
      expect(result.data.quotaWindows.daily).toMatchObject({
        limitUsd: null,
        usedUsd: 3,
        remainingUsd: null,
        usedPercent: null,
        remainingPercent: null,
        isUnlimited: true,
        isExhausted: false,
      });
    });
  });

  describe("getUserAllLimitUsage in users.ts", () => {
    it("should call sumUserTotalCost with ALL_TIME_MAX_AGE_DAYS", async () => {
      // Setup session mock
      getSessionMock.mockResolvedValue({
        user: {
          id: 1,
          role: "admin",
        },
      });

      // Setup user mock
      findUserByIdMock.mockResolvedValue({
        id: 1,
        name: "Test User",
        dailyResetTime: "00:00",
        dailyResetMode: "fixed",
        limit5hUsd: null,
        dailyQuota: null,
        limitWeeklyUsd: null,
        limitMonthlyUsd: null,
        limitTotalUsd: null,
      });

      // Import and call the function
      const { getUserAllLimitUsage } = await import("@/actions/users");
      await getUserAllLimitUsage(1);

      // Verify sumUserTotalCost was called with Infinity (all-time)
      // 3rd arg is user.costResetAt (undefined when not set on mock user)
      const calls = sumUserTotalCostMock.mock.calls;
      expect(calls.length).toBe(1);
      expect(calls[0][0]).toBe(1);
      expect(calls[0][1]).toBe(Infinity);
    });
  });

  describe("ALL_TIME_MAX_AGE_DAYS constant value", () => {
    it("should be Infinity for all-time semantics", () => {
      expect(ALL_TIME_MAX_AGE_DAYS).toBe(Infinity);
    });
  });
});
