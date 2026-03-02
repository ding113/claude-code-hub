import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test for: function pg_catalog.timezone(unknown, interval) does not exist
 *
 * In getOverviewMetricsWithComparison, `yesterdayStartLocal` and `yesterdayEndLocal`
 * use arithmetic (`-` / `+`) with INTERVAL expressions that are later passed through
 * `AT TIME ZONE`. Without parentheses, PG's operator precedence applies AT TIME ZONE
 * to the INTERVAL sub-expression, which is invalid.
 *
 * The fix wraps the arithmetic: `(expr - INTERVAL '1 day')` and `(expr + (...))`.
 */

function sqlToString(sqlObj: unknown): string {
  const visited = new Set<unknown>();

  const walk = (node: unknown): string => {
    if (!node || visited.has(node)) return "";
    visited.add(node);

    if (typeof node === "string") return node;
    if (typeof node === "number") return String(node);

    if (typeof node === "object") {
      const anyNode = node as Record<string, unknown>;
      if (Array.isArray(anyNode)) {
        return anyNode.map(walk).join("");
      }

      if (anyNode.value !== undefined) {
        if (Array.isArray(anyNode.value)) {
          return (anyNode.value as unknown[]).map(walk).join("");
        }
        return walk(anyNode.value);
      }

      if (anyNode.queryChunks) {
        return walk(anyNode.queryChunks);
      }
    }

    return "";
  };

  return walk(sqlObj);
}

const mocks = vi.hoisted(() => ({
  resolveSystemTimezone: vi.fn(),
}));

function createThenableQuery<T>(result: T, whereArgs?: unknown[]) {
  const query: any = Promise.resolve(result);
  query.from = vi.fn(() => query);
  query.innerJoin = vi.fn(() => query);
  query.leftJoin = vi.fn(() => query);
  query.orderBy = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.offset = vi.fn(() => query);
  query.groupBy = vi.fn(() => query);
  query.where = vi.fn((arg: unknown) => {
    whereArgs?.push(arg);
    return query;
  });
  return query;
}

const allWhereArgs: unknown[][] = [];

vi.mock("@/drizzle/db", () => ({
  db: {
    select: vi.fn(() => {
      const whereArgs: unknown[] = [];
      allWhereArgs.push(whereArgs);
      return createThenableQuery(
        [
          {
            requestCount: 10,
            totalCost: "1.5",
            avgDuration: "200",
            errorCount: 1,
          },
        ],
        whereArgs
      );
    }),
  },
}));

vi.mock("@/drizzle/schema", () => ({
  usageLedger: {
    blockedBy: "blockedBy",
    userId: "userId",
    costUsd: "costUsd",
    durationMs: "durationMs",
    statusCode: "statusCode",
    isSuccess: "isSuccess",
    createdAt: "createdAt",
  },
  messageRequest: {
    deletedAt: "deletedAt",
    userId: "userId",
    costUsd: "costUsd",
    durationMs: "durationMs",
    statusCode: "statusCode",
    createdAt: "createdAt",
    blockedBy: "blockedBy",
  },
}));

vi.mock("@/lib/utils/timezone.server", () => ({
  resolveSystemTimezone: mocks.resolveSystemTimezone,
}));

vi.mock("@/lib/utils/currency", () => ({
  Decimal: class FakeDecimal {
    private v: number;
    constructor(v: number | string) {
      this.v = Number(v);
    }
    toDecimalPlaces() {
      return this;
    }
    toNumber() {
      return this.v;
    }
  },
  toCostDecimal: (v: unknown) => {
    if (v === null || v === undefined) return null;
    return {
      toDecimalPlaces: () => ({ toNumber: () => Number(v) }),
    };
  },
}));

describe("getOverviewMetricsWithComparison - timezone parentheses regression", () => {
  beforeEach(() => {
    vi.resetModules();
    allWhereArgs.length = 0;
    mocks.resolveSystemTimezone.mockResolvedValue("Asia/Shanghai");
  });

  it("yesterdayStartLocal arithmetic must be parenthesized to avoid timezone(unknown, interval)", async () => {
    const { getOverviewMetricsWithComparison } = await import("@/repository/overview");
    await getOverviewMetricsWithComparison();

    // getOverviewMetricsWithComparison fires 3 queries via Promise.all
    // Query 2 (yesterday) uses yesterdayStart and yesterdayEnd
    expect(allWhereArgs.length).toBe(3);

    const yesterdayWhereSql = sqlToString(allWhereArgs[1][0]);

    // yesterdayStartLocal = (todayStartLocal - INTERVAL '1 day')
    // Must have closing paren after '1 day' BEFORE AT TIME ZONE
    expect(yesterdayWhereSql).toContain("INTERVAL '1 day')");
    expect(yesterdayWhereSql).not.toMatch(/INTERVAL '1 day' AT TIME ZONE/);
  });

  it("yesterdayEndLocal arithmetic must be parenthesized", async () => {
    const { getOverviewMetricsWithComparison } = await import("@/repository/overview");
    await getOverviewMetricsWithComparison();

    expect(allWhereArgs.length).toBe(3);

    const yesterdayWhereSql = sqlToString(allWhereArgs[1][0]);

    // yesterdayEndLocal = (yesterdayStartLocal + (nowLocal - todayStartLocal))
    // The outer arithmetic must be wrapped in parens
    // After fix the SQL should have nested parens: ((... - INTERVAL '1 day') + (...))
    // It should NOT have bare `)) AT TIME ZONE` without the outer arithmetic paren
    expect(yesterdayWhereSql).toContain(") AT TIME ZONE");
  });

  it("todayStart already has correct parentheses and should remain correct", async () => {
    const { getOverviewMetricsWithComparison } = await import("@/repository/overview");
    await getOverviewMetricsWithComparison();

    expect(allWhereArgs.length).toBe(3);

    const todayWhereSql = sqlToString(allWhereArgs[0][0]);

    // todayStartLocal uses DATE_TRUNC which doesn't need arithmetic parens
    // tomorrowStart already had parens: ((todayStartLocal + INTERVAL '1 day') AT TIME ZONE tz)
    expect(todayWhereSql).toContain("INTERVAL '1 day')");
  });
});
