import { describe, expect, test, vi } from "vitest";

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

describe("Usage logs sessionId filter", () => {
  test("findUsageLogsBatch: sessionId 为空/空白不应追加条件", async () => {
    vi.resetModules();

    const whereArgs: unknown[] = [];
    const selectMock = vi.fn(() => createThenableQuery([], whereArgs));

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { findUsageLogsBatch } = await import("@/repository/usage-logs");
    await findUsageLogsBatch({});
    await findUsageLogsBatch({ sessionId: "   " });

    expect(whereArgs).toHaveLength(2);
    const baseWhereSql = sqlToString(whereArgs[0]).toLowerCase();
    const blankWhereSql = sqlToString(whereArgs[1]).toLowerCase();
    expect(blankWhereSql).toBe(baseWhereSql);
  });

  test("findUsageLogsBatch: sessionId 应 trim 后精确匹配", async () => {
    vi.resetModules();

    const whereArgs: unknown[] = [];
    const selectMock = vi.fn(() => createThenableQuery([], whereArgs));

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { findUsageLogsBatch } = await import("@/repository/usage-logs");
    await findUsageLogsBatch({ sessionId: "  abc  " });

    expect(whereArgs.length).toBeGreaterThan(0);
    const whereSql = sqlToString(whereArgs[0]).toLowerCase();
    expect(whereSql).toContain("abc");
    expect(whereSql).not.toContain("  abc  ");
  });

  test("findUsageLogsWithDetails: sessionId 为空/空白不应追加条件", async () => {
    vi.resetModules();

    const whereArgs: unknown[] = [];
    const selectQueue: any[] = [];
    selectQueue.push(
      createThenableQuery(
        [
          {
            totalRows: 0,
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
    selectQueue.push(createThenableQuery([]));
    selectQueue.push(
      createThenableQuery(
        [
          {
            totalRows: 0,
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
    selectQueue.push(createThenableQuery([]));

    const fallbackSelect = createThenableQuery<unknown[]>([]);
    const selectMock = vi.fn(() => selectQueue.shift() ?? fallbackSelect);

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { findUsageLogsWithDetails } = await import("@/repository/usage-logs");
    await findUsageLogsWithDetails({ page: 1, pageSize: 1 });
    await findUsageLogsWithDetails({ page: 1, pageSize: 1, sessionId: "  " });

    expect(whereArgs).toHaveLength(2);
    const baseWhereSql = sqlToString(whereArgs[0]).toLowerCase();
    const blankWhereSql = sqlToString(whereArgs[1]).toLowerCase();
    expect(blankWhereSql).toBe(baseWhereSql);
  });

  test("findUsageLogsWithDetails: sessionId 应 trim 后精确匹配", async () => {
    vi.resetModules();

    const whereArgs: unknown[] = [];
    const selectQueue: any[] = [];
    selectQueue.push(
      createThenableQuery(
        [
          {
            totalRows: 0,
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
    selectQueue.push(createThenableQuery([]));

    const fallbackSelect = createThenableQuery<unknown[]>([]);
    const selectMock = vi.fn(() => selectQueue.shift() ?? fallbackSelect);

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { findUsageLogsWithDetails } = await import("@/repository/usage-logs");
    await findUsageLogsWithDetails({ page: 1, pageSize: 1, sessionId: "  abc  " });

    expect(whereArgs.length).toBeGreaterThan(0);
    const whereSql = sqlToString(whereArgs[0]).toLowerCase();
    expect(whereSql).toContain("abc");
    expect(whereSql).not.toContain("  abc  ");
  });

  test("findUsageLogsStats: sessionId 为空/空白不应追加条件", async () => {
    vi.resetModules();

    const whereArgs: unknown[] = [];
    const selectQueue: any[] = [];
    selectQueue.push(
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
    selectQueue.push(
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

    const fallbackSelect = createThenableQuery<unknown[]>([]);
    const selectMock = vi.fn(() => selectQueue.shift() ?? fallbackSelect);

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { findUsageLogsStats } = await import("@/repository/usage-logs");
    await findUsageLogsStats({});
    await findUsageLogsStats({ sessionId: "  " });

    expect(whereArgs).toHaveLength(2);
    const baseWhereSql = sqlToString(whereArgs[0]).toLowerCase();
    const blankWhereSql = sqlToString(whereArgs[1]).toLowerCase();
    expect(blankWhereSql).toBe(baseWhereSql);
  });

  test("findUsageLogsStats: sessionId 应 trim 后精确匹配", async () => {
    vi.resetModules();

    const whereArgs: unknown[] = [];
    const selectQueue: any[] = [];
    selectQueue.push(
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

    const fallbackSelect = createThenableQuery<unknown[]>([]);
    const selectMock = vi.fn(() => selectQueue.shift() ?? fallbackSelect);

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { findUsageLogsStats } = await import("@/repository/usage-logs");
    await findUsageLogsStats({ sessionId: "  abc  " });

    expect(whereArgs.length).toBeGreaterThan(0);
    const whereSql = sqlToString(whereArgs[0]).toLowerCase();
    expect(whereSql).toContain("abc");
    expect(whereSql).not.toContain("  abc  ");
  });
});
