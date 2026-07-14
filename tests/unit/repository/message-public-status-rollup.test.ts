import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDbInsertValues = vi.hoisted(() => vi.fn());
const mockDbInsertReturning = vi.hoisted(() => vi.fn());
const mockDbUpdateSet = vi.hoisted(() => vi.fn());
const mockDbUpdateWhere = vi.hoisted(() => vi.fn());
const mockDbUpdateReturning = vi.hoisted(() => vi.fn());
const mockWriterDbUpdate = vi.hoisted(() => vi.fn());
const mockWriterDbUpdateSet = vi.hoisted(() => vi.fn());
const mockWriterDbUpdateWhere = vi.hoisted(() => vi.fn());
const mockWriterDbUpdateReturning = vi.hoisted(() => vi.fn());
const mockGetMessageWriterDb = vi.hoisted(() => vi.fn());
const mockDbSelectLimit = vi.hoisted(() => vi.fn());
const mockQueuePublicStatusRollupWrite = vi.hoisted(() => vi.fn());
const mockGetConfiguredPublicStatusGroupsForRollupResolution = vi.hoisted(() => vi.fn());
const mockGetEnvConfig = vi.hoisted(() => vi.fn());
const mockEnqueueMessageRequestUpdate = vi.hoisted(() => vi.fn());
const mockEnqueueMessageRequestUpdateDurably = vi.hoisted(() => vi.fn());

vi.mock("@/drizzle/schema", () => ({
  keys: {},
  messageRequest: {
    id: "id",
    providerId: "providerId",
    userId: "userId",
    key: "key",
    model: "model",
    originalModel: "originalModel",
    durationMs: "durationMs",
    costUsd: "costUsd",
    costMultiplier: "costMultiplier",
    sessionId: "sessionId",
    requestSequence: "requestSequence",
    userAgent: "userAgent",
    clientIp: "clientIp",
    endpoint: "endpoint",
    messagesCount: "messagesCount",
    blockedBy: "blockedBy",
    cacheTtlApplied: "cacheTtlApplied",
    cacheCreationInputTokens: "cacheCreationInputTokens",
    cacheCreation5mInputTokens: "cacheCreation5mInputTokens",
    cacheCreation1hInputTokens: "cacheCreation1hInputTokens",
    cacheReadInputTokens: "cacheReadInputTokens",
    specialSettings: "specialSettings",
    statusCode: "statusCode",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
    deletedAt: "deletedAt",
  },
  providers: {},
  usageLedger: {},
  users: {},
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: mockDbInsertValues,
    })),
    update: vi.fn(() => ({
      set: mockDbUpdateSet,
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(async () => []),
          })),
          limit: mockDbSelectLimit,
        })),
      })),
    })),
  },
  getMessageWriterDb: mockGetMessageWriterDb,
}));

vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: mockGetEnvConfig,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
  },
}));

vi.mock("@/lib/public-status/rollup-store", () => ({
  getConfiguredPublicStatusGroupsForRollupResolution:
    mockGetConfiguredPublicStatusGroupsForRollupResolution,
  queuePublicStatusRollupWrite: mockQueuePublicStatusRollupWrite,
}));

vi.mock("@/repository/message-write-buffer", () => ({
  enqueueMessageRequestUpdate: mockEnqueueMessageRequestUpdate,
  enqueueMessageRequestUpdateDurably: mockEnqueueMessageRequestUpdateDurably,
}));

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function sqlToString(value: unknown): string {
  const seen = new Set<unknown>();
  const visit = (node: unknown): string => {
    if (node == null || seen.has(node)) return "";
    if (typeof node === "string") return node;
    if (typeof node !== "object") return String(node);
    seen.add(node);
    if (Array.isArray(node)) return node.map(visit).join(" ");

    const record = node as Record<string, unknown>;
    if (typeof record.name === "string") return record.name;
    if (Array.isArray(record.value)) return record.value.map(visit).join(" ");
    if (record.value != null) return visit(record.value);
    if (record.queryChunks != null) return visit(record.queryChunks);
    return "";
  };
  return visit(value);
}

describe("repository/message public status rollup hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetEnvConfig.mockReturnValue({ MESSAGE_REQUEST_WRITE_MODE: "sync" });
    mockEnqueueMessageRequestUpdateDurably.mockResolvedValue(undefined);
    mockDbInsertValues.mockReturnValue({ returning: mockDbInsertReturning });
    mockDbUpdateSet.mockReturnValue({ where: mockDbUpdateWhere });
    mockDbUpdateWhere.mockReturnValue({ returning: mockDbUpdateReturning });
    mockDbUpdateReturning.mockResolvedValue([]);
    mockWriterDbUpdate.mockReturnValue({ set: mockWriterDbUpdateSet });
    mockWriterDbUpdateSet.mockReturnValue({ where: mockWriterDbUpdateWhere });
    mockWriterDbUpdateWhere.mockReturnValue({ returning: mockWriterDbUpdateReturning });
    mockWriterDbUpdateReturning.mockResolvedValue([]);
    mockGetMessageWriterDb.mockReturnValue({ update: mockWriterDbUpdate });
    mockDbSelectLimit.mockResolvedValue([]);
    mockGetConfiguredPublicStatusGroupsForRollupResolution.mockResolvedValue({
      retryable: false,
      groups: [
        {
          sourceGroupId: 42,
          sourceGroupName: "openai",
          publicGroupSlug: "openai",
          displayName: "OpenAI",
          explanatoryCopy: null,
          sortOrder: 1,
          models: [
            {
              publicModelKey: "gpt-4.1",
              label: "GPT-4.1",
              vendorIconKey: "openai",
              requestTypeBadge: "openaiCompatible",
            },
          ],
        },
      ],
    });
    mockQueuePublicStatusRollupWrite.mockResolvedValue({
      written: true,
      retryable: false,
      incrementCount: 1,
      key: "public-status:v2:rollup:5m:2026-04-21T10%3A00%3A00.000Z",
    });
  });

  it("writes timeout fallback details only while the request is unfinalized", async () => {
    mockWriterDbUpdateReturning.mockResolvedValueOnce([{ id: 606 }]);
    const { updateMessageRequestDetailsIfUnfinalized } = await import("@/repository/message");

    await updateMessageRequestDetailsIfUnfinalized(606, {
      statusCode: 500,
      errorMessage: "Error: stream_finalization_timeout",
    });

    expect(mockGetMessageWriterDb).toHaveBeenCalledTimes(1);
    expect(mockWriterDbUpdateWhere).toHaveBeenCalledTimes(1);
    expect(mockWriterDbUpdateReturning).toHaveBeenCalledWith({ id: "id" });
    expect(mockDbUpdateSet).not.toHaveBeenCalled();
    const whereSql = sqlToString(mockWriterDbUpdateWhere.mock.calls[0]?.[0]).toLowerCase();
    expect(whereSql).toContain("statuscode");
    expect(whereSql).toContain("is null");
  });

  it("keeps timeout fallback conditional in async write mode", async () => {
    mockGetEnvConfig.mockReturnValue({ MESSAGE_REQUEST_WRITE_MODE: "async" });
    mockWriterDbUpdateReturning.mockResolvedValueOnce([{ id: 608 }]);
    const { updateMessageRequestDetailsIfUnfinalized } = await import("@/repository/message");

    await updateMessageRequestDetailsIfUnfinalized(608, {
      statusCode: 500,
      errorMessage: "Error: stream_finalization_timeout",
      providerChain: [{ id: 1, name: "provider-a" }],
    });

    expect(mockEnqueueMessageRequestUpdate).not.toHaveBeenCalled();
    expect(mockGetMessageWriterDb).toHaveBeenCalledTimes(1);
    expect(mockWriterDbUpdateWhere).toHaveBeenCalledTimes(1);
    expect(mockWriterDbUpdateReturning).toHaveBeenCalledWith({ id: "id" });
    expect(mockDbUpdateSet).not.toHaveBeenCalled();
    const whereSql = sqlToString(mockWriterDbUpdateWhere.mock.calls[0]?.[0]).toLowerCase();
    expect(whereSql).toContain("statuscode");
    expect(whereSql).toContain("is null");
  });

  it("does not queue terminal rollup when the timeout fallback loses the terminal CAS", async () => {
    mockWriterDbUpdateReturning.mockResolvedValueOnce([]);
    const { updateMessageRequestDetailsIfUnfinalized } = await import("@/repository/message");

    await updateMessageRequestDetailsIfUnfinalized(607, {
      statusCode: 500,
      errorMessage: "Error: stream_finalization_timeout",
      providerChain: [{ id: 1, name: "provider-a" }],
    });
    await flushMicrotasks();

    expect(mockGetMessageWriterDb).toHaveBeenCalledTimes(1);
    expect(mockQueuePublicStatusRollupWrite).not.toHaveBeenCalled();
  });

  it("async durable details queue public-status rollup only after the batch commit ack", async () => {
    mockGetEnvConfig.mockReturnValue({ MESSAGE_REQUEST_WRITE_MODE: "async" });
    const durableAck = createDeferred<void>();
    mockEnqueueMessageRequestUpdateDurably.mockReturnValueOnce(durableAck.promise);
    mockDbInsertReturning.mockResolvedValueOnce([
      {
        id: 808,
        providerId: 1,
        userId: 2,
        key: "sk-durable",
        model: "gpt-4.1",
        originalModel: "gpt-4.1",
        durationMs: 100,
        costUsd: null,
        costMultiplier: null,
        sessionId: "session-durable",
        requestSequence: 1,
        userAgent: null,
        clientIp: null,
        endpoint: "/v1/messages",
        messagesCount: 1,
        cacheTtlApplied: null,
        cacheCreationInputTokens: null,
        cacheCreation5mInputTokens: null,
        cacheCreation1hInputTokens: null,
        cacheReadInputTokens: null,
        specialSettings: null,
        createdAt: new Date("2026-04-21T10:02:00.000Z"),
        updatedAt: new Date("2026-04-21T10:02:00.000Z"),
        deletedAt: null,
      },
    ]);

    const { createMessageRequest, updateMessageRequestDetailsDurably } = await import(
      "@/repository/message"
    );
    await createMessageRequest({
      provider_id: 1,
      user_id: 2,
      key: "sk-durable",
      model: "gpt-4.1",
      original_model: "gpt-4.1",
    });

    const updatePromise = updateMessageRequestDetailsDurably(808, {
      statusCode: 200,
      outputTokens: 10,
      providerChain: [{ id: 1, name: "provider-a", groupTag: "openai" }],
      model: "gpt-4.1",
    });
    await flushMicrotasks();

    expect(mockQueuePublicStatusRollupWrite).not.toHaveBeenCalled();
    durableAck.resolve();
    await updatePromise;
    await flushMicrotasks();

    expect(mockQueuePublicStatusRollupWrite).toHaveBeenCalledTimes(1);
  });

  it("publishes the public-status rollup when a timed-out durable waiter commits later", async () => {
    mockGetEnvConfig.mockReturnValue({ MESSAGE_REQUEST_WRITE_MODE: "async" });
    let onCommitted: (() => void) | undefined;
    mockEnqueueMessageRequestUpdateDurably.mockImplementationOnce(
      (_id, _details, options: { onCommitted?: () => void } | undefined) => {
        onCommitted = options?.onCommitted;
        return Promise.reject(new Error("durable acknowledgement timed out"));
      }
    );
    mockDbInsertReturning.mockResolvedValueOnce([
      {
        id: 810,
        providerId: 1,
        userId: 2,
        key: "sk-late-commit",
        model: "gpt-4.1",
        originalModel: "gpt-4.1",
        durationMs: null,
        costUsd: null,
        costMultiplier: null,
        sessionId: "session-late-commit",
        requestSequence: 1,
        userAgent: null,
        clientIp: null,
        endpoint: "/v1/messages",
        messagesCount: 1,
        cacheTtlApplied: null,
        cacheCreationInputTokens: null,
        cacheCreation5mInputTokens: null,
        cacheCreation1hInputTokens: null,
        cacheReadInputTokens: null,
        specialSettings: null,
        createdAt: new Date("2026-04-21T10:06:00.000Z"),
        updatedAt: new Date("2026-04-21T10:06:00.000Z"),
        deletedAt: null,
      },
    ]);

    const { createMessageRequest, updateMessageRequestDetailsDurably } = await import(
      "@/repository/message"
    );
    await createMessageRequest({
      provider_id: 1,
      user_id: 2,
      key: "sk-late-commit",
      model: "gpt-4.1",
      original_model: "gpt-4.1",
    });

    await expect(
      updateMessageRequestDetailsDurably(810, {
        durationMs: 1_500,
        statusCode: 200,
        outputTokens: 10,
        providerChain: [{ id: 1, name: "provider-a", groupTag: "openai" }],
        model: "gpt-4.1",
      })
    ).rejects.toThrow("durable acknowledgement timed out");
    await flushMicrotasks();

    expect(onCommitted).toBeTypeOf("function");
    expect(mockQueuePublicStatusRollupWrite).not.toHaveBeenCalled();

    onCommitted?.();
    await flushMicrotasks();

    expect(mockQueuePublicStatusRollupWrite).toHaveBeenCalledTimes(1);
    expect(mockQueuePublicStatusRollupWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ durationMs: 1_500 }),
      })
    );
  });

  it("sync durable details remain direct and queue rollup after the DB write", async () => {
    mockGetEnvConfig.mockReturnValue({ MESSAGE_REQUEST_WRITE_MODE: "sync" });
    mockDbSelectLimit.mockResolvedValueOnce([
      {
        createdAt: new Date("2026-04-21T10:04:00.000Z"),
        model: "gpt-4.1",
        originalModel: "gpt-4.1",
        durationMs: 100,
      },
    ]);
    const { updateMessageRequestDetailsDurably } = await import("@/repository/message");

    await updateMessageRequestDetailsDurably(809, {
      statusCode: 200,
      providerChain: [{ id: 1, name: "provider-a", groupTag: "openai" }],
    });
    await flushMicrotasks();

    expect(mockDbUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockGetMessageWriterDb).not.toHaveBeenCalled();
    expect(mockEnqueueMessageRequestUpdateDurably).not.toHaveBeenCalled();
    expect(mockQueuePublicStatusRollupWrite).toHaveBeenCalledTimes(1);
  });

  it("queues one rollup for duplicate terminal updates without double counting", async () => {
    mockDbInsertReturning.mockResolvedValue([
      {
        id: 101,
        providerId: 1,
        userId: 2,
        key: "sk-1",
        model: "gpt-4.1",
        originalModel: "gpt-4.1",
        durationMs: null,
        costUsd: null,
        costMultiplier: null,
        sessionId: "session-1",
        requestSequence: 1,
        userAgent: null,
        clientIp: null,
        endpoint: "/v1/messages",
        messagesCount: 1,
        cacheTtlApplied: null,
        cacheCreationInputTokens: null,
        cacheCreation5mInputTokens: null,
        cacheCreation1hInputTokens: null,
        cacheReadInputTokens: null,
        specialSettings: null,
        createdAt: new Date("2026-04-21T10:02:00.000Z"),
        updatedAt: new Date("2026-04-21T10:02:00.000Z"),
        deletedAt: null,
      },
    ]);

    const { createMessageRequest, updateMessageRequestDetails, updateMessageRequestDuration } =
      await import("@/repository/message");

    await createMessageRequest({
      provider_id: 1,
      user_id: 2,
      key: "sk-1",
      model: "gpt-4.1",
      original_model: "gpt-4.1",
    });
    await updateMessageRequestDuration(101, 1200);

    const finalDetails = {
      statusCode: 200,
      ttfbMs: 200,
      outputTokens: 50,
      providerChain: [
        {
          id: 1,
          name: "provider-a",
          groupTag: "openai",
          reason: "request_success" as const,
          statusCode: 200,
        },
      ],
      model: "gpt-4.1",
    };

    await Promise.all([
      updateMessageRequestDetails(101, finalDetails),
      updateMessageRequestDetails(101, finalDetails),
    ]);
    await flushMicrotasks();

    expect(mockQueuePublicStatusRollupWrite).toHaveBeenCalledTimes(1);
    expect(mockQueuePublicStatusRollupWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          createdAt: new Date("2026-04-21T10:02:00.000Z"),
          durationMs: 1200,
          originalModel: "gpt-4.1",
          model: "gpt-4.1",
          outputTokens: 50,
          ttfbMs: 200,
        }),
      })
    );
  });

  it("falls back to the persisted request seed when the in-memory seed is missing", async () => {
    mockDbSelectLimit.mockResolvedValueOnce([
      {
        createdAt: new Date("2026-04-21T10:03:00.000Z"),
        model: "gpt-4.1",
        originalModel: "gpt-4.1",
        durationMs: 1500,
      },
    ]);

    const { updateMessageRequestDetails } = await import("@/repository/message");

    await updateMessageRequestDetails(202, {
      statusCode: 200,
      ttfbMs: 250,
      outputTokens: 75,
      providerChain: [
        {
          id: 1,
          name: "provider-a",
          groupTag: "openai",
          reason: "request_success",
          statusCode: 200,
        },
      ],
      model: "gpt-4.1",
    });
    await flushMicrotasks();

    expect(mockQueuePublicStatusRollupWrite).toHaveBeenCalledTimes(1);
    expect(mockQueuePublicStatusRollupWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          createdAt: new Date("2026-04-21T10:03:00.000Z"),
          durationMs: 1500,
          originalModel: "gpt-4.1",
          model: "gpt-4.1",
          outputTokens: 75,
          ttfbMs: 250,
        }),
      })
    );
  });

  it("keeps the seed retryable when the first rollup write fails", async () => {
    mockDbInsertReturning.mockResolvedValue([
      {
        id: 303,
        providerId: 1,
        userId: 2,
        key: "sk-1",
        model: "gpt-4.1",
        originalModel: "gpt-4.1",
        durationMs: null,
        costUsd: null,
        costMultiplier: null,
        sessionId: "session-1",
        requestSequence: 1,
        userAgent: null,
        clientIp: null,
        endpoint: "/v1/messages",
        messagesCount: 1,
        cacheTtlApplied: null,
        cacheCreationInputTokens: null,
        cacheCreation5mInputTokens: null,
        cacheCreation1hInputTokens: null,
        cacheReadInputTokens: null,
        specialSettings: null,
        createdAt: new Date("2026-04-21T10:04:00.000Z"),
        updatedAt: new Date("2026-04-21T10:04:00.000Z"),
        deletedAt: null,
      },
    ]);
    mockQueuePublicStatusRollupWrite
      .mockResolvedValueOnce({
        written: false,
        retryable: true,
        reason: "redis-unavailable",
        incrementCount: 1,
        key: "rollup-key",
      })
      .mockResolvedValueOnce({
        written: true,
        retryable: false,
        incrementCount: 1,
        key: "rollup-key",
      });

    const { createMessageRequest, updateMessageRequestDetails, updateMessageRequestDuration } =
      await import("@/repository/message");

    await createMessageRequest({
      provider_id: 1,
      user_id: 2,
      key: "sk-1",
      model: "gpt-4.1",
      original_model: "gpt-4.1",
    });
    await updateMessageRequestDuration(303, 1800);

    const finalDetails = {
      statusCode: 200,
      ttfbMs: 300,
      outputTokens: 90,
      providerChain: [
        {
          id: 1,
          name: "provider-a",
          groupTag: "openai",
          reason: "request_success" as const,
          statusCode: 200,
        },
      ],
      model: "gpt-4.1",
    };

    await updateMessageRequestDetails(303, finalDetails);
    await flushMicrotasks();
    await updateMessageRequestDetails(303, finalDetails);
    await flushMicrotasks();

    expect(mockQueuePublicStatusRollupWrite).toHaveBeenCalledTimes(2);
    expect(mockQueuePublicStatusRollupWrite).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        event: expect.objectContaining({
          createdAt: new Date("2026-04-21T10:04:00.000Z"),
          durationMs: 1800,
          outputTokens: 90,
          ttfbMs: 300,
        }),
      })
    );
  });

  it("consumes the seed when the request is not part of the public status projection", async () => {
    mockDbInsertReturning.mockResolvedValue([
      {
        id: 404,
        providerId: 1,
        userId: 2,
        key: "sk-1",
        model: "private-model",
        originalModel: "private-model",
        durationMs: null,
        costUsd: null,
        costMultiplier: null,
        sessionId: "session-1",
        requestSequence: 1,
        userAgent: null,
        clientIp: null,
        endpoint: "/v1/messages",
        messagesCount: 1,
        cacheTtlApplied: null,
        cacheCreationInputTokens: null,
        cacheCreation5mInputTokens: null,
        cacheCreation1hInputTokens: null,
        cacheReadInputTokens: null,
        specialSettings: null,
        createdAt: new Date("2026-04-21T10:05:00.000Z"),
        updatedAt: new Date("2026-04-21T10:05:00.000Z"),
        deletedAt: null,
      },
    ]);
    mockQueuePublicStatusRollupWrite.mockResolvedValue({
      written: false,
      retryable: false,
      reason: "ignored",
      incrementCount: 0,
      key: null,
    });

    const { createMessageRequest, updateMessageRequestDetails } = await import(
      "@/repository/message"
    );

    await createMessageRequest({
      provider_id: 1,
      user_id: 2,
      key: "sk-1",
      model: "private-model",
      original_model: "private-model",
    });

    const finalDetails = {
      statusCode: 200,
      ttfbMs: 300,
      outputTokens: 90,
      providerChain: [
        {
          id: 1,
          name: "provider-a",
          groupTag: "openai",
          reason: "request_success" as const,
          statusCode: 200,
        },
      ],
      model: "private-model",
    };

    await updateMessageRequestDetails(404, finalDetails);
    await flushMicrotasks();
    await updateMessageRequestDetails(404, finalDetails);
    await flushMicrotasks();

    expect(mockQueuePublicStatusRollupWrite).toHaveBeenCalledTimes(1);
  });

  it("keeps the seed retryable when public status config is temporarily unavailable", async () => {
    mockDbInsertReturning.mockResolvedValue([
      {
        id: 505,
        providerId: 1,
        userId: 2,
        key: "sk-1",
        model: "gpt-4.1",
        originalModel: "gpt-4.1",
        durationMs: null,
        costUsd: null,
        costMultiplier: null,
        sessionId: "session-1",
        requestSequence: 1,
        userAgent: null,
        clientIp: null,
        endpoint: "/v1/messages",
        messagesCount: 1,
        cacheTtlApplied: null,
        cacheCreationInputTokens: null,
        cacheCreation5mInputTokens: null,
        cacheCreation1hInputTokens: null,
        cacheReadInputTokens: null,
        specialSettings: null,
        createdAt: new Date("2026-04-21T10:06:00.000Z"),
        updatedAt: new Date("2026-04-21T10:06:00.000Z"),
        deletedAt: null,
      },
    ]);
    mockGetConfiguredPublicStatusGroupsForRollupResolution
      .mockResolvedValueOnce({ groups: [], retryable: true })
      .mockResolvedValueOnce({
        retryable: false,
        groups: [
          {
            sourceGroupId: 42,
            sourceGroupName: "openai",
            publicGroupSlug: "openai",
            displayName: "OpenAI",
            explanatoryCopy: null,
            sortOrder: 1,
            models: [
              {
                publicModelKey: "gpt-4.1",
                label: "GPT-4.1",
                vendorIconKey: "openai",
                requestTypeBadge: "openaiCompatible",
              },
            ],
          },
        ],
      });

    const { createMessageRequest, updateMessageRequestDetails, updateMessageRequestDuration } =
      await import("@/repository/message");

    await createMessageRequest({
      provider_id: 1,
      user_id: 2,
      key: "sk-1",
      model: "gpt-4.1",
      original_model: "gpt-4.1",
    });
    await updateMessageRequestDuration(505, 1900);

    const finalDetails = {
      statusCode: 200,
      ttfbMs: 320,
      outputTokens: 95,
      providerChain: [
        {
          id: 1,
          name: "provider-a",
          groupTag: "openai",
          reason: "request_success" as const,
          statusCode: 200,
        },
      ],
      model: "gpt-4.1",
    };

    await updateMessageRequestDetails(505, finalDetails);
    await flushMicrotasks();
    await updateMessageRequestDetails(505, finalDetails);
    await flushMicrotasks();

    expect(mockQueuePublicStatusRollupWrite).toHaveBeenCalledTimes(1);
    expect(mockQueuePublicStatusRollupWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          createdAt: new Date("2026-04-21T10:06:00.000Z"),
          durationMs: 1900,
          outputTokens: 95,
          ttfbMs: 320,
        }),
      })
    );
  });
});
