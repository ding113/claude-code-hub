import { afterEach, describe, expect, it, vi } from "vitest";

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

function installReadBoundaries(
  responses: readonly (readonly unknown[])[],
  messageTableHasData = true
) {
  const { events, select } = createLimitSelect(responses);
  const execute = vi.fn(async (_query: unknown) => [{ has_data: messageTableHasData }]);
  vi.doMock("@/drizzle/db", () => ({
    db: { select, execute, update: vi.fn() },
    getMessageWriterDb: vi.fn(() => ({ update: vi.fn(), execute: vi.fn() })),
  }));
  vi.doMock("@/lib/config/env.schema", () => ({
    getEnvConfig: vi.fn(() => ({ MESSAGE_REQUEST_WRITE_MODE: "sync" as const })),
    isDevelopment: vi.fn(() => false),
  }));
  vi.doMock("@/lib/redis", () => ({ getRedisClient: vi.fn(() => null) }));
  return { events, execute, select };
}

const CREATED_AT = new Date("2026-07-15T10:00:00.000Z");
const LATEST_ROW = {
  id: 1_001,
  providerId: 7,
  userId: 9,
  key: "public-key",
  durationMs: 800,
  costUsd: "0.250000000000000",
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  deletedAt: null,
};
const MESSAGE_ROW = {
  ...LATEST_ROW,
  model: "gpt-4.1",
  originalModel: "gpt-4.1-mini",
  ttfbMs: 120,
  costMultiplier: "1.5",
  sessionId: "public-session",
  userAgent: "vitest",
  clientIp: "127.0.0.1",
  endpoint: "/v1/responses",
  messagesCount: 2,
  statusCode: 200,
  inputTokens: 40,
  outputTokens: 12,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 2,
  cacheCreation5mInputTokens: 0,
  cacheCreation1hInputTokens: 0,
  cacheTtlApplied: null,
  errorMessage: null,
  providerChain: null,
  blockedBy: null,
  blockedReason: null,
  context1mApplied: true,
  swapCacheTtlApplied: false,
  specialSettings: null,
};
const LEDGER_ROW = {
  requestId: 1_002,
  finalProviderId: 17,
  userId: 19,
  key: "ledger-key",
  model: "ledger-model",
  originalModel: "requested-model",
  endpoint: "/v1/messages",
  statusCode: 201,
  costUsd: "0.750000000000000",
  costMultiplier: "2",
  inputTokens: 70,
  outputTokens: 20,
  cacheCreationInputTokens: 3,
  cacheReadInputTokens: 4,
  cacheCreation5mInputTokens: 1,
  cacheCreation1hInputTokens: 2,
  cacheTtlApplied: "1h",
  context1mApplied: false,
  swapCacheTtlApplied: true,
  durationMs: 1_500,
  ttfbMs: 250,
  sessionId: "ledger-session",
  createdAt: CREATED_AT,
};

describe("message public readback", () => {
  afterEach(() => {
    vi.doUnmock("@/drizzle/db");
    vi.doUnmock("@/lib/config/env.schema");
    vi.doUnmock("@/lib/redis");
  });

  it("returns the latest non-deleted request for a key in descending time order", async () => {
    vi.resetModules();
    const boundary = installReadBoundaries([[LATEST_ROW]]);
    const { findLatestMessageRequestByKey } = await import("@/repository/message");

    const result = await findLatestMessageRequestByKey("public-key");

    expect(result).toMatchObject({ id: 1_001, key: "public-key", costUsd: "0.250000000000000" });
    expect(boundary.events).toEqual(["from", "where", "orderBy", "limit"]);
  });

  it("returns a complete request by its public id without consulting the ledger", async () => {
    vi.resetModules();
    const boundary = installReadBoundaries([[MESSAGE_ROW]]);
    const { findMessageRequestById } = await import("@/repository/message");

    const result = await findMessageRequestById(1_001);

    expect(result).toMatchObject({
      id: 1_001,
      model: "gpt-4.1",
      costMultiplier: 1.5,
      context1mApplied: true,
    });
    expect(boundary.execute).not.toHaveBeenCalled();
  });

  it("falls back to the billing ledger when the message table is empty", async () => {
    vi.resetModules();
    const boundary = installReadBoundaries([[], [LEDGER_ROW]], false);
    const { findMessageRequestById } = await import("@/repository/message");

    const result = await findMessageRequestById(1_002);

    expect(result).toMatchObject({
      id: 1_002,
      providerId: 17,
      model: "ledger-model",
      costMultiplier: 2,
      sessionId: "ledger-session",
      userAgent: null,
    });
    expect(boundary.select).toHaveBeenCalledTimes(2);
    expect(boundary.execute).toHaveBeenCalledTimes(1);
  });

  it("returns null when neither direct data nor ledger-only mode applies", async () => {
    vi.resetModules();
    const boundary = installReadBoundaries([[]], true);
    const { findMessageRequestById } = await import("@/repository/message");

    const result = await findMessageRequestById(1_099);

    expect(result).toBeNull();
    expect(boundary.select).toHaveBeenCalledTimes(1);
  });

  it("returns the public audit projection for a session sequence", async () => {
    vi.resetModules();
    const auditRow = {
      statusCode: 403,
      blockedBy: "sensitive_words",
      blockedReason: "policy",
      cacheTtlApplied: "5m",
      context1mApplied: false,
      swapCacheTtlApplied: true,
      specialSettings: [
        {
          type: "guard_intercept",
          scope: "guard",
          hit: true,
          guard: "sensitive_words",
          action: "block_request",
          statusCode: 403,
          reason: "policy",
        },
      ],
    };
    const boundary = installReadBoundaries([[auditRow]]);
    const { findMessageRequestAuditBySessionIdAndSequence } = await import("@/repository/message");

    const result = await findMessageRequestAuditBySessionIdAndSequence("audit-session", 4);

    expect(result).toEqual(auditRow);
    expect(boundary.events).toEqual(["from", "where", "limit"]);
  });
});
