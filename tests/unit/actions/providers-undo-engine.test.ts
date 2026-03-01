// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDER_BATCH_PATCH_ERROR_CODES } from "@/lib/provider-batch-patch-error-codes";
import { buildRedisMock, createRedisStore } from "./redis-mock-utils";

const getSessionMock = vi.fn();
const findAllProvidersFreshMock = vi.fn();
const updateProvidersBatchMock = vi.fn();
const publishCacheInvalidationMock = vi.fn();
const { store: redisStore, mocks: redisMocks } = createRedisStore();

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/repository/provider", () => ({
  findAllProvidersFresh: findAllProvidersFreshMock,
  updateProvidersBatch: updateProvidersBatchMock,
  deleteProvidersBatch: vi.fn(),
}));

vi.mock("@/lib/cache/provider-cache", () => ({
  publishProviderCacheInvalidation: publishCacheInvalidationMock,
}));

vi.mock("@/lib/redis/client", () => buildRedisMock(redisMocks));

vi.mock("@/lib/circuit-breaker", () => ({
  clearProviderState: vi.fn(),
  clearConfigCache: vi.fn(),
  resetCircuit: vi.fn(),
  getAllHealthStatusAsync: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function makeProvider(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Provider-${id}`,
    url: "https://api.example.com/v1",
    key: "sk-test",
    providerVendorId: null,
    isEnabled: true,
    weight: 100,
    priority: 1,
    groupPriorities: null,
    costMultiplier: 1.0,
    groupTag: null,
    providerType: "claude",
    preserveClientIp: false,
    modelRedirects: null,
    allowedModels: null,
    mcpPassthroughType: "none",
    mcpPassthroughUrl: null,
    limit5hUsd: null,
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    totalCostResetAt: null,
    limitConcurrentSessions: null,
    maxRetryAttempts: null,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerOpenDuration: 1800000,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    firstByteTimeoutStreamingMs: 30000,
    streamingIdleTimeoutMs: 10000,
    requestTimeoutNonStreamingMs: 600000,
    websiteUrl: null,
    faviconUrl: null,
    cacheTtlPreference: null,
    swapCacheTtlBilling: false,
    context1mPreference: null,
    codexReasoningEffortPreference: null,
    codexReasoningSummaryPreference: null,
    codexTextVerbosityPreference: null,
    codexParallelToolCallsPreference: null,
    anthropicMaxTokensPreference: null,
    anthropicThinkingBudgetPreference: null,
    anthropicAdaptiveThinking: null,
    geminiGoogleSearchPreference: null,
    tpm: null,
    rpm: null,
    rpd: null,
    cc: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    deletedAt: null,
    ...overrides,
  };
}

describe("Undo Provider Batch Patch Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    redisStore.clear();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findAllProvidersFreshMock.mockResolvedValue([]);
    updateProvidersBatchMock.mockResolvedValue(0);
    publishCacheInvalidationMock.mockResolvedValue(undefined);
  });

  /** Helper: preview -> apply -> return undo token + operationId + undoProviderPatch */
  async function setupPreviewApplyAndGetUndo(
    providers: ReturnType<typeof makeProvider>[],
    providerIds: number[],
    patch: Record<string, unknown>,
    applyOverrides: Record<string, unknown> = {}
  ) {
    findAllProvidersFreshMock.mockResolvedValue(providers);
    updateProvidersBatchMock.mockResolvedValue(providers.length);

    const { previewProviderBatchPatch, applyProviderBatchPatch, undoProviderPatch } = await import(
      "@/actions/providers"
    );

    const preview = await previewProviderBatchPatch({ providerIds, patch });
    if (!preview.ok) throw new Error(`Preview failed: ${preview.error}`);

    const apply = await applyProviderBatchPatch({
      previewToken: preview.data.previewToken,
      previewRevision: preview.data.previewRevision,
      providerIds,
      patch,
      ...applyOverrides,
    });
    if (!apply.ok) throw new Error(`Apply failed: ${apply.error}`);

    // Reset mocks after apply so undo assertions are clean
    updateProvidersBatchMock.mockClear();
    publishCacheInvalidationMock.mockClear();

    return {
      undoToken: apply.data.undoToken,
      operationId: apply.data.operationId,
      undoProviderPatch,
    };
  }

  it("should revert each provider's fields to preimage values", async () => {
    const providers = [
      makeProvider(1, { groupTag: "alpha" }),
      makeProvider(2, { groupTag: "beta" }),
    ];

    const { undoToken, operationId, undoProviderPatch } = await setupPreviewApplyAndGetUndo(
      providers,
      [1, 2],
      { group_tag: { set: "gamma" } }
    );

    updateProvidersBatchMock.mockResolvedValue(1);

    const result = await undoProviderPatch({ undoToken, operationId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Provider 1 had groupTag "alpha", provider 2 had "beta" -- different preimages
    expect(updateProvidersBatchMock).toHaveBeenCalledWith(
      [1],
      expect.objectContaining({ groupTag: "alpha" })
    );
    expect(updateProvidersBatchMock).toHaveBeenCalledWith(
      [2],
      expect.objectContaining({ groupTag: "beta" })
    );
  });

  it("should call updateProvidersBatch per unique preimage group", async () => {
    const providers = [
      makeProvider(1, { groupTag: "same" }),
      makeProvider(2, { groupTag: "same" }),
      makeProvider(3, { groupTag: "different" }),
    ];

    const { undoToken, operationId, undoProviderPatch } = await setupPreviewApplyAndGetUndo(
      providers,
      [1, 2, 3],
      { group_tag: { set: "new-value" } }
    );

    updateProvidersBatchMock.mockResolvedValue(1);

    await undoProviderPatch({ undoToken, operationId });

    // 2 groups: [1,2] with "same" and [3] with "different"
    expect(updateProvidersBatchMock).toHaveBeenCalledTimes(2);
    // One call should batch providers 1 and 2 together
    const calls = updateProvidersBatchMock.mock.calls as Array<[number[], Record<string, unknown>]>;
    const groupedCall = calls.find((c) => c[0].length === 2);
    expect(groupedCall).toBeDefined();
    expect(groupedCall![0]).toEqual(expect.arrayContaining([1, 2]));
  });

  it("should publish cache invalidation after undo", async () => {
    const providers = [makeProvider(1, { groupTag: "old" })];

    const { undoToken, operationId, undoProviderPatch } = await setupPreviewApplyAndGetUndo(
      providers,
      [1],
      { group_tag: { set: "new" } }
    );

    updateProvidersBatchMock.mockResolvedValue(1);

    const result = await undoProviderPatch({ undoToken, operationId });

    expect(result.ok).toBe(true);
    expect(publishCacheInvalidationMock).toHaveBeenCalledOnce();
  });

  it("should return correct revertedCount from actual DB writes", async () => {
    const providers = [
      makeProvider(1, { groupTag: "a" }),
      makeProvider(2, { groupTag: "b" }),
      makeProvider(3, { groupTag: "c" }),
    ];

    const { undoToken, operationId, undoProviderPatch } = await setupPreviewApplyAndGetUndo(
      providers,
      [1, 2, 3],
      { group_tag: { set: "unified" } }
    );

    // Each per-group call returns 1
    updateProvidersBatchMock.mockResolvedValue(1);

    const result = await undoProviderPatch({ undoToken, operationId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 3 different preimages -> 3 calls, each returning 1
    expect(result.data.revertedCount).toBe(3);
  });

  it("should return UNDO_EXPIRED for missing token", async () => {
    const { undoProviderPatch } = await import("@/actions/providers");

    const result = await undoProviderPatch({
      undoToken: "nonexistent_token",
      operationId: "op_123",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe(PROVIDER_BATCH_PATCH_ERROR_CODES.UNDO_EXPIRED);
  });

  it("should return UNDO_CONFLICT for mismatched operationId", async () => {
    const providers = [makeProvider(1, { groupTag: "old" })];

    const { undoToken, undoProviderPatch } = await setupPreviewApplyAndGetUndo(providers, [1], {
      group_tag: { set: "new" },
    });

    const result = await undoProviderPatch({
      undoToken,
      operationId: "wrong_operation_id",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe(PROVIDER_BATCH_PATCH_ERROR_CODES.UNDO_CONFLICT);
    expect(updateProvidersBatchMock).not.toHaveBeenCalled();
  });

  it("should consume undo token after successful undo", async () => {
    const providers = [makeProvider(1, { groupTag: "old" })];

    const { undoToken, operationId, undoProviderPatch } = await setupPreviewApplyAndGetUndo(
      providers,
      [1],
      { group_tag: { set: "new" } }
    );

    updateProvidersBatchMock.mockResolvedValue(1);

    const first = await undoProviderPatch({ undoToken, operationId });
    expect(first.ok).toBe(true);

    // Second undo with same token should fail -- token was consumed
    const second = await undoProviderPatch({ undoToken, operationId });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.errorCode).toBe(PROVIDER_BATCH_PATCH_ERROR_CODES.UNDO_EXPIRED);
  });

  it("should handle costMultiplier number-to-string conversion", async () => {
    const providers = [makeProvider(1, { costMultiplier: 1.5 })];

    const { undoToken, operationId, undoProviderPatch } = await setupPreviewApplyAndGetUndo(
      providers,
      [1],
      { cost_multiplier: { set: 2.5 } }
    );

    updateProvidersBatchMock.mockResolvedValue(1);

    const result = await undoProviderPatch({ undoToken, operationId });

    expect(result.ok).toBe(true);
    // The preimage stored costMultiplier as number 1.5; undo must convert to string "1.5"
    expect(updateProvidersBatchMock).toHaveBeenCalledWith(
      [1],
      expect.objectContaining({ costMultiplier: "1.5" })
    );
  });

  it("should handle providers with different preimage values individually", async () => {
    const providers = [
      makeProvider(1, { priority: 5, weight: 80 }),
      makeProvider(2, { priority: 10, weight: 60 }),
    ];

    const { undoToken, operationId, undoProviderPatch } = await setupPreviewApplyAndGetUndo(
      providers,
      [1, 2],
      { priority: { set: 1 }, weight: { set: 100 } }
    );

    updateProvidersBatchMock.mockResolvedValue(1);

    const result = await undoProviderPatch({ undoToken, operationId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Each provider should be reverted with its own original values
    expect(updateProvidersBatchMock).toHaveBeenCalledWith(
      [1],
      expect.objectContaining({ priority: 5, weight: 80 })
    );
    expect(updateProvidersBatchMock).toHaveBeenCalledWith(
      [2],
      expect.objectContaining({ priority: 10, weight: 60 })
    );
    expect(result.data.revertedCount).toBe(2);
  });

  it("should handle providerIds without preimage entries gracefully", async () => {
    // Only provider 1 exists in DB; provider 999 has no preimage
    const providers = [makeProvider(1, { groupTag: "old" })];
    findAllProvidersFreshMock.mockResolvedValue(providers);
    updateProvidersBatchMock.mockResolvedValue(1);

    const { previewProviderBatchPatch, applyProviderBatchPatch, undoProviderPatch } = await import(
      "@/actions/providers"
    );

    const preview = await previewProviderBatchPatch({
      providerIds: [1, 999],
      patch: { group_tag: { set: "new" } },
    });
    if (!preview.ok) throw new Error(`Preview failed: ${preview.error}`);

    const apply = await applyProviderBatchPatch({
      previewToken: preview.data.previewToken,
      previewRevision: preview.data.previewRevision,
      providerIds: [1, 999],
      patch: { group_tag: { set: "new" } },
    });
    if (!apply.ok) throw new Error(`Apply failed: ${apply.error}`);

    updateProvidersBatchMock.mockClear();
    publishCacheInvalidationMock.mockClear();
    updateProvidersBatchMock.mockResolvedValue(1);

    const result = await undoProviderPatch({
      undoToken: apply.data.undoToken,
      operationId: apply.data.operationId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only provider 1 has preimage, provider 999 is skipped
    expect(updateProvidersBatchMock).toHaveBeenCalledTimes(1);
    expect(updateProvidersBatchMock).toHaveBeenCalledWith(
      [1],
      expect.objectContaining({ groupTag: "old" })
    );
    expect(result.data.revertedCount).toBe(1);
  });
});
