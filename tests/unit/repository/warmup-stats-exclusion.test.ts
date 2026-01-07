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
  // 用 Promise 作为“可 await 的查询对象”，避免手动给普通对象挂 then（Biome 会报警）
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

describe("Warmup 请求：不计入任何聚合统计", () => {
  test("usage logs：分页 total 包含 warmup，但 summary.totalRequests 排除 warmup", async () => {
    vi.resetModules();

    const selectArgs: unknown[] = [];
    const selectQueue: any[] = [];

    selectQueue.push(
      createThenableQuery(
        [
          {
            totalRows: 2,
            totalRequests: 1,
            totalCost: "0",
            totalInputTokens: 10,
            totalOutputTokens: 20,
            totalCacheCreationTokens: 0,
            totalCacheReadTokens: 0,
            totalCacheCreation5mTokens: 0,
            totalCacheCreation1hTokens: 0,
          },
        ],
        []
      )
    );
    selectQueue.push(createThenableQuery([]));

    const fallbackSelect = createThenableQuery<unknown[]>([]);
    const selectMock = vi.fn((selection: unknown) => {
      selectArgs.push(selection);
      return selectQueue.shift() ?? fallbackSelect;
    });

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        // 给 tests/setup.ts 的 afterAll 清理逻辑一个可用的 execute
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { findUsageLogsWithDetails } = await import("@/repository/usage-logs");
    const result = await findUsageLogsWithDetails({ page: 1, pageSize: 50 });

    // total：用于分页/审计，包含 warmup 行
    expect(result.total).toBe(2);
    // summary：统计口径排除 warmup
    expect(result.summary.totalRequests).toBe(1);
    expect(result.summary.totalTokens).toBe(30);

    const firstSelect = selectArgs[0] as Record<string, unknown> | undefined;
    expect(firstSelect).toEqual(expect.objectContaining({ totalRows: expect.anything() }));
    expect(firstSelect).toEqual(expect.objectContaining({ totalRequests: expect.anything() }));
  });

  test("usage logs stats：WHERE 条件应包含 warmup 排除逻辑", async () => {
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
    await findUsageLogsStats({});

    expect(whereArgs.length).toBeGreaterThan(0);
    const whereSql = sqlToString(whereArgs[0]);
    expect(whereSql.toLowerCase()).toContain("warmup");
  });

  test("provider statistics：SQL 应排除 warmup（避免计入供应商统计/最近调用）", async () => {
    vi.resetModules();

    const executeMock = vi.fn(async () => [
      {
        id: 1,
        today_cost: "0",
        today_calls: 0,
        last_call_time: null,
        last_call_model: null,
      },
    ]);

    vi.doMock("@/drizzle/db", () => ({
      db: {
        execute: executeMock,
        // 给 tests/setup.ts 的 afterAll 清理逻辑一个可用的 select
        select: () => ({
          from: () => ({
            where: async () => [],
          }),
        }),
      },
    }));

    vi.doMock("@/lib/config", () => ({
      getEnvConfig: () => ({ TZ: "UTC" }),
    }));

    vi.doMock("@/lib/logger", () => ({
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        trace: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
      },
    }));

    const { getProviderStatistics } = await import("@/repository/provider");
    const result = await getProviderStatistics();

    expect(result[0]?.id).toBe(1);
    expect(executeMock).toHaveBeenCalledTimes(1);

    const queryArg = executeMock.mock.calls[0]?.[0];
    const querySql = sqlToString(queryArg);
    expect(querySql.toLowerCase()).toContain("warmup");
    expect(querySql.toLowerCase()).toContain("blocked_by");
  });
});
