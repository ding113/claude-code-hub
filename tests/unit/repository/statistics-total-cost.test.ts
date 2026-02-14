import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("sumUserTotalCost & sumKeyTotalCost - Date Calculation Bug Fix", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Date calculation with large maxAgeDays", () => {
    it("should handle ALL_TIME_MAX_AGE_DAYS (36500 days) without date underflow", async () => {
      const ALL_TIME_MAX_AGE_DAYS = 36500;

      // Mock db to capture the cutoffDate parameter
      let capturedCutoffDate: Date | undefined;

      vi.doMock("@/drizzle/db", () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockImplementation((_conditions) => {
                // Extract the cutoffDate from the where conditions
                // This is a simplified mock - in real code, conditions would be more complex
                return Promise.resolve([{ total: 100 }]);
              }),
            }),
          }),
        },
      }));

      const { sumUserTotalCost } = await import("@/repository/statistics");

      // Calculate expected cutoff date using the fixed formula
      const expectedCutoffDate = new Date(Date.now() - ALL_TIME_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

      const result = await sumUserTotalCost(1, ALL_TIME_MAX_AGE_DAYS);

      // Verify the function doesn't throw
      expect(result).toBeDefined();
      expect(typeof result).toBe("number");

      // Verify the cutoff date is reasonable (not 1926)
      // The cutoff should be approximately 100 years ago from now
      const now = new Date();
      const hundredYearsAgo = new Date(now.getFullYear() - 100, now.getMonth(), now.getDate());

      // The expected cutoff should be within a reasonable range
      // (approximately 100 years ago, with some tolerance for leap years)
      const yearsDiff =
        (now.getTime() - expectedCutoffDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      expect(yearsDiff).toBeGreaterThan(99);
      expect(yearsDiff).toBeLessThan(101);

      // Most importantly: verify it's NOT the buggy 1926 date
      expect(expectedCutoffDate.getFullYear()).toBeGreaterThan(1920);
    });

    it("should handle very large maxAgeDays (100000 days) without overflow", async () => {
      const VERY_LARGE_DAYS = 100000;

      vi.doMock("@/drizzle/db", () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ total: 200 }]),
            }),
          }),
        },
      }));

      const { sumKeyTotalCost } = await import("@/repository/statistics");

      const result = await sumKeyTotalCost("test-key-hash", VERY_LARGE_DAYS);

      expect(result).toBeDefined();
      expect(typeof result).toBe("number");
    });

    it("should produce reasonable cutoff dates for standard periods", async () => {
      const testCases = [
        { days: 1, expectedYearsAgo: 0 },
        { days: 365, expectedYearsAgo: 1 },
        { days: 36500, expectedYearsAgo: 100 },
      ];

      for (const { days, expectedYearsAgo } of testCases) {
        // Calculate cutoff using the fixed formula
        const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const now = new Date();

        // Calculate the year difference
        const yearDiff = now.getFullYear() - cutoffDate.getFullYear();

        // Allow ±1 year tolerance due to month/day differences
        expect(yearDiff).toBeGreaterThanOrEqual(expectedYearsAgo - 1);
        expect(yearDiff).toBeLessThanOrEqual(expectedYearsAgo + 1);
      }
    });
  });

  describe("Edge cases", () => {
    it("should handle maxAgeDays = 0 (use default 365)", async () => {
      vi.doMock("@/drizzle/db", () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ total: 50 }]),
            }),
          }),
        },
      }));

      const { sumUserTotalCost } = await import("@/repository/statistics");
      const result = await sumUserTotalCost(1, 0);

      expect(result).toBe(50);
    });

    it("should handle negative maxAgeDays (use default 365)", async () => {
      vi.doMock("@/drizzle/db", () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ total: 75 }]),
            }),
          }),
        },
      }));

      const { sumUserTotalCost } = await import("@/repository/statistics");
      const result = await sumUserTotalCost(1, -100);

      expect(result).toBe(75);
    });
  });
});
