import { afterEach, describe, expect, it, vi } from "vitest";

function installDbBoundary(db: object): void {
  vi.doMock("@/drizzle/db", () => ({
    db,
    getMessageWriterDb: vi.fn(() => ({ update: vi.fn(), execute: vi.fn() })),
  }));
  vi.doMock("@/lib/config/env.schema", () => ({
    getEnvConfig: vi.fn(() => ({ MESSAGE_REQUEST_WRITE_MODE: "sync" as const })),
    isDevelopment: vi.fn(() => false),
  }));
  vi.doMock("@/lib/redis", () => ({ getRedisClient: vi.fn(() => null) }));
}

function createLimitSelect(responses: readonly (readonly unknown[])[]) {
  let callIndex = 0;
  const events: string[] = [];
  const select = vi.fn((_selection: unknown) => {
    const rows = responses[callIndex] ?? [];
    callIndex += 1;
    const limit = vi.fn(async (_value: number) => {
      events.push("limit");
      return rows;
    });
    const orderBy = vi.fn((..._ordering: unknown[]) => {
      events.push("orderBy");
      return { limit };
    });
    const where = vi.fn((_condition: unknown) => {
      events.push("where");
      return { limit, orderBy };
    });
    const from = vi.fn((_table: unknown) => {
      events.push("from");
      return { where };
    });
    return { from };
  });
  return { events, select };
}

function installLimitBoundaries(
  responses: readonly (readonly unknown[])[],
  messageTableHasData = true
) {
  const { events, select } = createLimitSelect(responses);
  const execute = vi.fn(async (_query: unknown) => [{ has_data: messageTableHasData }]);
  installDbBoundary({ select, execute, update: vi.fn() });
  return { events, execute, select };
}

const CREATED_AT = new Date("2026-07-15T11:00:00.000Z");
const SESSION_ROW = {
  id: 1_101,
  providerId: 31,
  userId: 41,
  key: "session-key",
  model: "claude-sonnet-4",
  originalModel: "claude-sonnet-4",
  durationMs: 1_100,
  costUsd: "0.330000000000000",
  costMultiplier: "1.25",
  sessionId: "session-readback",
  userAgent: "vitest",
  clientIp: "127.0.0.1",
  messagesCount: 3,
  statusCode: 200,
  inputTokens: 90,
  outputTokens: 30,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 4,
  cacheCreation5mInputTokens: 0,
  cacheCreation1hInputTokens: 0,
  cacheTtlApplied: null,
  errorMessage: null,
  providerChain: null,
  blockedBy: null,
  blockedReason: null,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  deletedAt: null,
};
const LEDGER_ROW = {
  requestId: 1_102,
  finalProviderId: 32,
  userId: 42,
  key: "ledger-session-key",
  model: "ledger-model",
  originalModel: "requested-model",
  endpoint: "/v1/responses",
  statusCode: 200,
  costUsd: "0.440000000000000",
  costMultiplier: "1.5",
  inputTokens: 100,
  outputTokens: 40,
  cacheCreationInputTokens: 2,
  cacheReadInputTokens: 3,
  cacheCreation5mInputTokens: 2,
  cacheCreation1hInputTokens: 0,
  cacheTtlApplied: "5m",
  context1mApplied: true,
  swapCacheTtlApplied: false,
  durationMs: 1_200,
  ttfbMs: 200,
  sessionId: "ledger-session-readback",
  createdAt: CREATED_AT,
};

describe("message session readback", () => {
  afterEach(() => {
    vi.doUnmock("@/drizzle/db");
    vi.doUnmock("@/lib/config/env.schema");
    vi.doUnmock("@/lib/redis");
  });

  it("returns the newest direct request for a session", async () => {
    vi.resetModules();
    const boundary = installLimitBoundaries([[SESSION_ROW]]);
    const { findMessageRequestBySessionId } = await import("@/repository/message");

    const result = await findMessageRequestBySessionId("session-readback");

    expect(result).toMatchObject({
      id: 1_101,
      sessionId: "session-readback",
      costMultiplier: 1.25,
    });
    expect(boundary.events).toEqual(["from", "where", "orderBy", "limit"]);
    expect(boundary.execute).not.toHaveBeenCalled();
  });

  it("falls back to the newest ledger request for a session in ledger-only mode", async () => {
    vi.resetModules();
    const boundary = installLimitBoundaries([[], [LEDGER_ROW]], false);
    const { findMessageRequestBySessionId } = await import("@/repository/message");

    const result = await findMessageRequestBySessionId("ledger-session-readback");

    expect(result).toMatchObject({
      id: 1_102,
      providerId: 32,
      sessionId: "ledger-session-readback",
      endpoint: "/v1/responses",
      userAgent: null,
    });
    expect(boundary.select).toHaveBeenCalledTimes(2);
    expect(boundary.execute).toHaveBeenCalledTimes(1);
  });

  it("returns null for a missing session when the message table remains authoritative", async () => {
    vi.resetModules();
    const boundary = installLimitBoundaries([[]], true);
    const { findMessageRequestBySessionId } = await import("@/repository/message");

    const result = await findMessageRequestBySessionId("missing-session");

    expect(result).toBeNull();
    expect(boundary.select).toHaveBeenCalledTimes(1);
  });

  it("returns the first initial-selection provider chain by request sequence", async () => {
    vi.resetModules();
    const providerChain = [
      {
        id: 31,
        name: "origin-provider",
        groupTag: "anthropic",
        reason: "initial_selection" as const,
      },
    ];
    const boundary = installLimitBoundaries([[{ providerChain }]]);
    const { findSessionOriginChain } = await import("@/repository/message");

    const result = await findSessionOriginChain("session-readback");

    expect(result).toEqual(providerChain);
    expect(boundary.events).toEqual(["from", "where", "orderBy", "limit"]);
  });

  it("returns paged requests in repository order with the legacy sequence fallback", async () => {
    vi.resetModules();
    const events: string[] = [];
    let queryIndex = 0;
    const rows = [
      {
        id: 1_104,
        sequence: 4,
        model: "model-four",
        statusCode: 200,
        costUsd: "0.04",
        createdAt: CREATED_AT,
        inputTokens: 4,
        outputTokens: 2,
        errorMessage: null,
      },
      {
        id: 1_103,
        sequence: null,
        model: "legacy-model",
        statusCode: 500,
        costUsd: null,
        createdAt: CREATED_AT,
        inputTokens: null,
        outputTokens: null,
        errorMessage: "failed",
      },
    ];
    const select = vi.fn((_selection: unknown) => {
      queryIndex += 1;
      if (queryIndex === 1) {
        return { from: vi.fn(() => ({ where: vi.fn(async () => [{ count: 2 }]) })) };
      }
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn((limit: number) => ({
                offset: vi.fn(async (offset: number) => {
                  events.push(`limit:${limit}`, `offset:${offset}`);
                  return rows;
                }),
              })),
            })),
          })),
        })),
      };
    });
    installDbBoundary({ select, execute: vi.fn(), update: vi.fn() });
    const { findRequestsBySessionId } = await import("@/repository/message");

    const result = await findRequestsBySessionId("session-readback", {
      limit: 2,
      offset: 1,
      order: "desc",
    });

    expect(result).toEqual({
      requests: [rows[0], { ...rows[1], sequence: 1 }],
      total: 2,
    });
    expect(events).toEqual(["limit:2", "offset:1"]);
  });

  it("returns neighboring request sequences with null-safe public results", async () => {
    vi.resetModules();
    const responses = [[{ sequence: 3 }], []] as const;
    let queryIndex = 0;
    const select = vi.fn((_selection: unknown) => {
      const rows = responses[queryIndex] ?? [];
      queryIndex += 1;
      return { from: vi.fn(() => ({ where: vi.fn(async () => rows) })) };
    });
    installDbBoundary({ select, execute: vi.fn(), update: vi.fn() });
    const { findAdjacentRequestSequences } = await import("@/repository/message");

    const result = await findAdjacentRequestSequences("session-readback", 4);

    expect(result).toEqual({ prevSequence: 3, nextSequence: null });
    expect(select).toHaveBeenCalledTimes(2);
  });
});
