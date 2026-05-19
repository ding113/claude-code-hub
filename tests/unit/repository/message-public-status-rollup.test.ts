import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDbInsertValues = vi.hoisted(() => vi.fn());
const mockDbInsertReturning = vi.hoisted(() => vi.fn());
const mockDbUpdateSet = vi.hoisted(() => vi.fn());
const mockDbUpdateWhere = vi.hoisted(() => vi.fn());
const mockQueuePublicStatusRollupWrite = vi.hoisted(() => vi.fn());
const mockGetConfiguredPublicStatusGroupsForRollup = vi.hoisted(() => vi.fn());
const mockGetEnvConfig = vi.hoisted(() => vi.fn());

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
    cacheTtlApplied: "cacheTtlApplied",
    cacheCreationInputTokens: "cacheCreationInputTokens",
    cacheCreation5mInputTokens: "cacheCreation5mInputTokens",
    cacheCreation1hInputTokens: "cacheCreation1hInputTokens",
    cacheReadInputTokens: "cacheReadInputTokens",
    specialSettings: "specialSettings",
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
          limit: vi.fn(async () => []),
        })),
      })),
    })),
  },
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
  getConfiguredPublicStatusGroupsForRollup: mockGetConfiguredPublicStatusGroupsForRollup,
  queuePublicStatusRollupWrite: mockQueuePublicStatusRollupWrite,
}));

vi.mock("@/repository/message-write-buffer", () => ({
  enqueueMessageRequestUpdate: vi.fn(),
}));

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("repository/message public status rollup hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetEnvConfig.mockReturnValue({ MESSAGE_REQUEST_WRITE_MODE: "sync" });
    mockDbInsertValues.mockReturnValue({ returning: mockDbInsertReturning });
    mockDbUpdateSet.mockReturnValue({ where: mockDbUpdateWhere });
    mockDbUpdateWhere.mockResolvedValue(undefined);
    mockGetConfiguredPublicStatusGroupsForRollup.mockResolvedValue([
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
    ]);
    mockQueuePublicStatusRollupWrite.mockResolvedValue({
      written: true,
      incrementCount: 1,
      key: "public-status:v2:rollup:5m:2026-04-21T10%3A00%3A00.000Z",
    });
  });

  it("consumes the in-memory request seed before async rollup write to avoid double counting", async () => {
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
});
