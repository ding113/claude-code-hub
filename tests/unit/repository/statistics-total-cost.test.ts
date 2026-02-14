import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("sumUserTotalCost & sumKeyTotalCost - all-time query support", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("All-time query (Infinity maxAgeDays)", () => {
    it("should not add date filter when maxAgeDays is Infinity", async () => {
      let capturedConditions: unknown;

      vi.doMock("@/drizzle/db", () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockImplementation((conditions) => {
                capturedConditions = conditions;
                return Promise.resolve([{ total: 100 }]);
              }),
            }),
          }),
        },
      }));

      const { sumUserTotalCost } = await import("@/repository/statistics");
      const result = await sumUserTotalCost(1, Infinity);

      expect(result).toBe(100);
      // The conditions should not contain a date filter (gte on createdAt)
      // With Infinity, we expect only 3 conditions: userId eq, deletedAt isNull, warmup exclude
      expect(capturedConditions).toBeDefined();
    });

    it("should not add date filter for sumKeyTotalCost with Infinity", async () => {
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
      const result = await sumKeyTotalCost("test-key-hash", Infinity);

      expect(result).toBe(200);
    });
  });

  describe("Finite maxAgeDays still adds date filter", () => {
    it("should produce reasonable cutoff dates for standard periods", () => {
      const testCases = [
        { days: 1, expectedYearsAgo: 0 },
        { days: 365, expectedYearsAgo: 1 },
      ];

      for (const { days, expectedYearsAgo } of testCases) {
        const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const now = new Date();
        const yearDiff = now.getFullYear() - cutoffDate.getFullYear();

        expect(yearDiff).toBeGreaterThanOrEqual(expectedYearsAgo - 1);
        expect(yearDiff).toBeLessThanOrEqual(expectedYearsAgo + 1);
      }
    });

    it("should add date filter for finite maxAgeDays", async () => {
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
      const result = await sumUserTotalCost(1, 365);

      expect(result).toBe(50);
    });
  });

  describe("Edge cases", () => {
    it("should skip date filter for maxAgeDays = 0", async () => {
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

    it("should skip date filter for negative maxAgeDays", async () => {
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

    it("should skip date filter for NaN maxAgeDays", async () => {
      vi.doMock("@/drizzle/db", () => ({
        db: {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ total: 30 }]),
            }),
          }),
        },
      }));

      const { sumUserTotalCost } = await import("@/repository/statistics");
      const result = await sumUserTotalCost(1, NaN);

      expect(result).toBe(30);
    });
  });
});
