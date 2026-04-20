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
    vi.doMock("@/lib/ledger-fallback", () => ({
      isLedgerOnlyMode: vi.fn(async () => true),
    }));

    const { findUsageLogsBatch } = await import("@/repository/usage-logs");
    await findUsageLogsBatch({});
    await findUsageLogsBatch({ sessionId: "   " });

    expect(whereArgs).toHaveLength(4);
    const basePrimaryWhereSql = sqlToString(whereArgs[0]).toLowerCase();
    const baseLedgerWhereSql = sqlToString(whereArgs[1]).toLowerCase();
    const blankPrimaryWhereSql = sqlToString(whereArgs[2]).toLowerCase();
    const blankLedgerWhereSql = sqlToString(whereArgs[3]).toLowerCase();
    expect(blankPrimaryWhereSql).toBe(basePrimaryWhereSql);
    expect(blankLedgerWhereSql).toBe(baseLedgerWhereSql);
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
    vi.doMock("@/lib/ledger-fallback", () => ({
      isLedgerOnlyMode: vi.fn(async () => true),
    }));

    const { findUsageLogsBatch } = await import("@/repository/usage-logs");
    await findUsageLogsBatch({ sessionId: "  abc  " });

    expect(whereArgs).toHaveLength(2);
    const primaryWhereSql = sqlToString(whereArgs[0]).toLowerCase();
    const ledgerWhereSql = sqlToString(whereArgs[1]).toLowerCase();
    expect(primaryWhereSql).toContain("abc");
    expect(primaryWhereSql).not.toContain("  abc  ");
    expect(ledgerWhereSql).toContain("abc");
    expect(ledgerWhereSql).not.toContain("  abc  ");
  });

  test("findUsageLogsBatch: hasMore 为 true 时缺失 createdAtRaw 应直接报错，避免静默截断", async () => {
    vi.resetModules();

    const selectMock = vi.fn(() =>
      createThenableQuery([
        {
          id: 101,
          createdAt: new Date("2026-03-21T00:00:00Z"),
          createdAtRaw: null,
          sessionId: null,
          requestSequence: null,
          userName: "u",
          keyName: "k",
          providerName: "p",
          model: "m",
          originalModel: "m",
          endpoint: "/v1/messages",
          statusCode: 200,
          inputTokens: 1,
          outputTokens: 1,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreation5mInputTokens: 0,
          cacheCreation1hInputTokens: 0,
          cacheTtlApplied: null,
          costUsd: "0.01",
          costMultiplier: null,
          durationMs: 10,
          ttfbMs: 5,
          errorMessage: null,
          providerChain: null,
          blockedBy: null,
          blockedReason: null,
          userAgent: null,
          messagesCount: null,
          context1mApplied: null,
          swapCacheTtlApplied: null,
          specialSettings: null,
        },
        {
          id: 100,
          createdAt: new Date("2026-03-20T00:00:00Z"),
          createdAtRaw: null,
          sessionId: null,
          requestSequence: null,
          userName: "u",
          keyName: "k",
          providerName: "p",
          model: "m",
          originalModel: "m",
          endpoint: "/v1/messages",
          statusCode: 200,
          inputTokens: 1,
          outputTokens: 1,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreation5mInputTokens: 0,
          cacheCreation1hInputTokens: 0,
          cacheTtlApplied: null,
          costUsd: "0.01",
          costMultiplier: null,
          durationMs: 10,
          ttfbMs: 5,
          errorMessage: null,
          providerChain: null,
          blockedBy: null,
          blockedReason: null,
          userAgent: null,
          messagesCount: null,
          context1mApplied: null,
          swapCacheTtlApplied: null,
          specialSettings: null,
        },
      ])
    );

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
      },
    }));
    vi.doMock("@/lib/ledger-fallback", () => ({
      isLedgerOnlyMode: vi.fn(async () => false),
    }));

    const { findUsageLogsBatch } = await import("@/repository/usage-logs");

    await expect(findUsageLogsBatch({ limit: 1 })).rejects.toThrow(
      "findUsageLogsBatch: expected next cursor when hasMore is true"
    );
  });

  test("findUsageLogsBatch: 应将 limit 限制在 100，避免超大批量查询", async () => {
    vi.resetModules();

    let query: ReturnType<typeof createThenableQuery<[]>> | null = null;
    const selectMock = vi.fn(() => {
      query = createThenableQuery([]);
      return query;
    });

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));
    vi.doMock("@/lib/ledger-fallback", () => ({
      isLedgerOnlyMode: vi.fn(async () => false),
    }));

    const { findUsageLogsBatch } = await import("@/repository/usage-logs");
    await findUsageLogsBatch({ limit: 1000000 });

    expect(query?.limit).toHaveBeenCalledWith(101);
  });

  test("findUsageLogsForKeyBatch: hasMore 为 true 时缺失 createdAtRaw 应直接报错，避免静默截断", async () => {
    vi.resetModules();

    const selectMock = vi.fn(() =>
      createThenableQuery([
        {
          id: 201,
          createdAt: new Date("2026-03-21T00:00:00Z"),
          createdAtRaw: null,
          model: "m",
          originalModel: "m",
          endpoint: "/v1/messages",
          statusCode: 200,
          inputTokens: 1,
          outputTokens: 1,
          costUsd: "0.01",
          durationMs: 10,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreation5mInputTokens: 0,
          cacheCreation1hInputTokens: 0,
          cacheTtlApplied: null,
          specialSettings: null,
        },
        {
          id: 200,
          createdAt: new Date("2026-03-20T00:00:00Z"),
          createdAtRaw: null,
          model: "m",
          originalModel: "m",
          endpoint: "/v1/messages",
          statusCode: 200,
          inputTokens: 1,
          outputTokens: 1,
          costUsd: "0.01",
          durationMs: 10,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreation5mInputTokens: 0,
          cacheCreation1hInputTokens: 0,
          cacheTtlApplied: null,
          specialSettings: null,
        },
      ])
    );

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
      },
    }));
    vi.doMock("@/lib/ledger-fallback", () => ({
      isLedgerOnlyMode: vi.fn(async () => false),
    }));

    const { findUsageLogsForKeyBatch } = await import("@/repository/usage-logs");

    await expect(findUsageLogsForKeyBatch({ keyString: "k", limit: 1 })).rejects.toThrow(
      "findUsageLogsForKeyBatch: expected next cursor when hasMore is true"
    );
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
