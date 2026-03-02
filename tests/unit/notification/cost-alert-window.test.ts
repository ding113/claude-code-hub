/**
 * Cost Alert Time Window Tests
 *
 * Tests for verifying that cost-alert.ts uses proper time-utils functions
 * and repository functions with correct filtering (deletedAt, warmup exclusion).
 *
 * Key Differences After Fix:
 * | Window  | Before                          | After                                  |
 * |---------|--------------------------------|----------------------------------------|
 * | 5h      | now - 5h                       | getTimeRangeForPeriod("5h") - same     |
 * | Weekly  | now - 7 days (rolling)         | getTimeRangeForPeriod("weekly") - Monday |
 * | Monthly | Month start (no timezone)      | getTimeRangeForPeriod("monthly") - TZ aware |
 *
 * Filters Added by Using sumKeyCostInTimeRange/sumProviderCostInTimeRange:
 * - deletedAt IS NULL
 * - blockedBy IS NULL OR blockedBy <> 'warmup' (EXCLUDE_WARMUP_CONDITION)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Track mock calls
const mockGetTimeRangeForPeriod = vi.fn();
const mockSumKeyCostInTimeRange = vi.fn();
const mockSumProviderCostInTimeRange = vi.fn();
const mockDbSelect = vi.fn();
const mockDbFrom = vi.fn();
const mockDbWhere = vi.fn();

// Mock dependencies before importing the module under test
vi.mock("@/drizzle/db", () => ({
  db: {
    select: (...args: unknown[]) => {
      mockDbSelect(...args);
      return {
        from: (...fromArgs: unknown[]) => {
          mockDbFrom(...fromArgs);
          return {
            where: (...whereArgs: unknown[]) => mockDbWhere(...whereArgs),
          };
        },
      };
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("@/lib/utils/timezone.server", () => ({
  resolveSystemTimezone: vi.fn(async () => "Asia/Shanghai"),
}));

// Mock the time-utils module
vi.mock("@/lib/rate-limit/time-utils", () => ({
  getTimeRangeForPeriod: (...args: unknown[]) => mockGetTimeRangeForPeriod(...args),
}));

// Mock the statistics repository
vi.mock("@/repository/statistics", () => ({
  sumKeyCostInTimeRange: (...args: unknown[]) => mockSumKeyCostInTimeRange(...args),
  sumProviderCostInTimeRange: (...args: unknown[]) => mockSumProviderCostInTimeRange(...args),
}));

describe("Cost Alert Time Windows", () => {
  const nowMs = 1706000000000; // 2024-01-23 08:53:20 UTC (Tuesday)

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    vi.clearAllMocks();

    // Reset module cache to ensure fresh imports with our mocks
    vi.resetModules();

    // Default mock implementations for time ranges
    mockGetTimeRangeForPeriod.mockImplementation(async (period: string) => {
      const now = new Date(nowMs);
      switch (period) {
        case "5h":
          return {
            startTime: new Date(nowMs - 5 * 60 * 60 * 1000),
            endTime: now,
          };
        case "weekly":
          // Monday 00:00 Shanghai (2024-01-22 00:00 +08:00 = 2024-01-21 16:00 UTC)
          return {
            startTime: new Date("2024-01-21T16:00:00.000Z"),
            endTime: now,
          };
        case "monthly":
          // Month start (2024-01-01 00:00 +08:00 = 2023-12-31 16:00 UTC)
          return {
            startTime: new Date("2023-12-31T16:00:00.000Z"),
            endTime: now,
          };
        default:
          throw new Error(`Unknown period: ${period}`);
      }
    });

    // Default mock for cost queries
    mockSumKeyCostInTimeRange.mockResolvedValue(0);
    mockSumProviderCostInTimeRange.mockResolvedValue(0);

    // Default: return empty arrays for DB queries
    mockDbWhere.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("checkUserQuotas", () => {
    it("should use getTimeRangeForPeriod('5h') for 5-hour window", async () => {
      // Setup: Key with 5h limit
      mockDbWhere.mockResolvedValue([
        {
          id: 1,
          key: "test-key",
          userName: "Test User",
          limit5h: "10.00",
          limitWeek: null,
          limitMonth: null,
        },
      ]);
      mockSumKeyCostInTimeRange.mockResolvedValue(5);

      const { generateCostAlerts } = await import("@/lib/notification/tasks/cost-alert");
      await generateCostAlerts(0.5);

      expect(mockGetTimeRangeForPeriod).toHaveBeenCalledWith("5h");
    });

    it("should use getTimeRangeForPeriod('weekly') for weekly window (natural week from Monday)", async () => {
      // Setup: Key with weekly limit
      mockDbWhere.mockResolvedValue([
        {
          id: 1,
          key: "test-key",
          userName: "Test User",
          limit5h: null,
          limitWeek: "100.00",
          limitMonth: null,
        },
      ]);
      mockSumKeyCostInTimeRange.mockResolvedValue(50);

      const { generateCostAlerts } = await import("@/lib/notification/tasks/cost-alert");
      await generateCostAlerts(0.5);

      expect(mockGetTimeRangeForPeriod).toHaveBeenCalledWith("weekly");
    });

    it("should use getTimeRangeForPeriod('monthly') for monthly window (natural month)", async () => {
      // Setup: Key with monthly limit
      mockDbWhere.mockResolvedValue([
        {
          id: 1,
          key: "test-key",
          userName: "Test User",
          limit5h: null,
          limitWeek: null,
          limitMonth: "1000.00",
        },
      ]);
      mockSumKeyCostInTimeRange.mockResolvedValue(500);

      const { generateCostAlerts } = await import("@/lib/notification/tasks/cost-alert");
      await generateCostAlerts(0.5);

      expect(mockGetTimeRangeForPeriod).toHaveBeenCalledWith("monthly");
    });

    it("should use sumKeyCostInTimeRange with keyId and correct time range", async () => {
      const expectedStart = new Date(nowMs - 5 * 60 * 60 * 1000);
      const expectedEnd = new Date(nowMs);

      mockDbWhere.mockResolvedValue([
        {
          id: 1,
          key: "test-key",
          userName: "Test User",
          limit5h: "10.00",
          limitWeek: null,
          limitMonth: null,
        },
      ]);
      mockSumKeyCostInTimeRange.mockResolvedValue(5);

      const { generateCostAlerts } = await import("@/lib/notification/tasks/cost-alert");
      await generateCostAlerts(0.5);

      // Should call sumKeyCostInTimeRange with keyId (not key string) and time range
      expect(mockSumKeyCostInTimeRange).toHaveBeenCalledWith(
        1, // keyId
        expectedStart,
        expectedEnd
      );
    });

    it("should generate alert when cost exceeds threshold", async () => {
      mockDbWhere.mockResolvedValue([
        {
          id: 1,
          key: "test-key",
          userName: "Test User",
          limit5h: "10.00",
          limitWeek: null,
          limitMonth: null,
        },
      ]);
      mockSumKeyCostInTimeRange.mockResolvedValue(9); // 90% of limit

      const { generateCostAlerts } = await import("@/lib/notification/tasks/cost-alert");
      const alerts = await generateCostAlerts(0.8); // 80% threshold

      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        targetType: "user",
        targetName: "Test User",
        targetId: 1,
        currentCost: 9,
        quotaLimit: 10,
        threshold: 0.8,
        period: "5小时",
      });
    });

    it("should NOT generate alert when cost is below threshold", async () => {
      mockDbWhere.mockResolvedValue([
        {
          id: 1,
          key: "test-key",
          userName: "Test User",
          limit5h: "10.00",
          limitWeek: null,
          limitMonth: null,
        },
      ]);
      mockSumKeyCostInTimeRange.mockResolvedValue(7); // 70% of limit

      const { generateCostAlerts } = await import("@/lib/notification/tasks/cost-alert");
      const alerts = await generateCostAlerts(0.8); // 80% threshold

      expect(alerts).toHaveLength(0);
    });
  });

  describe("checkProviderQuotas", () => {
    it("should use getTimeRangeForPeriod('weekly') for provider weekly window", async () => {
      // First call returns empty keys, second call returns provider
      mockDbWhere
        .mockResolvedValueOnce([]) // keys query
        .mockResolvedValueOnce([
          { id: 1, name: "Test Provider", limitWeek: "100.00", limitMonth: null },
        ]);
      mockSumProviderCostInTimeRange.mockResolvedValue(50);

      const { generateCostAlerts } = await import("@/lib/notification/tasks/cost-alert");
      await generateCostAlerts(0.5);

      expect(mockGetTimeRangeForPeriod).toHaveBeenCalledWith("weekly");
    });

    it("should use getTimeRangeForPeriod('monthly') for provider monthly window", async () => {
      mockDbWhere
        .mockResolvedValueOnce([]) // keys query
        .mockResolvedValueOnce([
          { id: 1, name: "Test Provider", limitWeek: null, limitMonth: "1000.00" },
        ]);
      mockSumProviderCostInTimeRange.mockResolvedValue(500);

      const { generateCostAlerts } = await import("@/lib/notification/tasks/cost-alert");
      await generateCostAlerts(0.5);

      expect(mockGetTimeRangeForPeriod).toHaveBeenCalledWith("monthly");
    });

    it("should use sumProviderCostInTimeRange with correct time range", async () => {
      const expectedWeeklyStart = new Date("2024-01-21T16:00:00.000Z");
      const expectedEnd = new Date(nowMs);

      mockDbWhere
        .mockResolvedValueOnce([]) // keys query
        .mockResolvedValueOnce([
          { id: 1, name: "Test Provider", limitWeek: "100.00", limitMonth: null },
        ]);
      mockSumProviderCostInTimeRange.mockResolvedValue(50);

      const { generateCostAlerts } = await import("@/lib/notification/tasks/cost-alert");
      await generateCostAlerts(0.5);

      expect(mockSumProviderCostInTimeRange).toHaveBeenCalledWith(
        1, // providerId
        expectedWeeklyStart,
        expectedEnd
      );
    });

    it("should generate provider alert when cost exceeds threshold", async () => {
      mockDbWhere
        .mockResolvedValueOnce([]) // keys query
        .mockResolvedValueOnce([
          { id: 1, name: "Test Provider", limitWeek: "100.00", limitMonth: null },
        ]);
      mockSumProviderCostInTimeRange.mockResolvedValue(90); // 90% of limit

      const { generateCostAlerts } = await import("@/lib/notification/tasks/cost-alert");
      const alerts = await generateCostAlerts(0.8); // 80% threshold

      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        targetType: "provider",
        targetName: "Test Provider",
        targetId: 1,
        currentCost: 90,
        quotaLimit: 100,
        threshold: 0.8,
        period: "本周",
      });
    });
  });

  describe("Time Window Semantics", () => {
    it("weekly window should use natural week (Monday) not rolling 7 days", async () => {
      // This test verifies that weekly uses natural week boundaries
      // If today is Tuesday, weekly should start from Monday 00:00
      // NOT from 7 days ago

      mockDbWhere.mockResolvedValue([
        {
          id: 1,
          key: "test-key",
          userName: "Test User",
          limit5h: null,
          limitWeek: "100.00",
          limitMonth: null,
        },
      ]);
      mockSumKeyCostInTimeRange.mockResolvedValue(50);

      const { generateCostAlerts } = await import("@/lib/notification/tasks/cost-alert");
      await generateCostAlerts(0.5);

      // Verify getTimeRangeForPeriod was called for weekly
      expect(mockGetTimeRangeForPeriod).toHaveBeenCalledWith("weekly");

      // Verify sumKeyCostInTimeRange was called
      expect(mockSumKeyCostInTimeRange).toHaveBeenCalled();

      // Extract the actual startTime passed
      const callArgs = mockSumKeyCostInTimeRange.mock.calls[0];
      const startTime = callArgs[1] as Date;

      // Should be Monday 00:00 Shanghai = Sunday 16:00 UTC
      expect(startTime.toISOString()).toBe("2024-01-21T16:00:00.000Z");
    });

    it("monthly window should use natural month (1st) with timezone awareness", async () => {
      mockDbWhere.mockResolvedValue([
        {
          id: 1,
          key: "test-key",
          userName: "Test User",
          limit5h: null,
          limitWeek: null,
          limitMonth: "1000.00",
        },
      ]);
      mockSumKeyCostInTimeRange.mockResolvedValue(500);

      const { generateCostAlerts } = await import("@/lib/notification/tasks/cost-alert");
      await generateCostAlerts(0.5);

      expect(mockGetTimeRangeForPeriod).toHaveBeenCalledWith("monthly");

      const callArgs = mockSumKeyCostInTimeRange.mock.calls[0];
      const startTime = callArgs[1] as Date;

      // Should be Jan 1st 00:00 Shanghai = Dec 31 16:00 UTC
      expect(startTime.toISOString()).toBe("2023-12-31T16:00:00.000Z");
    });
  });

  describe("Warmup and Deleted Record Exclusion", () => {
    it("should use sumKeyCostInTimeRange which excludes warmup records", async () => {
      // This is a verification test - sumKeyCostInTimeRange already includes EXCLUDE_WARMUP_CONDITION
      // The old getKeyCostSince did NOT have this filter

      mockDbWhere.mockResolvedValue([
        {
          id: 1,
          key: "test-key",
          userName: "Test User",
          limit5h: "10.00",
          limitWeek: null,
          limitMonth: null,
        },
      ]);
      mockSumKeyCostInTimeRange.mockResolvedValue(5);

      const { generateCostAlerts } = await import("@/lib/notification/tasks/cost-alert");
      await generateCostAlerts(0.5);

      // Verify sumKeyCostInTimeRange is called (which has EXCLUDE_WARMUP_CONDITION built-in)
      expect(mockSumKeyCostInTimeRange).toHaveBeenCalled();
    });

    it("should use sumProviderCostInTimeRange which excludes deleted records", async () => {
      // sumProviderCostInTimeRange has: isNull(messageRequest.deletedAt) filter
      // The old getProviderCostSince did NOT have this filter

      mockDbWhere
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: 1, name: "Test Provider", limitWeek: "100.00", limitMonth: null },
        ]);
      mockSumProviderCostInTimeRange.mockResolvedValue(50);

      const { generateCostAlerts } = await import("@/lib/notification/tasks/cost-alert");
      await generateCostAlerts(0.5);

      // Verify sumProviderCostInTimeRange is called (which has deletedAt IS NULL built-in)
      expect(mockSumProviderCostInTimeRange).toHaveBeenCalled();
    });
  });

  describe("Timezone Consistency", () => {
    it("should use system timezone for all time calculations", async () => {
      // getTimeRangeForPeriod internally uses resolveSystemTimezone()
      // This ensures all calculations are timezone-aware

      mockDbWhere.mockResolvedValue([
        {
          id: 1,
          key: "test-key",
          userName: "Test User",
          limit5h: null,
          limitWeek: "100.00",
          limitMonth: null,
        },
      ]);
      mockSumKeyCostInTimeRange.mockResolvedValue(50);

      const { generateCostAlerts } = await import("@/lib/notification/tasks/cost-alert");
      await generateCostAlerts(0.5);

      // The time ranges returned by getTimeRangeForPeriod are timezone-aware
      // This is verified by the mock implementation which uses timezone-aware dates
      expect(mockGetTimeRangeForPeriod).toHaveBeenCalled();
    });
  });

  describe("Performance Optimization", () => {
    it("should pre-calculate time ranges once for all keys in checkUserQuotas", async () => {
      // Multiple keys with various limits
      mockDbWhere
        .mockResolvedValueOnce([
          {
            id: 1,
            key: "key-1",
            userName: "User 1",
            limit5h: "10.00",
            limitWeek: null,
            limitMonth: null,
          },
          {
            id: 2,
            key: "key-2",
            userName: "User 2",
            limit5h: null,
            limitWeek: "100.00",
            limitMonth: null,
          },
          {
            id: 3,
            key: "key-3",
            userName: "User 3",
            limit5h: null,
            limitWeek: null,
            limitMonth: "1000.00",
          },
        ])
        .mockResolvedValueOnce([]); // providers query returns empty
      mockSumKeyCostInTimeRange.mockResolvedValue(5);

      const { generateCostAlerts } = await import("@/lib/notification/tasks/cost-alert");
      await generateCostAlerts(0.5);

      // getTimeRangeForPeriod should be called for user quotas (3 periods) + provider quotas (2 periods)
      // Total: 5 calls (5h + weekly + monthly for keys, weekly + monthly for providers)
      const calls = mockGetTimeRangeForPeriod.mock.calls.map((c) => c[0]);

      // Keys use all 3 periods, providers use weekly + monthly
      // So 5h should be called 1 time (keys only)
      // weekly should be called 2 times (keys + providers)
      // monthly should be called 2 times (keys + providers)
      expect(calls.filter((c) => c === "5h")).toHaveLength(1);
      expect(calls.filter((c) => c === "weekly")).toHaveLength(2);
      expect(calls.filter((c) => c === "monthly")).toHaveLength(2);
    });

    it("should not call getTimeRangeForPeriod per-key (optimized)", async () => {
      // This tests that we pre-calculate ranges once, not N times for N keys
      const manyKeys = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        key: `key-${i + 1}`,
        userName: `User ${i + 1}`,
        limit5h: "10.00",
        limitWeek: "100.00",
        limitMonth: "1000.00",
      }));

      mockDbWhere.mockResolvedValueOnce(manyKeys).mockResolvedValueOnce([]); // empty providers
      mockSumKeyCostInTimeRange.mockResolvedValue(5);

      const { generateCostAlerts } = await import("@/lib/notification/tasks/cost-alert");
      await generateCostAlerts(0.5);

      // Even with 10 keys, we should only call getTimeRangeForPeriod once per period
      // Not 10 times per period
      const calls = mockGetTimeRangeForPeriod.mock.calls.map((c) => c[0]);
      expect(calls.filter((c) => c === "5h")).toHaveLength(1); // 1 for keys
      expect(calls.filter((c) => c === "weekly")).toHaveLength(2); // 1 for keys + 1 for providers
      expect(calls.filter((c) => c === "monthly")).toHaveLength(2); // 1 for keys + 1 for providers
    });
  });
});
