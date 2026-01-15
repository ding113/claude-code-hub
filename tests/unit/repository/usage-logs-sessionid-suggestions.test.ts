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

function createThenableQuery<T>(
  result: T,
  opts?: {
    whereArgs?: unknown[];
    groupByArgs?: unknown[];
    orderByArgs?: unknown[];
    limitArgs?: unknown[];
  }
) {
  const query: any = Promise.resolve(result);

  query.from = vi.fn(() => query);
  query.innerJoin = vi.fn(() => query);
  query.leftJoin = vi.fn(() => query);
  query.where = vi.fn((arg: unknown) => {
    opts?.whereArgs?.push(arg);
    return query;
  });
  query.groupBy = vi.fn((...args: unknown[]) => {
    opts?.groupByArgs?.push(args);
    return query;
  });
  query.orderBy = vi.fn((...args: unknown[]) => {
    opts?.orderByArgs?.push(args);
    return query;
  });
  query.limit = vi.fn((arg: unknown) => {
    opts?.limitArgs?.push(arg);
    return query;
  });

  return query;
}

describe("Usage logs sessionId suggestions", () => {
  test("term 为空/空白：应直接返回空数组且不查询 DB", async () => {
    vi.resetModules();

    const selectMock = vi.fn(() => createThenableQuery([]));
    vi.doMock("@/drizzle/db", () => ({
      db: { select: selectMock },
    }));

    const { findUsageLogSessionIdSuggestions } = await import("@/repository/usage-logs");
    const result = await findUsageLogSessionIdSuggestions({ term: "   " });

    expect(result).toEqual([]);
    expect(selectMock).not.toHaveBeenCalled();
  });

  test("term 应 trim 并按 MIN(created_at) 倒序，limit 生效", async () => {
    vi.resetModules();

    const whereArgs: unknown[] = [];
    const groupByArgs: unknown[] = [];
    const orderByArgs: unknown[] = [];
    const limitArgs: unknown[] = [];
    const selectMock = vi.fn(() =>
      createThenableQuery(
        [
          { sessionId: "session_1", firstSeen: new Date("2026-01-01T00:00:00Z") },
          { sessionId: null, firstSeen: new Date("2026-01-01T00:00:00Z") },
        ],
        { whereArgs, groupByArgs, orderByArgs, limitArgs }
      )
    );

    vi.doMock("@/drizzle/db", () => ({
      db: { select: selectMock },
    }));

    const { findUsageLogSessionIdSuggestions } = await import("@/repository/usage-logs");
    const result = await findUsageLogSessionIdSuggestions({
      term: "  abc  ",
      userId: 1,
      keyId: 2,
      providerId: 3,
      limit: 20,
    });

    expect(result).toEqual(["session_1"]);

    expect(whereArgs.length).toBeGreaterThan(0);
    const whereSql = sqlToString(whereArgs[0]).toLowerCase();
    expect(whereSql).toContain("like");
    expect(whereSql).toContain("escape");
    expect(whereSql).toContain("abc%");
    expect(whereSql).not.toContain("%abc%");
    expect(whereSql).not.toContain("ilike");
    expect(whereSql).not.toContain("  abc  ");

    expect(groupByArgs.length).toBeGreaterThan(0);

    expect(orderByArgs.length).toBeGreaterThan(0);
    const orderSql = sqlToString(orderByArgs[0]).toLowerCase();
    expect(orderSql).toContain("min");

    expect(limitArgs).toEqual([20]);
  });

  test("term 含 %/_/\\\\：应按字面量前缀匹配（需转义）", async () => {
    vi.resetModules();

    const whereArgs: unknown[] = [];
    const selectMock = vi.fn(() => createThenableQuery([], { whereArgs }));

    vi.doMock("@/drizzle/db", () => ({
      db: { select: selectMock },
    }));

    const { findUsageLogSessionIdSuggestions } = await import("@/repository/usage-logs");
    await findUsageLogSessionIdSuggestions({
      term: "a%_\\b",
      limit: 20,
    });

    expect(whereArgs.length).toBeGreaterThan(0);
    const whereSql = sqlToString(whereArgs[0]).toLowerCase();
    expect(whereSql).toContain("like");
    expect(whereSql).toContain("escape");
    expect(whereSql).toContain("a\\%\\_\\\\b%");
    expect(whereSql).not.toContain("ilike");
  });

  test("limit 应被 clamp 到 [1, 50]", async () => {
    vi.resetModules();

    const limitArgs: unknown[] = [];
    const selectMock = vi.fn(() => createThenableQuery([], { limitArgs }));
    vi.doMock("@/drizzle/db", () => ({
      db: { select: selectMock },
    }));

    const { findUsageLogSessionIdSuggestions } = await import("@/repository/usage-logs");
    await findUsageLogSessionIdSuggestions({ term: "abc", limit: 500 });

    expect(limitArgs).toEqual([50]);
  });

  test("keyId 未提供时不应 innerJoin(keysTable)", async () => {
    vi.resetModules();

    const query = createThenableQuery([]);
    const selectMock = vi.fn(() => query);
    vi.doMock("@/drizzle/db", () => ({
      db: { select: selectMock },
    }));

    const { findUsageLogSessionIdSuggestions } = await import("@/repository/usage-logs");
    await findUsageLogSessionIdSuggestions({ term: "abc", limit: 20 });

    expect(query.innerJoin).not.toHaveBeenCalled();
  });

  test("keyId 提供时才 innerJoin(keysTable)", async () => {
    vi.resetModules();

    const query = createThenableQuery([]);
    const selectMock = vi.fn(() => query);
    vi.doMock("@/drizzle/db", () => ({
      db: { select: selectMock },
    }));

    const { findUsageLogSessionIdSuggestions } = await import("@/repository/usage-logs");
    await findUsageLogSessionIdSuggestions({ term: "abc", keyId: 2, limit: 20 });

    expect(query.innerJoin).toHaveBeenCalledTimes(1);
  });
});
