import type { SQL } from "drizzle-orm";
import { CasingCache } from "drizzle-orm/casing";
import { describe, expect, test, vi } from "vitest";

function createThenableQuery<T>(result: T, whereArgs?: unknown[]) {
  const query: any = Promise.resolve(result);
  query.from = vi.fn(() => query);
  query.innerJoin = vi.fn(() => query);
  query.leftJoin = vi.fn(() => query);
  query.orderBy = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.offset = vi.fn(() => query);
  query.where = vi.fn((condition: unknown) => {
    whereArgs?.push(condition);
    return query;
  });
  return query;
}

function compileSql(value: SQL) {
  return value.toQuery({
    escapeName: (name) => `"${name}"`,
    escapeParam: (num) => `$${num}`,
    escapeString: (text) => `'${text}'`,
    casing: new CasingCache(),
    paramStartIndex: { value: 1 },
  });
}

function makeReplayRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    createdAtRaw: "2026-08-01T00:00:00.000000Z",
    sessionId: "session-1",
    requestSequence: 1,
    userName: "user",
    keyName: "key",
    providerName: "provider",
    model: "claude-sonnet-4-5",
    originalModel: "claude-sonnet-4-5",
    actualResponseModel: "claude-sonnet-4-5",
    endpoint: "/v1/messages",
    statusCode: 200,
    inputTokens: 10,
    outputTokens: 20,
    cacheCreationInputTokens: 30,
    cacheReadInputTokens: 40,
    cacheCreation5mInputTokens: 30,
    cacheCreation1hInputTokens: 0,
    cacheTtlApplied: "5m",
    costUsd: "0",
    costMultiplier: "1",
    groupCostMultiplier: "1",
    costBreakdown: null,
    hedgeLosers: null,
    durationMs: null,
    tfftMs: null,
    firstByteMs: null,
    errorMessage: null,
    providerChain: null,
    routingTrace: null,
    blockedBy: null,
    blockedReason: null,
    userAgent: null,
    clientIp: null,
    messagesCount: 1,
    context1mApplied: false,
    swapCacheTtlApplied: false,
    specialSettings: null,
    isReplay: true,
    replaySourceRequestId: 7,
    ...overrides,
  };
}

describe("findUsageLogsBatch Replay projection", () => {
  test("projects Replay provenance from message_request", async () => {
    vi.resetModules();
    const selectMock = vi.fn(() => createThenableQuery([makeReplayRow()]));

    vi.doMock("@/drizzle/db", () => ({ db: { select: selectMock } }));
    vi.doMock("@/lib/ledger-fallback", () => ({
      isLedgerOnlyMode: vi.fn(async () => false),
    }));

    const { findUsageLogsBatch } = await import("@/repository/usage-logs");
    const result = await findUsageLogsBatch({});

    expect(selectMock.mock.calls[0]?.[0]).toMatchObject({
      isReplay: expect.anything(),
      replaySourceRequestId: expect.anything(),
    });
    expect(result.logs[0]).toMatchObject({ isReplay: true, replaySourceRequestId: 7 });
  });

  test("projects Replay provenance from usage_ledger fallback", async () => {
    vi.resetModules();
    const ledgerRow = makeReplayRow({
      requestSequence: undefined,
      userId: 1,
      key: "sk-test",
    });
    const selectMock = vi
      .fn()
      .mockImplementationOnce(() => createThenableQuery([]))
      .mockImplementationOnce(() => createThenableQuery([ledgerRow]));

    vi.doMock("@/drizzle/db", () => ({ db: { select: selectMock } }));
    vi.doMock("@/lib/ledger-fallback", () => ({
      isLedgerOnlyMode: vi.fn(async () => true),
    }));

    const { findUsageLogsBatch } = await import("@/repository/usage-logs");
    const result = await findUsageLogsBatch({ replayFilter: "replay" });

    expect(selectMock.mock.calls[1]?.[0]).toMatchObject({
      isReplay: expect.anything(),
      replaySourceRequestId: expect.anything(),
    });
    expect(result.logs[0]).toMatchObject({ isReplay: true, replaySourceRequestId: 7 });
  });
});

describe("findUsageLogsStats Replay audit semantics", () => {
  test("includes Replay token usage in Replay-only stats while keeping persisted cost at zero", async () => {
    vi.resetModules();
    const whereArgs: unknown[] = [];
    const selectMock = vi.fn(() =>
      createThenableQuery(
        [
          {
            totalRequests: 1,
            totalCost: "0",
            totalInputTokens: 10,
            totalOutputTokens: 20,
            totalCacheCreationTokens: 30,
            totalCacheReadTokens: 40,
            totalCacheCreation5mTokens: 30,
            totalCacheCreation1hTokens: 0,
          },
        ],
        whereArgs
      )
    );

    vi.doMock("@/drizzle/db", () => ({ db: { select: selectMock } }));
    vi.doMock("@/lib/ledger-fallback", () => ({
      isLedgerOnlyMode: vi.fn(async () => false),
    }));

    const { findUsageLogsStats } = await import("@/repository/usage-logs");
    const result = await findUsageLogsStats({ replayFilter: "replay" });

    expect(result).toMatchObject({ totalRequests: 1, totalCost: 0, totalTokens: 100 });
    const query = compileSql(whereArgs[0] as SQL);
    expect(query.sql.toLowerCase()).toContain('"usage_ledger"."blocked_by" is null');
    expect(query.sql.toLowerCase()).toContain('"usage_ledger"."is_replay" =');
    expect(query.params).toContain(true);
  });

  test("does not silently exclude Replay rows from all-request stats", async () => {
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

    vi.doMock("@/drizzle/db", () => ({ db: { select: selectMock } }));
    vi.doMock("@/lib/ledger-fallback", () => ({
      isLedgerOnlyMode: vi.fn(async () => false),
    }));

    const { findUsageLogsStats } = await import("@/repository/usage-logs");
    await findUsageLogsStats({ replayFilter: "all" });

    const query = compileSql(whereArgs[0] as SQL);
    expect(query.sql.toLowerCase()).not.toContain('"usage_ledger"."is_replay"');
  });
});
