import { describe, expect, test, vi } from "vitest";

import { buildUsageLogConditions } from "@/repository/_shared/usage-log-filters";
import type { SQL } from "drizzle-orm";
import { CasingCache } from "drizzle-orm/casing";

function sqlToString(sqlObj: SQL): string {
  return sqlObj.toQuery({
    escapeName: (name: string) => `"${name}"`,
    escapeParam: (num: number, _value: unknown) => `$${num}`,
    escapeString: (value: string) => `'${value}'`,
    casing: new CasingCache(),
    paramStartIndex: { value: 1 },
  }).sql;
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
    expect(whereSql).not.toMatch(/-\s*1\b/);
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
    const whereSql = sqlToString(whereArgs[0] as SQL).toLowerCase();
    expect(whereSql).toContain("jsonb_array_length");
    expect(whereSql).toMatch(/-\s*2/);
    expect(whereSql).not.toMatch(/-\s*1\b/);
  });

  test("findUsageLogsStats: ledger-only 且 minRetryCount > 0 时应短路返回 0", async () => {
    vi.resetModules();

    const selectMock = vi.fn(() => {
      throw new Error("ledger-only 且 minRetryCount > 0 时不应触发 db 查询");
    });

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
      },
    }));
    vi.doMock("@/lib/ledger-fallback", () => ({
      isLedgerOnlyMode: vi.fn(async () => true),
    }));

    const { findUsageLogsStats } = await import("@/repository/usage-logs");
    const summary = await findUsageLogsStats({ minRetryCount: 1 });

    expect(selectMock).not.toHaveBeenCalled();
    expect(summary).toEqual({
      totalRequests: 0,
      totalCost: 0,
      totalTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheCreation5mTokens: 0,
      totalCacheCreation1hTokens: 0,
    });
  });
});
