import { describe, expect, test, vi } from "vitest";

import { buildUsageLogConditions } from "@/repository/_shared/usage-log-filters";

function sqlToString(sqlObj: unknown): string {
  const visited = new Set<unknown>();

  const walk = (node: unknown): string => {
    if (!node || visited.has(node)) return "";
    visited.add(node);

    if (typeof node === "string") return node;

    if (typeof node === "object") {
      const anyNode = node as any;
      if (Array.isArray(anyNode)) {
        return anyNode.map(walk).join("");
      }

      if (anyNode.value) {
        if (Array.isArray(anyNode.value)) {
          return anyNode.value.map(String).join("");
        }
        return String(anyNode.value);
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

describe("Usage logs minRetryCount filter", () => {
  test("buildUsageLogConditions: 应使用 provider_chain 长度 - 2", () => {
    const [condition] = buildUsageLogConditions({ minRetryCount: 1 });
    const whereSql = sqlToString(condition).toLowerCase();
    expect(whereSql).toContain("jsonb_array_length");
    expect(whereSql).toMatch(/-\s*2/);
    expect(whereSql).not.toMatch(/-\s*1/);
  });

  test("findUsageLogsStats: 应使用 provider_chain 长度 - 2", async () => {
    vi.resetModules();

    const whereArgs: unknown[] = [];
    const selectMock = vi.fn(() =>
      createThenableQuery(
        [
          {
            totalRequests: 0,
            totalCost: "0",
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCacheCreationTokens: 0,
            totalCacheReadTokens: 0,
            totalCacheCreation5mTokens: 0,
            totalCacheCreation1hTokens: 0,
          },
        ],
        whereArgs
      )
    );

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
      },
    }));
    vi.doMock("@/lib/ledger-fallback", () => ({
      isLedgerOnlyMode: vi.fn(async () => false),
    }));

    const { findUsageLogsStats } = await import("@/repository/usage-logs");
    await findUsageLogsStats({ minRetryCount: 1 });

    expect(whereArgs).toHaveLength(1);
    const whereSql = sqlToString(whereArgs[0]).toLowerCase();
    expect(whereSql).toContain("jsonb_array_length");
    expect(whereSql).toMatch(/-\s*2/);
    expect(whereSql).not.toMatch(/-\s*1/);
  });
});
