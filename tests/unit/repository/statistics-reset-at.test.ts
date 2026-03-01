import { beforeEach, describe, expect, test, vi } from "vitest";

// dbResultMock controls what every DB chain resolves to when awaited
const dbResultMock = vi.fn<[], unknown>().mockReturnValue([{ total: 0 }]);

// Build a chainable mock that resolves to dbResultMock() on await
function chain(): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "from", "where", "groupBy", "limit"]) {
    obj[method] = vi.fn(() => chain());
  }
  // Make it thenable so `await db.select().from().where()` works
  obj.then = (
    resolve: (v: unknown) => void,
    reject: (e: unknown) => void
  ) => {
    try {
      resolve(dbResultMock());
    } catch (e) {
      reject(e);
    }
  };
  return obj;
}

vi.mock("@/drizzle/db", () => ({
  db: chain(),
}));

// Mock drizzle schema -- preserve all exports so module-level sql`` calls work
vi.mock("@/drizzle/schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/drizzle/schema")>();
  return { ...actual };
});

// Mock logger
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("statistics resetAt parameter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbResultMock.mockReturnValue([{ total: 0 }]);
  });

  describe("sumUserTotalCost", () => {
    test("with valid resetAt -- queries DB and returns cost", async () => {
      const resetAt = new Date("2026-02-15T00:00:00Z");
      dbResultMock.mockReturnValue([{ total: 42.5 }]);

      const { sumUserTotalCost } = await import("@/repository/statistics");
      const result = await sumUserTotalCost(10, 365, resetAt);

      expect(result).toBe(42.5);
    });

    test("without resetAt -- uses maxAgeDays cutoff instead", async () => {
      dbResultMock.mockReturnValue([{ total: 100.0 }]);

      const { sumUserTotalCost } = await import("@/repository/statistics");
      const result = await sumUserTotalCost(10, 365);

      expect(result).toBe(100.0);
    });

    test("with null resetAt -- treated same as undefined", async () => {
      dbResultMock.mockReturnValue([{ total: 50.0 }]);

      const { sumUserTotalCost } = await import("@/repository/statistics");
      const result = await sumUserTotalCost(10, 365, null);

      expect(result).toBe(50.0);
    });

    test("with invalid Date (NaN) -- skips resetAt, falls through to maxAgeDays", async () => {
      const invalidDate = new Date("invalid");
      dbResultMock.mockReturnValue([{ total: 75.0 }]);

      const { sumUserTotalCost } = await import("@/repository/statistics");
      const result = await sumUserTotalCost(10, 365, invalidDate);

      expect(result).toBe(75.0);
    });
  });

  describe("sumKeyTotalCost", () => {
    test("with valid resetAt -- uses resetAt instead of maxAgeDays cutoff", async () => {
      const resetAt = new Date("2026-02-20T00:00:00Z");
      dbResultMock.mockReturnValue([{ total: 15.0 }]);

      const { sumKeyTotalCost } = await import("@/repository/statistics");
      const result = await sumKeyTotalCost("sk-hash", 365, resetAt);

      expect(result).toBe(15.0);
    });

    test("without resetAt -- falls back to maxAgeDays", async () => {
      dbResultMock.mockReturnValue([{ total: 30.0 }]);

      const { sumKeyTotalCost } = await import("@/repository/statistics");
      const result = await sumKeyTotalCost("sk-hash", 365);

      expect(result).toBe(30.0);
    });
  });

  describe("sumUserTotalCostBatch", () => {
    test("with resetAtMap -- splits users: individual queries for reset users", async () => {
      const resetAtMap = new Map([[10, new Date("2026-02-15T00:00:00Z")]]);
      // Calls: 1) individual sumUserTotalCost(10) => where => [{ total: 25 }]
      //        2) batch for user 20 => groupBy => [{ userId: 20, total: 50 }]
      dbResultMock
        .mockReturnValueOnce([{ total: 25.0 }])
        .mockReturnValueOnce([{ userId: 20, total: 50.0 }]);

      const { sumUserTotalCostBatch } = await import("@/repository/statistics");
      const result = await sumUserTotalCostBatch([10, 20], 365, resetAtMap);

      expect(result.get(10)).toBe(25.0);
      expect(result.get(20)).toBe(50.0);
    });

    test("with empty resetAtMap -- single batch query for all users", async () => {
      dbResultMock.mockReturnValue([
        { userId: 10, total: 25.0 },
        { userId: 20, total: 50.0 },
      ]);

      const { sumUserTotalCostBatch } = await import("@/repository/statistics");
      const result = await sumUserTotalCostBatch([10, 20], 365, new Map());

      expect(result.get(10)).toBe(25.0);
      expect(result.get(20)).toBe(50.0);
    });

    test("empty userIds -- returns empty map immediately", async () => {
      const { sumUserTotalCostBatch } = await import("@/repository/statistics");
      const result = await sumUserTotalCostBatch([], 365);

      expect(result.size).toBe(0);
    });
  });

  describe("sumKeyTotalCostBatchByIds", () => {
    test("with resetAtMap -- splits keys into individual vs batch", async () => {
      const resetAtMap = new Map([[1, new Date("2026-02-15T00:00:00Z")]]);
      dbResultMock
        // 1) PK lookup: key strings
        .mockReturnValueOnce([
          { id: 1, key: "sk-a" },
          { id: 2, key: "sk-b" },
        ])
        // 2) individual sumKeyTotalCost for key 1
        .mockReturnValueOnce([{ total: 10.0 }])
        // 3) batch for key 2
        .mockReturnValueOnce([{ key: "sk-b", total: 20.0 }]);

      const { sumKeyTotalCostBatchByIds } = await import("@/repository/statistics");
      const result = await sumKeyTotalCostBatchByIds([1, 2], 365, resetAtMap);

      expect(result.get(1)).toBe(10.0);
      expect(result.get(2)).toBe(20.0);
    });

    test("empty keyIds -- returns empty map immediately", async () => {
      const { sumKeyTotalCostBatchByIds } = await import("@/repository/statistics");
      const result = await sumKeyTotalCostBatchByIds([], 365);

      expect(result.size).toBe(0);
    });
  });

  describe("sumUserQuotaCosts", () => {
    const ranges = {
      range5h: {
        startTime: new Date("2026-03-01T07:00:00Z"),
        endTime: new Date("2026-03-01T12:00:00Z"),
      },
      rangeDaily: {
        startTime: new Date("2026-03-01T00:00:00Z"),
        endTime: new Date("2026-03-01T12:00:00Z"),
      },
      rangeWeekly: {
        startTime: new Date("2026-02-23T00:00:00Z"),
        endTime: new Date("2026-03-01T12:00:00Z"),
      },
      rangeMonthly: {
        startTime: new Date("2026-02-01T00:00:00Z"),
        endTime: new Date("2026-03-01T12:00:00Z"),
      },
    };

    test("with resetAt -- returns correct cost summary", async () => {
      const resetAt = new Date("2026-02-25T00:00:00Z");
      dbResultMock.mockReturnValue([
        { cost5h: "1.0", costDaily: "2.0", costWeekly: "3.0", costMonthly: "4.0", costTotal: "5.0" },
      ]);

      const { sumUserQuotaCosts } = await import("@/repository/statistics");
      const result = await sumUserQuotaCosts(10, ranges, 365, resetAt);

      expect(result.cost5h).toBe(1.0);
      expect(result.costDaily).toBe(2.0);
      expect(result.costWeekly).toBe(3.0);
      expect(result.costMonthly).toBe(4.0);
      expect(result.costTotal).toBe(5.0);
    });

    test("without resetAt -- uses only maxAgeDays cutoff", async () => {
      dbResultMock.mockReturnValue([
        { cost5h: "0", costDaily: "0", costWeekly: "0", costMonthly: "0", costTotal: "0" },
      ]);

      const { sumUserQuotaCosts } = await import("@/repository/statistics");
      const result = await sumUserQuotaCosts(10, ranges, 365);

      expect(result.cost5h).toBe(0);
      expect(result.costTotal).toBe(0);
    });
  });

  describe("sumKeyQuotaCostsById", () => {
    test("with resetAt -- same cutoff logic as sumUserQuotaCosts", async () => {
      const resetAt = new Date("2026-02-25T00:00:00Z");
      const ranges = {
        range5h: {
          startTime: new Date("2026-03-01T07:00:00Z"),
          endTime: new Date("2026-03-01T12:00:00Z"),
        },
        rangeDaily: {
          startTime: new Date("2026-03-01T00:00:00Z"),
          endTime: new Date("2026-03-01T12:00:00Z"),
        },
        rangeWeekly: {
          startTime: new Date("2026-02-23T00:00:00Z"),
          endTime: new Date("2026-03-01T12:00:00Z"),
        },
        rangeMonthly: {
          startTime: new Date("2026-02-01T00:00:00Z"),
          endTime: new Date("2026-03-01T12:00:00Z"),
        },
      };
      // First: getKeyStringByIdCached lookup, then main query
      dbResultMock
        .mockReturnValueOnce([{ key: "sk-test-hash" }])
        .mockReturnValueOnce([
          { cost5h: "2.0", costDaily: "4.0", costWeekly: "6.0", costMonthly: "8.0", costTotal: "10.0" },
        ]);

      const { sumKeyQuotaCostsById } = await import("@/repository/statistics");
      const result = await sumKeyQuotaCostsById(42, ranges, 365, resetAt);

      expect(result.cost5h).toBe(2.0);
      expect(result.costTotal).toBe(10.0);
    });
  });
});
