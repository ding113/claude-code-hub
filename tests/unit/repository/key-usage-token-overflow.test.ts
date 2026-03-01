import { describe, expect, test, vi } from "vitest";

// 禁用 tests/setup.ts 中基于 DSN/Redis 的默认同步与清理协调，避免无关依赖引入。
process.env.DSN = "";
process.env.AUTO_CLEANUP_TEST_DATA = "false";

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

function createThenableQuery<T>(result: T) {
  const query: any = Promise.resolve(result);

  query.from = vi.fn(() => query);
  query.leftJoin = vi.fn(() => query);
  query.innerJoin = vi.fn(() => query);
  query.where = vi.fn(() => query);
  query.groupBy = vi.fn(() => query);
  query.orderBy = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.offset = vi.fn(() => query);

  return query;
}

describe("Key usage token aggregation overflow", () => {
  test("findKeyUsageTodayBatch: token sum 不应使用 ::int", async () => {
    vi.resetModules();

    const selectArgs: unknown[] = [];
    const selectMock = vi.fn((selection: unknown) => {
      selectArgs.push(selection);
      return createThenableQuery([]);
    });

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        // 给 tests/setup.ts 的 afterAll 清理逻辑一个可用的 execute
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { findKeyUsageTodayBatch } = await import("@/repository/key");
    await findKeyUsageTodayBatch([1]);

    expect(selectArgs).toHaveLength(1);
    const selection = selectArgs[0] as Record<string, unknown>;
    const totalTokensSql = sqlToString(selection.totalTokens).toLowerCase();

    expect(totalTokensSql).not.toContain("::int");
    expect(totalTokensSql).not.toContain("::int4");
    expect(totalTokensSql).toContain("double precision");
  });

  test("findKeysWithStatisticsBatch: unnest 必须使用 ARRAY[] 而非行构造器", async () => {
    vi.resetModules();

    const executeSqlArgs: unknown[] = [];

    const selectQueue: any[] = [];
    selectQueue.push(
      createThenableQuery([
        {
          id: 10,
          userId: 1,
          key: "k",
          name: "n",
          isEnabled: true,
          expiresAt: null,
          canLoginWebUi: true,
          limit5hUsd: null,
          limitDailyUsd: null,
          dailyResetMode: "fixed",
          dailyResetTime: "00:00",
          limitWeeklyUsd: null,
          limitMonthlyUsd: null,
          limitTotalUsd: null,
          limitConcurrentSessions: 0,
          providerGroup: null,
          cacheTtlPreference: null,
          createdAt: new Date("2024-01-01T00:00:00.000Z"),
          updatedAt: new Date("2024-01-01T00:00:00.000Z"),
          deletedAt: null,
        },
      ])
    );
    selectQueue.push(createThenableQuery([]));

    const fallbackSelect = createThenableQuery<unknown[]>([]);
    const selectMock = vi.fn((_selection: unknown) => selectQueue.shift() ?? fallbackSelect);

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        execute: vi.fn(async (sqlObj: unknown) => {
          executeSqlArgs.push(sqlObj);
          return [];
        }),
      },
    }));

    const { findKeysWithStatisticsBatch } = await import("@/repository/key");
    await findKeysWithStatisticsBatch([1]);

    expect(executeSqlArgs.length).toBeGreaterThan(0);
    const lateralJoinSql = sqlToString(executeSqlArgs[0]).toLowerCase();

    expect(lateralJoinSql).toContain("array[");
    expect(lateralJoinSql).not.toContain("unnest((");
    expect(lateralJoinSql).toContain("key_val");
  });

  test("findKeysWithStatisticsBatch: modelStats token sum 不应使用 ::int", async () => {
    vi.resetModules();

    const selectArgs: unknown[] = [];
    const selectQueue: any[] = [];

    selectQueue.push(
      createThenableQuery([
        {
          id: 10,
          userId: 1,
          key: "k",
          name: "n",
          isEnabled: true,
          expiresAt: null,
          canLoginWebUi: true,
          limit5hUsd: null,
          limitDailyUsd: null,
          dailyResetMode: "fixed",
          dailyResetTime: "00:00",
          limitWeeklyUsd: null,
          limitMonthlyUsd: null,
          limitTotalUsd: null,
          limitConcurrentSessions: 0,
          providerGroup: null,
          cacheTtlPreference: null,
          createdAt: new Date("2024-01-01T00:00:00.000Z"),
          updatedAt: new Date("2024-01-01T00:00:00.000Z"),
          deletedAt: null,
        },
      ])
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
        execute: vi.fn(async () => []),
      },
    }));

    const { findKeysWithStatisticsBatch } = await import("@/repository/key");
    await findKeysWithStatisticsBatch([1]);

    const selection = selectArgs.find((s): s is Record<string, unknown> => {
      if (!s || typeof s !== "object") return false;
      return "inputTokens" in s && "cacheReadTokens" in s;
    });
    expect(selection).toBeTruthy();

    for (const field of ["inputTokens", "outputTokens", "cacheCreationTokens", "cacheReadTokens"]) {
      const tokenSql = sqlToString(selection?.[field]).toLowerCase();
      expect(tokenSql).not.toContain("::int");
      expect(tokenSql).not.toContain("::int4");
      expect(tokenSql).toContain("double precision");
    }
  });
});
