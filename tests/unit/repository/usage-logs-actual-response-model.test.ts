import { describe, expect, test, vi } from "vitest";

/**
 * Verifies that `actualResponseModel` is threaded through both the primary
 * (message_request) query path and the ledger-only fallback (usage_ledger) path.
 * Uses the same select-mock harness as usage-logs-sessionid-filter.test.ts.
 */

function createThenableQuery<T>(result: T) {
  const query: any = Promise.resolve(result);
  query.from = vi.fn(() => query);
  query.innerJoin = vi.fn(() => query);
  query.leftJoin = vi.fn(() => query);
  query.orderBy = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.offset = vi.fn(() => query);
  query.groupBy = vi.fn(() => query);
  query.where = vi.fn(() => query);
  return query;
}

describe("findUsageLogsBatch: actualResponseModel propagation", () => {
  test("primary (message_request) path: field flows from select to UsageLogRow", async () => {
    vi.resetModules();

    const rows = [
      {
        id: 42,
        createdAt: new Date("2026-04-24T10:00:00Z"),
        createdAtRaw: "2026-04-24T10:00:00.000000Z",
        sessionId: null,
        requestSequence: 1,
        userName: "u",
        keyName: "k",
        providerName: "p",
        model: "gpt-4.1",
        originalModel: "gpt-4.1",
        actualResponseModel: "gpt-4.1-2025-04-14",
        endpoint: "/v1/chat/completions",
        statusCode: 200,
        inputTokens: 10,
        outputTokens: 20,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreation5mInputTokens: 0,
        cacheCreation1hInputTokens: 0,
        cacheTtlApplied: null,
        costUsd: "0.01",
        costMultiplier: null,
        groupCostMultiplier: null,
        costBreakdown: null,
        durationMs: 500,
        ttfbMs: 100,
        errorMessage: null,
        providerChain: null,
        blockedBy: null,
        blockedReason: null,
        userAgent: null,
        clientIp: null,
        messagesCount: 1,
        context1mApplied: false,
        swapCacheTtlApplied: false,
        specialSettings: null,
      },
    ];

    const selectMock = vi.fn(() => createThenableQuery(rows));

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        execute: vi.fn(async () => ({ count: 1 })),
      },
    }));
    vi.doMock("@/lib/ledger-fallback", () => ({
      isLedgerOnlyMode: vi.fn(async () => false),
    }));

    const { findUsageLogsBatch } = await import("@/repository/usage-logs");
    const result = await findUsageLogsBatch({});

    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]).toMatchObject({
      id: 42,
      model: "gpt-4.1",
      originalModel: "gpt-4.1",
      actualResponseModel: "gpt-4.1-2025-04-14",
    });
  });

  test("ledger-only fallback path: field flows from usageLedger select to UsageLogRow", async () => {
    vi.resetModules();

    const ledgerRows = [
      {
        id: 99,
        createdAt: new Date("2026-04-24T09:00:00Z"),
        createdAtRaw: "2026-04-24T09:00:00.000000Z",
        sessionId: null,
        userId: 1,
        userName: "u",
        key: "sk-x",
        keyName: "k",
        providerName: "p",
        model: "gemini-2.5-flash",
        originalModel: "gemini-2.5-flash",
        actualResponseModel: "gemini-2.5-flash-lite",
        endpoint: "/v1beta/models/gemini-2.5-flash:generateContent",
        statusCode: 200,
        inputTokens: 5,
        outputTokens: 5,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreation5mInputTokens: 0,
        cacheCreation1hInputTokens: 0,
        cacheTtlApplied: null,
        costUsd: "0.005",
        costMultiplier: null,
        groupCostMultiplier: null,
        durationMs: 400,
        ttfbMs: 80,
        clientIp: null,
        context1mApplied: false,
        swapCacheTtlApplied: false,
      },
    ];

    const selectMock = vi.fn(() => createThenableQuery(ledgerRows));

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        execute: vi.fn(async () => ({ count: 1 })),
      },
    }));
    vi.doMock("@/lib/ledger-fallback", () => ({
      isLedgerOnlyMode: vi.fn(async () => true),
    }));

    const { findUsageLogsBatch } = await import("@/repository/usage-logs");
    const result = await findUsageLogsBatch({});

    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]).toMatchObject({
      id: 99,
      model: "gemini-2.5-flash",
      actualResponseModel: "gemini-2.5-flash-lite",
    });
  });

  test("missing actualResponseModel in upstream row surfaces as null (not undefined)", async () => {
    vi.resetModules();

    const ledgerRows = [
      {
        id: 7,
        createdAt: new Date(),
        createdAtRaw: "2026-04-24T08:00:00.000000Z",
        sessionId: null,
        userId: 1,
        userName: "u",
        key: "sk-y",
        keyName: "k",
        providerName: null,
        model: "m",
        originalModel: null,
        actualResponseModel: null,
        endpoint: "/v1/messages",
        statusCode: 200,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreation5mInputTokens: 0,
        cacheCreation1hInputTokens: 0,
        cacheTtlApplied: null,
        costUsd: "0",
        costMultiplier: null,
        groupCostMultiplier: null,
        durationMs: 0,
        ttfbMs: 0,
        clientIp: null,
        context1mApplied: false,
        swapCacheTtlApplied: false,
      },
    ];

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: vi.fn(() => createThenableQuery(ledgerRows)),
        execute: vi.fn(async () => ({ count: 1 })),
      },
    }));
    vi.doMock("@/lib/ledger-fallback", () => ({
      isLedgerOnlyMode: vi.fn(async () => true),
    }));

    const { findUsageLogsBatch } = await import("@/repository/usage-logs");
    const result = await findUsageLogsBatch({});

    expect(result.logs[0].actualResponseModel).toBeNull();
  });
});
