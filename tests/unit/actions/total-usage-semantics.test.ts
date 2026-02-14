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
const getKeySessionCountMock = vi.fn();
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

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    getKeySessionCount: (...args: unknown[]) => getKeySessionCountMock(...args),
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
    getKeySessionCountMock.mockResolvedValue(0);

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
        ALL_TIME_MAX_AGE_DAYS
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
        ALL_TIME_MAX_AGE_DAYS
      );
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
      expect(sumUserTotalCostMock).toHaveBeenCalledWith(1, Infinity);
    });
  });

  describe("ALL_TIME_MAX_AGE_DAYS constant value", () => {
    it("should be Infinity for all-time semantics", () => {
      expect(ALL_TIME_MAX_AGE_DAYS).toBe(Infinity);
    });
  });

  describe("source code verification", () => {
    it("should verify sumUserCost passes ALL_TIME_MAX_AGE_DAYS when period is total", async () => {
      // This test verifies the implementation by reading the source code pattern
      // Ensure we call quota aggregation functions with ALL_TIME_MAX_AGE_DAYS for all-time usage.
      const fs = await import("node:fs/promises");
      const path = await import("node:path");

      const myUsagePath = path.join(process.cwd(), "src/actions/my-usage.ts");
      const content = await fs.readFile(myUsagePath, "utf-8");

      // Verify the constant is defined as Infinity
      expect(content).toContain("const ALL_TIME_MAX_AGE_DAYS = Infinity");

      // Verify quota aggregation uses the constant for all-time usage
      expect(content).toMatch(/sumUserQuotaCosts\([^)]*ALL_TIME_MAX_AGE_DAYS\s*\)/);

      expect(content).toMatch(/sumKeyQuotaCostsById\([^)]*ALL_TIME_MAX_AGE_DAYS\s*\)/);
    });

    it("should verify getUserAllLimitUsage passes ALL_TIME_MAX_AGE_DAYS", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");

      const usersPath = path.join(process.cwd(), "src/actions/users.ts");
      const content = await fs.readFile(usersPath, "utf-8");

      // Verify the constant is defined as Infinity
      expect(content).toContain("const ALL_TIME_MAX_AGE_DAYS = Infinity");

      // Verify sumUserTotalCost is called with the constant
      expect(content).toContain("sumUserTotalCost(userId, ALL_TIME_MAX_AGE_DAYS)");
    });
  });
});
