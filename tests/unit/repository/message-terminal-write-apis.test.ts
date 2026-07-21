import type { StoredCostBreakdown } from "@/types/cost-breakdown";
import type { CreateMessageRequestData } from "@/types/message";
import { afterEach, describe, expect, it, vi } from "vitest";

function installSyncBoundaries(insertedRows: readonly Record<string, unknown>[] = []) {
  const insertReturning = vi.fn(async (_selection: unknown) => insertedRows);
  const insertValues = vi.fn((_values: Record<string, unknown>) => ({
    returning: insertReturning,
  }));
  const insert = vi.fn((_table: unknown) => ({ values: insertValues }));
  const updateWhere = vi.fn(async (_condition: unknown) => []);
  const updateSet = vi.fn((_values: Record<string, unknown>) => ({ where: updateWhere }));
  const update = vi.fn((_table: unknown) => ({ set: updateSet }));
  const writerUpdate = vi.fn((_table: unknown) => ({ set: updateSet }));

  vi.doMock("@/drizzle/db", () => ({
    db: { insert, update, select: vi.fn(), execute: vi.fn() },
    getMessageWriterDb: vi.fn(() => ({ update: writerUpdate, execute: vi.fn() })),
  }));
  vi.doMock("@/lib/config/env.schema", () => ({
    getEnvConfig: vi.fn(() => ({ MESSAGE_REQUEST_WRITE_MODE: "sync" as const })),
    isDevelopment: vi.fn(() => false),
  }));

  return { insertValues, update, updateSet, updateWhere };
}

function installAsyncRoutingTraceBoundaries() {
  const controlUpdate = vi.fn();
  const getMessageWriterDb = vi.fn();
  const enqueueMessageRequestUpdate = vi.fn();
  const enqueueMessageRequestPostTerminalRoutingTraceDurably = vi.fn(async () => true);
  const loggerWarn = vi.fn();

  vi.doMock("@/drizzle/db", () => ({
    db: {
      insert: vi.fn(),
      update: controlUpdate,
      select: vi.fn(),
      execute: vi.fn(),
    },
    getMessageWriterDb,
  }));
  vi.doMock("@/lib/config/env.schema", () => ({
    getEnvConfig: vi.fn(() => ({
      MESSAGE_REQUEST_WRITE_MODE: "async" as const,
    })),
    isDevelopment: vi.fn(() => false),
  }));
  vi.doMock("@/repository/message-write-buffer", () => ({
    enqueueMessageRequestPostTerminalRoutingTraceDurably,
    enqueueMessageRequestUpdate,
    enqueueMessageRequestUpdateDurably: vi.fn(),
  }));
  vi.doMock("@/lib/logger", () => ({
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: loggerWarn,
    },
  }));

  return {
    controlUpdate,
    enqueueMessageRequestPostTerminalRoutingTraceDurably,
    enqueueMessageRequestUpdate,
    getMessageWriterDb,
    loggerWarn,
  };
}

const BREAKDOWN = {
  input: "0.01",
  output: "0.02",
  cache_creation: "0",
  cache_read: "0",
  base_total: "0.03",
  provider_multiplier: 1.5,
  group_multiplier: 2,
  total: "0.09",
} satisfies StoredCostBreakdown;

describe("message terminal write APIs", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("@/drizzle/db");
    vi.doUnmock("@/lib/config/env.schema");
    vi.doUnmock("@/lib/logger");
    vi.doUnmock("@/repository/message-write-buffer");
  });

  it("creates a request through the repository and returns its public row", async () => {
    vi.resetModules();
    const createdAt = new Date("2026-07-15T08:00:00.000Z");
    const row = {
      id: 701,
      providerId: 11,
      userId: 22,
      key: "key-create",
      model: "claude-sonnet-4",
      originalModel: "claude-sonnet-4",
      durationMs: 120,
      costUsd: "0.125000000000000",
      costMultiplier: "1.5",
      sessionId: "session-create",
      requestSequence: 3,
      userAgent: "vitest",
      clientIp: "127.0.0.1",
      endpoint: "/v1/messages",
      messagesCount: 2,
      cacheTtlApplied: null,
      cacheCreationInputTokens: 4,
      cacheCreation5mInputTokens: 4,
      cacheCreation1hInputTokens: 0,
      cacheReadInputTokens: 5,
      specialSettings: null,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    };
    const { insertValues } = installSyncBoundaries([row]);
    const data = {
      provider_id: 11,
      user_id: 22,
      key: "key-create",
      model: "claude-sonnet-4",
      original_model: "claude-sonnet-4",
      duration_ms: 120,
      cost_usd: "0.125",
      cost_multiplier: 1.5,
      group_cost_multiplier: 2,
      session_id: "session-create",
      request_sequence: 3,
      user_agent: "vitest",
      client_ip: "127.0.0.1",
      endpoint: "/v1/messages",
      messages_count: 2,
      cache_creation_input_tokens: 4,
      cache_creation_5m_input_tokens: 4,
      cache_creation_1h_input_tokens: 0,
      cache_read_input_tokens: 5,
    } satisfies CreateMessageRequestData;
    const { createMessageRequest } = await import("@/repository/message");

    const result = await createMessageRequest(data);

    expect(result).toMatchObject({
      id: 701,
      costUsd: "0.125000000000000",
      costMultiplier: 1.5,
      sessionId: "session-create",
      createdAt,
    });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        costUsd: "0.125000000000000",
        costMultiplier: "1.5",
        groupCostMultiplier: "2",
        requestSequence: 3,
      })
    );
  });

  it("writes duration through the synchronous database boundary", async () => {
    vi.resetModules();
    const { updateSet, updateWhere } = installSyncBoundaries();
    const { updateMessageRequestDuration } = await import("@/repository/message");

    const result = await updateMessageRequestDuration(702, 345);

    expect(result).toBeUndefined();
    expect(updateSet).toHaveBeenCalledWith({ durationMs: 345, updatedAt: expect.any(Date) });
    expect(updateWhere).toHaveBeenCalledTimes(1);
  });

  it("formats and writes the request cost", async () => {
    vi.resetModules();
    const { updateSet } = installSyncBoundaries();
    const { updateMessageRequestCost } = await import("@/repository/message");

    await updateMessageRequestCost(703, "0.123456789");

    expect(updateSet).toHaveBeenCalledWith({
      costUsd: "0.123456789000000",
      updatedAt: expect.any(Date),
    });
  });

  it("writes a formatted cost with its billing breakdown", async () => {
    vi.resetModules();
    const { updateSet } = installSyncBoundaries();
    const { updateMessageRequestCostWithBreakdown } = await import("@/repository/message");

    await updateMessageRequestCostWithBreakdown(704, "0.09", BREAKDOWN);

    expect(updateSet).toHaveBeenCalledWith({
      costUsd: "0.090000000000000",
      costBreakdown: BREAKDOWN,
      updatedAt: expect.any(Date),
    });
  });

  it("writes the supplied terminal detail fields without inventing omitted fields", async () => {
    vi.resetModules();
    const { updateSet } = installSyncBoundaries();
    const { updateMessageRequestDetails } = await import("@/repository/message");
    const details = {
      inputTokens: 101,
      outputTokens: 23,
      ttfbMs: null,
      cacheCreationInputTokens: 7,
      cacheReadInputTokens: 8,
      cacheCreation5mInputTokens: 3,
      cacheCreation1hInputTokens: 4,
      cacheTtlApplied: "5m" as const,
      errorMessage: "upstream closed",
      model: "redirected-model",
      actualResponseModel: null,
      providerId: 91,
      context1mApplied: true,
      swapCacheTtlApplied: false,
    };

    await updateMessageRequestDetails(705, details);

    expect(updateSet).toHaveBeenCalledWith({ ...details, updatedAt: expect.any(Date) });
    expect(updateSet.mock.calls[0]?.[0]).not.toHaveProperty("statusCode");
  });

  it("patches a finalized routing trace without touching terminal or billing fields", async () => {
    vi.resetModules();
    const { updateSet, updateWhere } = installSyncBoundaries();
    const { updateMessageRequestRoutingTrace } = await import("@/repository/message");
    const routingTrace = {
      version: 1 as const,
      mode: "legacy_serial" as const,
      startedAt: 1_000,
      updatedAt: 1_050,
      discoveryEnabled: true,
      eligible: false,
      bypassReason: "non_streaming",
      events: [],
    };

    await updateMessageRequestRoutingTrace(706, routingTrace);

    expect(updateSet).toHaveBeenCalledWith({
      routingTrace,
      updatedAt: expect.any(Date),
    });
    expect(updateSet.mock.calls[0]?.[0]).not.toHaveProperty("statusCode");
    expect(updateSet.mock.calls[0]?.[0]).not.toHaveProperty("costUsd");
    expect(updateWhere).toHaveBeenCalledTimes(1);
  });

  it("patches an async finalized routing trace through acknowledged post-terminal metadata", async () => {
    vi.resetModules();
    const boundaries = installAsyncRoutingTraceBoundaries();
    const { updateMessageRequestRoutingTrace } = await import("@/repository/message");
    const routingTrace = {
      version: 1 as const,
      mode: "discovery" as const,
      startedAt: 1_000,
      updatedAt: 1_100,
      discoveryEnabled: true,
      eligible: true,
      events: [
        {
          type: "binding_finalized" as const,
          at: 1_100,
          elapsedMs: 100,
          bindingAction: "create" as const,
          outcome: "updated",
        },
      ],
    };

    await updateMessageRequestRoutingTrace(707, routingTrace);

    expect(boundaries.enqueueMessageRequestUpdate).not.toHaveBeenCalled();
    expect(boundaries.controlUpdate).not.toHaveBeenCalled();
    expect(boundaries.getMessageWriterDb).not.toHaveBeenCalled();
    expect(boundaries.enqueueMessageRequestPostTerminalRoutingTraceDurably).toHaveBeenCalledWith(
      707,
      routingTrace
    );
    expect(boundaries.loggerWarn).not.toHaveBeenCalled();
  });

  it("keeps rejected async routing trace persistence best-effort and logs once", async () => {
    vi.resetModules();
    const boundaries = installAsyncRoutingTraceBoundaries();
    boundaries.enqueueMessageRequestPostTerminalRoutingTraceDurably.mockRejectedValue(
      new Error("durable writer unavailable")
    );
    const { updateMessageRequestRoutingTrace } = await import("@/repository/message");
    const routingTrace = {
      version: 1 as const,
      mode: "legacy_serial" as const,
      startedAt: 3_000,
      updatedAt: 3_100,
      discoveryEnabled: false,
      eligible: false,
      events: [],
    };

    await expect(updateMessageRequestRoutingTrace(709, routingTrace)).resolves.toBeUndefined();

    expect(boundaries.enqueueMessageRequestPostTerminalRoutingTraceDurably).toHaveBeenCalledOnce();
    expect(boundaries.loggerWarn).toHaveBeenCalledOnce();
    expect(boundaries.loggerWarn).toHaveBeenCalledWith(
      "[MessageRequest] Failed to patch finalized routing trace",
      {
        requestId: 709,
        error: "durable writer unavailable",
      }
    );
  });

  it("logs and skips an invalid routing trace without persisting raw trace data", async () => {
    vi.resetModules();
    const boundaries = installAsyncRoutingTraceBoundaries();
    const { updateMessageRequestRoutingTrace } = await import("@/repository/message");

    await updateMessageRequestRoutingTrace(710, { version: 2 } as unknown as Parameters<
      typeof updateMessageRequestRoutingTrace
    >[1]);

    expect(boundaries.enqueueMessageRequestPostTerminalRoutingTraceDurably).not.toHaveBeenCalled();
    expect(boundaries.controlUpdate).not.toHaveBeenCalled();
    expect(boundaries.loggerWarn).toHaveBeenCalledWith(
      "[MessageRequest] Skipped patching invalid routing trace",
      { requestId: 710 }
    );
  });
});
