import { describe, expect, test, vi } from "vitest";

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

describe("usage log reasoning effort mapping", () => {
  test("findUsageLogsBatch maps reasoningEffort from special settings", async () => {
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
        model: "o3-mini",
        originalModel: "o3",
        actualResponseModel: "o3-mini-2026-01",
        endpoint: "/v1/responses",
        statusCode: 200,
        inputTokens: 10,
        outputTokens: 20,
        reasoningOutputTokens: 7,
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
        specialSettings: [
          {
            type: "reasoning_effort",
            scope: "request",
            hit: true,
            path: "reasoning.effort",
            effort: "medium",
          },
          {
            type: "provider_parameter_override",
            scope: "provider",
            providerId: 1,
            providerName: "codex",
            providerType: "codex",
            hit: true,
            changed: true,
            changes: [
              { path: "reasoning.effort", before: "medium", after: "high", changed: true },
            ],
          },
        ],
      },
    ];

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: vi.fn(() => createThenableQuery(rows)),
        execute: vi.fn(async () => ({ count: 1 })),
      },
    }));
    vi.doMock("@/lib/ledger-fallback", () => ({
      isLedgerOnlyMode: vi.fn(async () => false),
    }));

    const { findUsageLogsBatch } = await import("@/repository/usage-logs");
    const result = await findUsageLogsBatch({});

    expect(result.logs[0].reasoningEffort).toEqual({
      originalEffort: "medium",
      overriddenEffort: "high",
      isOverridden: true,
      path: "reasoning.effort",
      hasRequestEffort: true,
    });
  });

  test("ledger fallback rows keep reasoningEffort null", async () => {
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
        actualResponseModel: null,
        endpoint: "/v1beta/models/gemini-2.5-flash:generateContent",
        statusCode: 200,
        inputTokens: 5,
        outputTokens: 5,
        reasoningOutputTokens: 0,
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

    expect(result.logs[0].reasoningEffort).toBeNull();
  });
});
