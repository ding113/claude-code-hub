import { describe, expect, test, vi } from "vitest";

function createThenableQuery<T>(result: T) {
  const query: any = Promise.resolve(result);
  query.from = vi.fn(() => query);
  query.where = vi.fn(() => query);
  query.orderBy = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.offset = vi.fn(() => query);
  return query;
}

describe("findUsageLogsForKeySlim", () => {
  test("clamps page/pageSize and returns fast total when current page is complete", async () => {
    vi.resetModules();

    const rows = [
      {
        id: 1,
        createdAt: new Date("2026-03-21T00:00:00Z"),
        model: "m",
        originalModel: "m",
        endpoint: "/v1/messages",
        statusCode: 200,
        inputTokens: 1,
        outputTokens: 2,
        costUsd: "0.01",
        durationMs: 10,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreation5mInputTokens: 0,
        cacheCreation1hInputTokens: 0,
        cacheTtlApplied: null,
        specialSettings: null,
      },
    ];
    const logsQuery = createThenableQuery(rows);
    const ledgerLogsQuery = createThenableQuery([]);
    const messageCountQuery = createThenableQuery([{ totalRows: 1 }]);
    const ledgerCountQuery = createThenableQuery([{ totalRows: 0 }]);
    const selectMock = vi
      .fn()
      .mockImplementationOnce(() => logsQuery)
      .mockImplementationOnce(() => ledgerLogsQuery)
      .mockImplementationOnce(() => messageCountQuery)
      .mockImplementationOnce(() => ledgerCountQuery);

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
      },
    }));
    vi.doMock("@/lib/ledger-fallback", () => ({
      isLedgerOnlyMode: vi.fn(async () => false),
    }));

    const { findUsageLogsForKeySlim } = await import("@/repository/usage-logs");
    const result = await findUsageLogsForKeySlim({ keyString: "k", page: 0, pageSize: 999 });

    expect(logsQuery.limit).toHaveBeenCalledWith(101);
    expect(logsQuery.offset).toHaveBeenCalledWith(0);
    expect(result.total).toBe(1);
    expect(result.logs).toHaveLength(1);
  });

  test("runs count query when hasMore is true so total remains accurate", async () => {
    vi.resetModules();

    const logsQuery = createThenableQuery([
      {
        id: 1,
        createdAt: new Date("2026-03-21T00:00:00Z"),
        model: "m",
        originalModel: "m",
        endpoint: "/v1/messages",
        statusCode: 200,
        inputTokens: 1,
        outputTokens: 2,
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
        id: 2,
        createdAt: new Date("2026-03-20T00:00:00Z"),
        model: "m",
        originalModel: "m",
        endpoint: "/v1/messages",
        statusCode: 200,
        inputTokens: 1,
        outputTokens: 2,
        costUsd: "0.01",
        durationMs: 10,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreation5mInputTokens: 0,
        cacheCreation1hInputTokens: 0,
        cacheTtlApplied: null,
        specialSettings: null,
      },
    ]);
    const ledgerLogsQuery = createThenableQuery([]);
    const messageCountQuery = createThenableQuery([{ totalRows: 321 }]);
    const ledgerCountQuery = createThenableQuery([{ totalRows: 0 }]);
    const selectMock = vi
      .fn()
      .mockImplementationOnce(() => logsQuery)
      .mockImplementationOnce(() => ledgerLogsQuery)
      .mockImplementationOnce(() => messageCountQuery)
      .mockImplementationOnce(() => ledgerCountQuery);

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
      },
    }));
    vi.doMock("@/lib/ledger-fallback", () => ({
      isLedgerOnlyMode: vi.fn(async () => false),
    }));

    const { findUsageLogsForKeySlim } = await import("@/repository/usage-logs");
    const result = await findUsageLogsForKeySlim({ keyString: "k", page: 1, pageSize: 1 });

    expect(logsQuery.limit).toHaveBeenCalledWith(2);
    expect(logsQuery.offset).toHaveBeenCalledWith(0);
    expect(result.total).toBe(321);
    expect(result.logs).toHaveLength(1);
  });
});
