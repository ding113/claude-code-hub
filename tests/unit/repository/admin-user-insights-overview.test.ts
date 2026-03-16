import { beforeEach, describe, expect, it, vi } from "vitest";

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

function createThenableQuery<T>(result: T, whereArgs?: unknown[]) {
  const query: any = Promise.resolve(result);
  query.from = vi.fn(() => query);
  query.innerJoin = vi.fn(() => query);
  query.leftJoin = vi.fn(() => query);
  query.groupBy = vi.fn(() => query);
  query.orderBy = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.offset = vi.fn(() => query);
  query.where = vi.fn((arg: unknown) => {
    whereArgs?.push(arg);
    return query;
  });
  return query;
}

const selectResults: unknown[] = [];
const allWhereArgs: unknown[][] = [];
const capturedSelections: Array<Record<string, unknown>> = [];

vi.mock("@/drizzle/db", () => ({
  db: {
    select: vi.fn((selection: unknown) => {
      capturedSelections.push(selection as Record<string, unknown>);
      const whereArgs: unknown[] = [];
      allWhereArgs.push(whereArgs);
      const result = selectResults.shift() ?? [];
      return createThenableQuery(result, whereArgs);
    }),
  },
}));

vi.mock("@/drizzle/schema", () => ({
  usageLedger: {
    userId: "userId",
    costUsd: "costUsd",
    durationMs: "durationMs",
    isSuccess: "isSuccess",
    createdAt: "createdAt",
    blockedBy: "blockedBy",
    originalModel: "originalModel",
    model: "model",
    inputTokens: "inputTokens",
    outputTokens: "outputTokens",
    cacheCreationInputTokens: "cacheCreationInputTokens",
    cacheReadInputTokens: "cacheReadInputTokens",
    finalProviderId: "finalProviderId",
    key: "key",
  },
  providers: {
    id: "id",
    name: "name",
  },
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: vi.fn(),
}));

describe("getUserOverviewMetrics", () => {
  beforeEach(() => {
    vi.resetModules();
    selectResults.length = 0;
    allWhereArgs.length = 0;
    capturedSelections.length = 0;
  });

  it("applies the requested date range and computes aggregate metrics", async () => {
    selectResults.push([
      {
        requestCount: 3,
        totalCost: "1.5",
        avgDuration: "200.6",
        errorCount: 1,
      },
    ]);

    const { getUserOverviewMetrics } = await import("@/repository/admin-user-insights");
    const result = await getUserOverviewMetrics(10, "2026-03-01", "2026-03-09");

    expect(result).toEqual({
      requestCount: 3,
      totalCost: 1.5,
      avgResponseTime: 201,
      errorRate: 33.33,
    });

    expect(allWhereArgs).toHaveLength(1);
    const whereSql = sqlToString(allWhereArgs[0][0]);
    expect(whereSql).toContain("2026-03-01");
    expect(whereSql).toContain("2026-03-09");
    expect(whereSql).toContain("INTERVAL '1 day'");

    const errorCountSql = sqlToString(capturedSelections[0].errorCount).toLowerCase();
    expect(errorCountSql).toContain("filter");
  });

  it("returns zeroed metrics when the aggregate query yields no rows", async () => {
    selectResults.push([]);

    const { getUserOverviewMetrics } = await import("@/repository/admin-user-insights");
    const result = await getUserOverviewMetrics(10, "2026-03-01", "2026-03-09");

    expect(result).toEqual({
      requestCount: 0,
      totalCost: 0,
      avgResponseTime: 0,
      errorRate: 0,
    });
  });
});
