import { describe, expect, test, vi } from "vitest";

import { buildUsageLogConditions } from "@/repository/_shared/usage-log-filters";
import type { SQL } from "drizzle-orm";
import { CasingCache } from "drizzle-orm/casing";

// 注意：CasingCache 来自 drizzle-orm/casing 子路径导出；若未来 drizzle-orm 升级导致接口调整，
// 这里的 SQL 渲染 helper 需要同步更新。
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
  test("buildUsageLogConditions: minRetryCount <= 0 视为不筛选", () => {
    expect(buildUsageLogConditions({})).toHaveLength(0);
    expect(buildUsageLogConditions({ minRetryCount: 0 })).toHaveLength(0);
    expect(buildUsageLogConditions({ minRetryCount: -1 })).toHaveLength(0);
  });

  test("buildUsageLogConditions: 重试次数表达式应对齐 getRetryCount/isActualRequest", () => {
    const [condition] = buildUsageLogConditions({ minRetryCount: 1 });
    const whereSql = sqlToString(condition).toLowerCase();
    expect(whereSql).toContain("jsonb_array_elements");
    expect(whereSql).toContain("bool_or");
    expect(whereSql).toContain("sum");
    expect(whereSql).toMatch(/-\s*1\b/);
    expect(whereSql).not.toMatch(/-\s*2\b/);
    expect(whereSql).toContain("greatest");
    expect(whereSql).toContain("coalesce");
    expect(whereSql).toContain("request_success");
    expect(whereSql).toContain("retry_success");
    expect(whereSql).toContain("retry_failed");
    expect(whereSql).toContain("statuscode");
    expect(whereSql).toContain("hedge_triggered");
    expect(whereSql).not.toContain("jsonb_array_length");
  });

  test("findUsageLogsStats: 重试次数表达式应对齐 getRetryCount/isActualRequest", async () => {
    vi.resetModules();

    const whereArgs: unknown[] = [];
    let query: any;
    const selectMock = vi.fn(
      () =>
        (query = createThenableQuery(
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
        ))
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
    expect(whereSql).toContain("jsonb_array_elements");
    expect(whereSql).toContain("bool_or");
    expect(whereSql).toContain("sum");
    expect(whereSql).toMatch(/-\s*1\b/);
    expect(whereSql).not.toMatch(/-\s*2\b/);
    expect(whereSql).toContain("greatest");
    expect(whereSql).toContain("coalesce");
    expect(whereSql).toContain("request_success");
    expect(whereSql).toContain("retry_success");
    expect(whereSql).toContain("retry_failed");
    expect(whereSql).toContain("statuscode");
    expect(whereSql).toContain("hedge_triggered");
    expect(query?.innerJoin).toHaveBeenCalled();
  });

  test("findUsageLogsStats: minRetryCount <= 0 时不应 join messageRequest", async () => {
    vi.resetModules();

    let query: any;
    const selectMock = vi.fn(
      () =>
        (query = createThenableQuery([
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
        ]))
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
    await findUsageLogsStats({ minRetryCount: 0 });

    expect(query?.innerJoin).not.toHaveBeenCalled();
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
