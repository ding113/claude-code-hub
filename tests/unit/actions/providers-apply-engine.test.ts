import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDER_BATCH_PATCH_ERROR_CODES } from "@/lib/provider-batch-patch-error-codes";

const getSessionMock = vi.fn();
const findAllProvidersFreshMock = vi.fn();
const updateProvidersBatchMock = vi.fn();
const publishCacheInvalidationMock = vi.fn();

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

describe("Apply Provider Batch Patch Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findAllProvidersFreshMock.mockResolvedValue([]);
    updateProvidersBatchMock.mockResolvedValue(0);
    publishCacheInvalidationMock.mockResolvedValue(undefined);
  });

  /** Helper: create preview then apply with optional overrides */
  async function setupPreviewAndApply(
    providerIds: number[],
    patch: Record<string, unknown>,
    applyOverrides: Record<string, unknown> = {}
  ) {
    const { previewProviderBatchPatch, applyProviderBatchPatch } = await import(
      "@/actions/providers"
    );

    const preview = await previewProviderBatchPatch({ providerIds, patch });
    if (!preview.ok) throw new Error(`Preview failed: ${preview.error}`);

    const applyInput = {
      previewToken: preview.data.previewToken,
      previewRevision: preview.data.previewRevision,
      providerIds,
      patch,
      ...applyOverrides,
    };

    const apply = await applyProviderBatchPatch(applyInput);
    return { preview, apply, applyProviderBatchPatch };
  }

  it("should call updateProvidersBatch with correct IDs and updates", async () => {
    const providers = [makeProvider(1, { groupTag: "old" }), makeProvider(2, { groupTag: "old" })];
    findAllProvidersFreshMock.mockResolvedValue(providers);
    updateProvidersBatchMock.mockResolvedValue(2);

    const { apply } = await setupPreviewAndApply([1, 2], { group_tag: { set: "new-group" } });

    expect(apply.ok).toBe(true);
    expect(updateProvidersBatchMock).toHaveBeenCalledOnce();
    expect(updateProvidersBatchMock).toHaveBeenCalledWith(
      [1, 2],
      expect.objectContaining({ groupTag: "new-group" })
    );
  });

  it("should publish cache invalidation after successful write", async () => {
    findAllProvidersFreshMock.mockResolvedValue([makeProvider(1)]);
    updateProvidersBatchMock.mockResolvedValue(1);

    const { apply } = await setupPreviewAndApply([1], { is_enabled: { set: false } });

    expect(apply.ok).toBe(true);
    expect(publishCacheInvalidationMock).toHaveBeenCalledOnce();
  });

  it("should fetch providers for preimage during apply", async () => {
    const providers = [
      makeProvider(1, { groupTag: "alpha", priority: 5 }),
      makeProvider(2, { groupTag: "beta", priority: 10 }),
    ];
    findAllProvidersFreshMock.mockResolvedValue(providers);
    updateProvidersBatchMock.mockResolvedValue(2);

    const { apply } = await setupPreviewAndApply([1, 2], { group_tag: { set: "gamma" } });

    expect(apply.ok).toBe(true);
    // preview calls findAllProvidersFresh once, apply calls it once more
    expect(findAllProvidersFreshMock).toHaveBeenCalledTimes(2);
  });

  it("should only apply to non-excluded providers with excludeProviderIds", async () => {
    const providers = [
      makeProvider(1, { groupTag: "a" }),
      makeProvider(2, { groupTag: "b" }),
      makeProvider(3, { groupTag: "c" }),
    ];
    findAllProvidersFreshMock.mockResolvedValue(providers);
    updateProvidersBatchMock.mockResolvedValue(2);

    const { apply } = await setupPreviewAndApply(
      [1, 2, 3],
      { group_tag: { set: "unified" } },
      { excludeProviderIds: [2] }
    );

    expect(apply.ok).toBe(true);
    expect(updateProvidersBatchMock).toHaveBeenCalledWith(
      [1, 3],
      expect.objectContaining({ groupTag: "unified" })
    );
  });

  it("should return NOTHING_TO_APPLY when all providers are excluded", async () => {
    findAllProvidersFreshMock.mockResolvedValue([makeProvider(1), makeProvider(2)]);

    const { apply } = await setupPreviewAndApply(
      [1, 2],
      { group_tag: { set: "x" } },
      { excludeProviderIds: [1, 2] }
    );

    expect(apply.ok).toBe(false);
    if (apply.ok) return;
    expect(apply.errorCode).toBe(PROVIDER_BATCH_PATCH_ERROR_CODES.NOTHING_TO_APPLY);
    expect(updateProvidersBatchMock).not.toHaveBeenCalled();
  });

  it("should set updatedCount from updateProvidersBatch return value", async () => {
    findAllProvidersFreshMock.mockResolvedValue([
      makeProvider(1),
      makeProvider(2),
      makeProvider(3),
    ]);
    updateProvidersBatchMock.mockResolvedValue(3);

    const { apply } = await setupPreviewAndApply([1, 2, 3], { weight: { set: 50 } });

    expect(apply.ok).toBe(true);
    if (!apply.ok) return;
    expect(apply.data.updatedCount).toBe(3);
  });

  it("should reflect exclusions in updatedCount", async () => {
    findAllProvidersFreshMock.mockResolvedValue([
      makeProvider(1),
      makeProvider(2),
      makeProvider(3),
    ]);
    updateProvidersBatchMock.mockResolvedValue(2);

    const { apply } = await setupPreviewAndApply(
      [1, 2, 3],
      { weight: { set: 50 } },
      { excludeProviderIds: [3] }
    );

    expect(apply.ok).toBe(true);
    if (!apply.ok) return;
    expect(apply.data.updatedCount).toBe(2);
  });

  it("should return PREVIEW_EXPIRED for unknown preview token", async () => {
    const { applyProviderBatchPatch } = await import("@/actions/providers");

    const result = await applyProviderBatchPatch({
      previewToken: "provider_patch_preview_nonexistent",
      previewRevision: "rev",
      providerIds: [1],
      patch: { group_tag: { set: "x" } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe(PROVIDER_BATCH_PATCH_ERROR_CODES.PREVIEW_EXPIRED);
  });

  it("should return PREVIEW_STALE for mismatched patch", async () => {
    findAllProvidersFreshMock.mockResolvedValue([makeProvider(1)]);

    const { previewProviderBatchPatch, applyProviderBatchPatch } = await import(
      "@/actions/providers"
    );

    const preview = await previewProviderBatchPatch({
      providerIds: [1],
      patch: { group_tag: { set: "original" } },
    });
    if (!preview.ok) throw new Error("Preview should succeed");

    const result = await applyProviderBatchPatch({
      previewToken: preview.data.previewToken,
      previewRevision: preview.data.previewRevision,
      providerIds: [1],
      patch: { group_tag: { set: "different" } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe(PROVIDER_BATCH_PATCH_ERROR_CODES.PREVIEW_STALE);
  });

  it("should return cached result for same idempotencyKey without re-writing to DB", async () => {
    findAllProvidersFreshMock.mockResolvedValue([makeProvider(1), makeProvider(2)]);
    updateProvidersBatchMock.mockResolvedValue(2);

    const { previewProviderBatchPatch, applyProviderBatchPatch } = await import(
      "@/actions/providers"
    );

    const preview = await previewProviderBatchPatch({
      providerIds: [1, 2],
      patch: { group_tag: { set: "idem" } },
    });
    if (!preview.ok) throw new Error("Preview should succeed");

    const applyInput = {
      previewToken: preview.data.previewToken,
      previewRevision: preview.data.previewRevision,
      providerIds: [1, 2],
      patch: { group_tag: { set: "idem" } },
      idempotencyKey: "idem-key-1",
    };

    const first = await applyProviderBatchPatch(applyInput);
    const second = await applyProviderBatchPatch(applyInput);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.data.operationId).toBe(first.data.operationId);
    expect(updateProvidersBatchMock).toHaveBeenCalledOnce();
  });

  it("should prevent double-apply by marking snapshot as applied", async () => {
    findAllProvidersFreshMock.mockResolvedValue([makeProvider(1)]);
    updateProvidersBatchMock.mockResolvedValue(1);

    const { previewProviderBatchPatch, applyProviderBatchPatch } = await import(
      "@/actions/providers"
    );

    const preview = await previewProviderBatchPatch({
      providerIds: [1],
      patch: { group_tag: { set: "x" } },
    });
    if (!preview.ok) throw new Error("Preview should succeed");

    const applyInput = {
      previewToken: preview.data.previewToken,
      previewRevision: preview.data.previewRevision,
      providerIds: [1],
      patch: { group_tag: { set: "x" } },
    };

    const first = await applyProviderBatchPatch(applyInput);
    const second = await applyProviderBatchPatch(applyInput);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.errorCode).toBe(PROVIDER_BATCH_PATCH_ERROR_CODES.PREVIEW_STALE);
  });

  it("should map cost_multiplier to string for repository", async () => {
    findAllProvidersFreshMock.mockResolvedValue([makeProvider(1, { costMultiplier: 1.0 })]);
    updateProvidersBatchMock.mockResolvedValue(1);

    const { apply } = await setupPreviewAndApply([1], { cost_multiplier: { set: 2.5 } });

    expect(apply.ok).toBe(true);
    expect(updateProvidersBatchMock).toHaveBeenCalledWith(
      [1],
      expect.objectContaining({ costMultiplier: "2.5" })
    );
  });

  it("should map multiple fields correctly to repository format", async () => {
    findAllProvidersFreshMock.mockResolvedValue([
      makeProvider(1, { groupTag: "old", weight: 100, priority: 1 }),
    ]);
    updateProvidersBatchMock.mockResolvedValue(1);

    const { apply } = await setupPreviewAndApply([1], {
      group_tag: { set: "new" },
      weight: { set: 80 },
      priority: { set: 5 },
    });

    expect(apply.ok).toBe(true);
    expect(updateProvidersBatchMock).toHaveBeenCalledWith(
      [1],
      expect.objectContaining({
        groupTag: "new",
        weight: 80,
        priority: 5,
      })
    );
  });

  it("should map clear mode to null for clearable fields", async () => {
    findAllProvidersFreshMock.mockResolvedValue([
      makeProvider(1, { groupTag: "has-tag", modelRedirects: { a: "b" } }),
    ]);
    updateProvidersBatchMock.mockResolvedValue(1);

    const { apply } = await setupPreviewAndApply([1], {
      group_tag: { clear: true },
      model_redirects: { clear: true },
    });

    expect(apply.ok).toBe(true);
    expect(updateProvidersBatchMock).toHaveBeenCalledWith(
      [1],
      expect.objectContaining({
        groupTag: null,
        modelRedirects: null,
      })
    );
  });

  it("should map anthropic_thinking_budget_preference clear to inherit", async () => {
    findAllProvidersFreshMock.mockResolvedValue([
      makeProvider(1, { anthropicThinkingBudgetPreference: "8192" }),
    ]);
    updateProvidersBatchMock.mockResolvedValue(1);

    const { apply } = await setupPreviewAndApply([1], {
      anthropic_thinking_budget_preference: { clear: true },
    });

    expect(apply.ok).toBe(true);
    expect(updateProvidersBatchMock).toHaveBeenCalledWith(
      [1],
      expect.objectContaining({
        anthropicThinkingBudgetPreference: "inherit",
      })
    );
  });
});
