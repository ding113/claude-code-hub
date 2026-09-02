import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

const isLedgerOnlyModeMock = vi.hoisted(() => vi.fn<() => Promise<boolean>>());

vi.mock("@/lib/ledger-fallback", () => ({
  isLedgerOnlyMode: isLedgerOnlyModeMock,
}));

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
    fromArgs?: unknown[];
    whereArgs?: unknown[];
    groupByArgs?: unknown[];
    orderByArgs?: unknown[];
    limitArgs?: unknown[];
  }
) {
  const query: any = Promise.resolve(result);

  query.from = vi.fn((arg: unknown) => {
    opts?.fromArgs?.push(arg);
    return query;
  });
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
  query.as = vi.fn((alias: string) => ({
    ...query,
    sessionId: { name: "session_id" },
    createdAt: { name: "created_at" },
    id: { name: "id" },
    _alias: alias,
  }));

  return query;
}

describe("Usage logs sessionId suggestions", () => {
  test("reserved physical IDs are excluded from suggestions", () => {
    const source = readFileSync(resolve(process.cwd(), "src/repository/usage-logs.ts"), "utf8");
    expect(source).toContain("NOT LIKE 'pfx:%'");
    expect(source).toContain("NOT LIKE 'sid:%'");
  });

  test.each([false, true])("filters reserved physical IDs in %s storage", async (ledgerOnly) => {
    vi.resetModules();
    isLedgerOnlyModeMock.mockResolvedValue(ledgerOnly);
    const whereArgs: unknown[] = [];
    const selectMock = vi.fn(() => createThenableQuery([], { whereArgs }));
    vi.doMock("@/drizzle/db", () => ({ db: { select: selectMock } }));

    const { findUsageLogSessionIdSuggestions } = await import("@/repository/usage-logs");
    await findUsageLogSessionIdSuggestions({ term: "s" });

    const whereSql = whereArgs.map((condition) =>
      new PgDialect().sqlToQuery(condition as never).sql.toLowerCase()
    );
    const physicalSql = whereSql.find((sql) => sql.includes('"session_id" not like'));
    expect(physicalSql).toContain("\"session_id\" not like 'pfx:%'");
    expect(physicalSql).toContain("\"session_id\" not like 'sid:%'");
  });
  beforeEach(() => {
    isLedgerOnlyModeMock.mockReset();
    isLedgerOnlyModeMock.mockResolvedValue(false);
  });

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

  test("term 应 trim 并按最近 created_at 倒序，limit 生效", async () => {
    vi.resetModules();

    const whereArgs: unknown[] = [];
    const groupByArgs: unknown[] = [];
    const orderByArgs: unknown[] = [];
    const limitArgs: unknown[] = [];
    const selectMock = vi.fn((selection: any) =>
      createThenableQuery(
        selection && "firstSeen" in selection
          ? [
              { sessionId: "session_1", firstSeen: new Date("2026-01-01T00:00:00Z") },
              { sessionId: null, firstSeen: new Date("2026-01-01T00:00:00Z") },
            ]
          : [],
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
    const allOrderSql = orderByArgs.map((arg) => sqlToString(arg).toLowerCase()).join(" ");
    expect(allOrderSql).toContain("max");

    expect(limitArgs).toContain(20);
  });

  test("returns only candidate identities that match the searched prefix", async () => {
    vi.resetModules();

    const selectMock = vi.fn((selection: any) => {
      if (selection && "firstSeen" in selection) {
        return createThenableQuery([
          {
            sessionId: "client-session",
            firstSeen: new Date("2026-01-01T00:00:00Z"),
          },
        ]);
      }
      return createThenableQuery([]);
    });
    vi.doMock("@/drizzle/db", () => ({ db: { select: selectMock } }));

    const { findUsageLogSessionIdSuggestions } = await import("@/repository/usage-logs");
    await expect(findUsageLogSessionIdSuggestions({ term: "client", limit: 20 })).resolves.toEqual([
      "client-session",
    ]);
  });

  test("deduplicates canonical and physical candidates before applying the final limit", async () => {
    vi.resetModules();

    let outerCallCount = 0;
    const selectMock = vi.fn((selection: any) => {
      if (selection && "firstSeen" in selection) {
        outerCallCount++;
        if (outerCallCount === 1) {
          return createThenableQuery([
            { sessionId: "session-shared", firstSeen: new Date("2026-01-03T00:00:00Z") },
            { sessionId: "session-canonical", firstSeen: new Date("2026-01-01T00:00:00Z") },
          ]);
        }
        return createThenableQuery([
          { sessionId: "session-shared", firstSeen: new Date("2026-01-02T00:00:00Z") },
          { sessionId: "session-physical", firstSeen: new Date("2026-01-02T12:00:00Z") },
        ]);
      }
      return createThenableQuery([]);
    });
    vi.doMock("@/drizzle/db", () => ({ db: { select: selectMock } }));

    const { findUsageLogSessionIdSuggestions } = await import("@/repository/usage-logs");
    await expect(findUsageLogSessionIdSuggestions({ term: "session-", limit: 2 })).resolves.toEqual(
      ["session-shared", "session-physical"]
    );
  });

  test("returns canonical and physical candidates from ledger-only storage", async () => {
    vi.resetModules();
    isLedgerOnlyModeMock.mockResolvedValueOnce(true);

    const fromArgs: unknown[] = [];
    const whereArgs: unknown[] = [];
    let outerCallCount = 0;
    const selectMock = vi.fn((selection: any) => {
      if (selection && "firstSeen" in selection) {
        outerCallCount++;
        if (outerCallCount === 1) {
          return createThenableQuery(
            [{ sessionId: "pfx:scope:fingerprint", firstSeen: new Date("2026-01-03T00:00:00Z") }],
            { fromArgs, whereArgs }
          );
        }
        return createThenableQuery(
          [{ sessionId: "physical-client", firstSeen: new Date("2026-01-02T00:00:00Z") }],
          { fromArgs, whereArgs }
        );
      }
      return createThenableQuery([], { fromArgs, whereArgs });
    });
    vi.doMock("@/drizzle/db", () => ({ db: { select: selectMock } }));

    const { findUsageLogSessionIdSuggestions } = await import("@/repository/usage-logs");
    await expect(
      findUsageLogSessionIdSuggestions({
        term: "p",
        userId: 1,
        keyId: 2,
        providerId: 3,
        limit: 20,
      })
    ).resolves.toEqual(["pfx:scope:fingerprint", "physical-client"]);

    expect(isLedgerOnlyModeMock).toHaveBeenCalledOnce();
    const tableNames = fromArgs.map((table) =>
      table && typeof table === "object" && "name" in table
        ? (table as any).name
        : getTableName(table as Parameters<typeof getTableName>[0])
    );
    expect(tableNames.filter((n) => n === "usage_ledger").length).toBeGreaterThan(0);
    for (const condition of whereArgs) {
      const whereSql = sqlToString(condition).toLowerCase();
      expect(whereSql).not.toContain("message_request");
    }
  });

  test("ignores candidates whose latest createdAt is NULL", async () => {
    vi.resetModules();

    let outerCallCount = 0;
    const selectMock = vi.fn((selection: any) => {
      if (selection && "firstSeen" in selection) {
        outerCallCount++;
        if (outerCallCount === 1) {
          return createThenableQuery([
            { sessionId: "session-null", firstSeen: null },
            { sessionId: "session-valid", firstSeen: new Date("2026-01-02T00:00:00Z") },
          ]);
        }
        return createThenableQuery([]);
      }
      return createThenableQuery([]);
    });
    vi.doMock("@/drizzle/db", () => ({ db: { select: selectMock } }));

    const { findUsageLogSessionIdSuggestions } = await import("@/repository/usage-logs");
    await expect(
      findUsageLogSessionIdSuggestions({ term: "session-", limit: 20 })
    ).resolves.toEqual(["session-valid"]);
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

    // The final clamped limit of 50 is passed to the outer query
    expect(limitArgs).toContain(50);
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

    expect(selectMock.mock.calls.length).toBeGreaterThanOrEqual(2);
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

    expect(query.innerJoin).toHaveBeenCalled();
  });

  test("bounds candidate subquery scan with id DESC and subquery limit to prevent full-table scans", async () => {
    vi.resetModules();

    const orderByArgs: unknown[] = [];
    const limitArgs: unknown[] = [];
    const selectMock = vi.fn(() => createThenableQuery([], { orderByArgs, limitArgs }));
    vi.doMock("@/drizzle/db", () => ({
      db: { select: selectMock },
    }));

    const { findUsageLogSessionIdSuggestions } = await import("@/repository/usage-logs");
    await findUsageLogSessionIdSuggestions({ term: "01", limit: 20 });

    // Inner subquery orders by id DESC and bounds scan with Math.max(500, limit * 25)
    expect(limitArgs).toContain(500);
    expect(limitArgs).toContain(20);
  });

  test.each([false, true])(
    "builds valid Drizzle queries without SelectionProxy errors for raw SQL candidate expressions (ledgerOnly=%s)",
    async (ledgerOnly) => {
      vi.resetModules();
      isLedgerOnlyModeMock.mockResolvedValue(ledgerOnly);

      const generatedQueries: string[] = [];
      const fakeClient: any = Object.assign(() => Promise.resolve([]), {
        options: { parsers: {}, serializers: {} },
        unsafe: () => ({ values: () => Promise.resolve([]) }),
      });
      const { drizzle } = await import("drizzle-orm/postgres-js");
      const realDb = drizzle(fakeClient);

      const dummy = realDb
        .select()
        .from(
          realDb._.schema ? (realDb as any) : (await import("@/drizzle/schema")).messageRequest
        );
      const proto = Object.getPrototypeOf(dummy);
      const origThen = proto.then;
      // biome-ignore lint/suspicious/noThenProperty: test spy intercepts query execution to assert generated SQL
      proto.then = function (onfulfilled: any, onrejected: any) {
        generatedQueries.push(this.toSQL().sql);
        return Promise.resolve([]).then(onfulfilled, onrejected);
      };

      vi.doMock("@/drizzle/db", () => ({
        db: realDb,
      }));

      try {
        const { findUsageLogSessionIdSuggestions } = await import("@/repository/usage-logs");
        const result = await findUsageLogSessionIdSuggestions({ term: "b44", limit: 20 });

        expect(result).toEqual([]);
        expect(generatedQueries.length).toBe(2);
        for (const sql of generatedQueries) {
          expect(sql.toLowerCase()).toContain("session_id");
          expect(sql.toLowerCase()).toContain("max(");
        }
      } finally {
        // biome-ignore lint/suspicious/noThenProperty: restore original then implementation
        proto.then = origThen;
      }
    }
  );
});
