import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDER_BATCH_PATCH_ERROR_CODES } from "@/lib/provider-batch-patch-error-codes";

const getSessionMock = vi.fn();
const findAllProvidersFreshMock = vi.fn();
const updateProvidersBatchMock = vi.fn();
const findProviderBatchApplyOperationMock = vi.fn();
const applyProviderBatchOperationIfUnchangedMock = vi.fn();
const consumeProviderBatchUndoMock = vi.fn();
const publishCacheInvalidationMock = vi.fn();
const redisStore = new Map<string, { value: string; expiresAt: number }>();
const applyLedger = new Map<
  string,
  {
    previewToken: string;
    payloadFingerprint: string;
    result: Record<string, unknown>;
    undoAvailable: boolean;
  }
>();

function readRedisValue(key: string): string | null {
  const entry = redisStore.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    redisStore.delete(key);
    return null;
  }

  return entry.value;
}

const redisSetexMock = vi.fn(async (key: string, ttlSeconds: number, value: string) => {
  redisStore.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
  return "OK";
});

const redisGetMock = vi.fn(async (key: string) => readRedisValue(key));

const redisDelMock = vi.fn(async (key: string) => {
  const existed = redisStore.delete(key);
  return existed ? 1 : 0;
});

const redisEvalMock = vi.fn(async (_script: string, _numKeys: number, key: string) => {
  const value = readRedisValue(key);
  if (value === null) return null;
  redisStore.delete(key);
  return value;
});

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/repository/provider", () => ({
  findAllProvidersFresh: findAllProvidersFreshMock,
  updateProvidersBatch: updateProvidersBatchMock,
  findProviderBatchApplyOperation: findProviderBatchApplyOperationMock,
  applyProviderBatchOperationIfUnchanged: applyProviderBatchOperationIfUnchangedMock,
  consumeProviderBatchUndo: consumeProviderBatchUndoMock,
  deleteProvidersBatch: vi.fn(),
}));

vi.mock("@/lib/cache/provider-cache", () => ({
  publishProviderCacheInvalidation: publishCacheInvalidationMock,
}));

vi.mock("@/lib/redis/client", () => ({
  getRedisClient: () => ({
    status: "ready",
    setex: redisSetexMock,
    get: redisGetMock,
    del: redisDelMock,
    eval: redisEvalMock,
  }),
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
    codexImageGenerationPreference: null,
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

function installApplyLedgerMocks() {
  findProviderBatchApplyOperationMock.mockImplementation(
    async ({ claimKey, previewToken, payloadFingerprint }) => {
      const existing = applyLedger.get(claimKey);
      if (existing) {
        if (existing.payloadFingerprint !== payloadFingerprint) {
          return { status: "idempotency_conflict" };
        }
        return { status: "replay", result: existing.result, undoAvailable: existing.undoAvailable };
      }
      if ([...applyLedger.values()].some((entry) => entry.previewToken === previewToken)) {
        return { status: "preview_consumed" };
      }
      return { status: "not_found" };
    }
  );
  applyProviderBatchOperationIfUnchangedMock.mockImplementation(async (input) => {
    const lookup = await findProviderBatchApplyOperationMock(input);
    if (lookup.status !== "not_found") return lookup;
    const expectedById = new Map(input.expectedPreimages.map((entry) => [entry.providerId, entry]));
    const preimages = input.effectiveProviderIds.map((providerId) => {
      const expected = expectedById.get(providerId);
      return {
        providerId,
        providerType: expected.providerType,
        isEnabled: expected.values.isEnabled,
        values: input.undoPreimage[providerId],
      };
    });
    const updatedCount = new Set(input.groups.flatMap((group) => group.ids)).size;
    const appliedAt = new Date();
    const result = {
      applyResult: {
        operationId: input.operationId,
        appliedAt: appliedAt.toISOString(),
        updatedCount,
        undoToken: input.undoToken,
        undoExpiresAt: new Date(appliedAt.getTime() + input.undoTtlSeconds * 1000).toISOString(),
      },
      previewProviderIds: input.expectedPreimages.map((entry) => entry.providerId),
      effectiveProviderIds: input.effectiveProviderIds,
      preimages,
      undoRestorable: input.undoRestorable,
      postCommitEffects: input.postCommitEffects,
    };
    applyLedger.set(input.claimKey, {
      previewToken: input.previewToken,
      payloadFingerprint: input.payloadFingerprint,
      result,
      undoAvailable: true,
    });
    return { status: "applied", result, undoAvailable: true };
  });
}

describe("Apply Provider Batch Patch Engine", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    redisStore.clear();
    applyLedger.clear();
    redisSetexMock.mockClear();
    redisGetMock.mockClear();
    redisDelMock.mockClear();
    redisEvalMock.mockClear();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findAllProvidersFreshMock.mockResolvedValue([]);
    updateProvidersBatchMock.mockResolvedValue(0);
    installApplyLedgerMocks();
    consumeProviderBatchUndoMock.mockResolvedValue({ status: "consumed" });
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

  it("should atomically update the approved provider IDs and values", async () => {
    const providers = [makeProvider(1, { groupTag: "old" }), makeProvider(2, { groupTag: "old" })];
    findAllProvidersFreshMock.mockResolvedValue(providers);

    const { apply } = await setupPreviewAndApply([1, 2], { group_tag: { set: "new-group" } });

    expect(apply.ok).toBe(true);
    expect(applyProviderBatchOperationIfUnchangedMock).toHaveBeenCalledOnce();
    expect(applyProviderBatchOperationIfUnchangedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: expect.any(String),
        undoToken: expect.any(String),
        undoTtlSeconds: 10,
        undoRestorable: true,
        groups: [{ ids: [1, 2], updates: expect.objectContaining({ groupTag: "new-group" }) }],
        expectedPreimages: expect.arrayContaining([
          expect.objectContaining({
            providerId: 1,
            values: expect.objectContaining({ isEnabled: true, groupTag: "old" }),
          }),
          expect.objectContaining({
            providerId: 2,
            values: expect.objectContaining({ isEnabled: true, groupTag: "old" }),
          }),
        ]),
      })
    );
    const repositoryInput = applyProviderBatchOperationIfUnchangedMock.mock.calls[0][0];
    expect(repositoryInput).not.toHaveProperty("applyResult");
    expect(repositoryInput).not.toHaveProperty("undoExpiresAt");
  });

  it("should persist the full preview preimage even when a provider is excluded", async () => {
    findAllProvidersFreshMock.mockResolvedValue([
      makeProvider(1, { groupTag: "included" }),
      makeProvider(2, { groupTag: "excluded" }),
    ]);

    const { apply } = await setupPreviewAndApply(
      [1, 2],
      { group_tag: { set: "next" } },
      { excludeProviderIds: [2], idempotencyKey: "excluded-preimage" }
    );

    expect(apply.ok).toBe(true);
    expect(applyProviderBatchOperationIfUnchangedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        effectiveProviderIds: [1],
        groups: [{ ids: [1], updates: expect.objectContaining({ groupTag: "next" }) }],
        expectedPreimages: expect.arrayContaining([
          expect.objectContaining({
            providerId: 1,
            values: expect.objectContaining({ isEnabled: true, groupTag: "included" }),
          }),
          expect.objectContaining({
            providerId: 2,
            values: expect.objectContaining({ isEnabled: true, groupTag: "excluded" }),
          }),
        ]),
        undoPreimage: {
          1: expect.objectContaining({ groupTag: "included" }),
        },
      })
    );
  });

  it("should publish cache invalidation after successful write", async () => {
    findAllProvidersFreshMock.mockResolvedValue([makeProvider(1)]);
    const { apply } = await setupPreviewAndApply([1], { is_enabled: { set: false } });

    expect(apply.ok).toBe(true);
    expect(publishCacheInvalidationMock).toHaveBeenCalledOnce();
  });

  it("should use the immutable preview preimage without fetching providers again", async () => {
    const providers = [
      makeProvider(1, { groupTag: "alpha", priority: 5 }),
      makeProvider(2, { groupTag: "beta", priority: 10 }),
    ];
    findAllProvidersFreshMock.mockResolvedValue(providers);
    const { apply } = await setupPreviewAndApply([1, 2], { group_tag: { set: "gamma" } });

    expect(apply.ok).toBe(true);
    expect(findAllProvidersFreshMock).toHaveBeenCalledOnce();
    expect(applyProviderBatchOperationIfUnchangedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedPreimages: expect.arrayContaining([
          expect.objectContaining({
            providerId: 1,
            values: expect.objectContaining({ isEnabled: true, groupTag: "alpha" }),
          }),
          expect.objectContaining({
            providerId: 2,
            values: expect.objectContaining({ isEnabled: true, groupTag: "beta" }),
          }),
        ]),
      })
    );
  });

  it("should only apply to non-excluded providers with excludeProviderIds", async () => {
    const providers = [
      makeProvider(1, { groupTag: "a" }),
      makeProvider(2, { groupTag: "b" }),
      makeProvider(3, { groupTag: "c" }),
    ];
    findAllProvidersFreshMock.mockResolvedValue(providers);
    const { apply } = await setupPreviewAndApply(
      [1, 2, 3],
      { group_tag: { set: "unified" } },
      { excludeProviderIds: [2] }
    );

    expect(apply.ok).toBe(true);
    expect(applyProviderBatchOperationIfUnchangedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        groups: [{ ids: [1, 3], updates: expect.objectContaining({ groupTag: "unified" }) }],
        effectiveProviderIds: [1, 3],
      })
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
    expect(applyProviderBatchOperationIfUnchangedMock).not.toHaveBeenCalled();
  });

  it("should set updatedCount from the durable transaction result", async () => {
    findAllProvidersFreshMock.mockResolvedValue([
      makeProvider(1),
      makeProvider(2),
      makeProvider(3),
    ]);
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

  it("should replay the durable result for the same key, preview, and payload", async () => {
    findAllProvidersFreshMock.mockResolvedValue([makeProvider(1), makeProvider(2)]);
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
    expect(second.data.undoToken).toBe(first.data.undoToken);
    expect(applyProviderBatchOperationIfUnchangedMock).toHaveBeenCalledOnce();
  });

  it("should replay after preview Redis expiry and rebuild undo with only its original remaining TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00.000Z"));
    findAllProvidersFreshMock.mockResolvedValue([makeProvider(1, { groupTag: "before" })]);
    const { previewProviderBatchPatch, applyProviderBatchPatch } = await import(
      "@/actions/providers"
    );
    const preview = await previewProviderBatchPatch({
      providerIds: [1],
      patch: { group_tag: { set: "after" } },
    });
    if (!preview.ok) throw new Error("Preview should succeed");

    const first = await applyProviderBatchPatch({
      previewToken: preview.data.previewToken,
      previewRevision: preview.data.previewRevision,
      providerIds: [1],
      patch: { group_tag: { set: "after" } },
      idempotencyKey: "durable-replay-key",
    });
    if (!first.ok) throw new Error(`First apply failed: ${first.error}`);

    redisStore.delete(`cch:prov:preview:${preview.data.previewToken}`);
    redisStore.delete(`cch:prov:undo-patch:${first.data.undoToken}`);
    redisSetexMock.mockClear();
    vi.setSystemTime(new Date("2026-07-14T12:00:03.000Z"));

    const replay = await applyProviderBatchPatch({
      previewToken: preview.data.previewToken,
      previewRevision: preview.data.previewRevision,
      providerIds: [1],
      patch: { group_tag: { set: "after" } },
      idempotencyKey: "durable-replay-key",
    });

    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.data).toEqual(first.data);
    expect(applyProviderBatchOperationIfUnchangedMock).toHaveBeenCalledOnce();
    const undoEntry = redisStore.get(`cch:prov:undo-patch:${first.data.undoToken}`);
    expect(undoEntry).toBeDefined();
    expect(undoEntry?.expiresAt).toBe(new Date(first.data.undoExpiresAt).getTime());
    expect(redisSetexMock).toHaveBeenCalledWith(
      `cch:prov:undo-patch:${first.data.undoToken}`,
      7,
      expect.any(String)
    );
  });

  it("should reject a consumed preview under a different key even with mutually exclusive excludes", async () => {
    findAllProvidersFreshMock.mockResolvedValue([
      makeProvider(1, { groupTag: "one" }),
      makeProvider(2, { groupTag: "two" }),
    ]);
    const { previewProviderBatchPatch, applyProviderBatchPatch } = await import(
      "@/actions/providers"
    );
    const preview = await previewProviderBatchPatch({
      providerIds: [1, 2],
      patch: { group_tag: { set: "after" } },
    });
    if (!preview.ok) throw new Error("Preview should succeed");

    const first = await applyProviderBatchPatch({
      previewToken: preview.data.previewToken,
      previewRevision: preview.data.previewRevision,
      providerIds: [1, 2],
      patch: { group_tag: { set: "after" } },
      excludeProviderIds: [2],
      idempotencyKey: "first-preview-key",
    });
    const second = await applyProviderBatchPatch({
      previewToken: preview.data.previewToken,
      previewRevision: preview.data.previewRevision,
      providerIds: [1, 2],
      patch: { group_tag: { set: "after" } },
      excludeProviderIds: [1],
      idempotencyKey: "second-preview-key",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.errorCode).toBe(PROVIDER_BATCH_PATCH_ERROR_CODES.PREVIEW_STALE);
    expect(applyProviderBatchOperationIfUnchangedMock).toHaveBeenCalledOnce();
  });

  it("should reject reuse of an idempotency key with a different payload", async () => {
    findAllProvidersFreshMock.mockResolvedValue([makeProvider(1, { groupTag: "before" })]);
    const { previewProviderBatchPatch, applyProviderBatchPatch } = await import(
      "@/actions/providers"
    );
    const firstPreview = await previewProviderBatchPatch({
      providerIds: [1],
      patch: { group_tag: { set: "first" } },
    });
    const secondPreview = await previewProviderBatchPatch({
      providerIds: [1],
      patch: { group_tag: { set: "second" } },
    });
    if (!firstPreview.ok || !secondPreview.ok) throw new Error("Preview should succeed");

    const first = await applyProviderBatchPatch({
      previewToken: firstPreview.data.previewToken,
      previewRevision: firstPreview.data.previewRevision,
      providerIds: [1],
      patch: { group_tag: { set: "first" } },
      idempotencyKey: "payload-bound-key",
    });
    const second = await applyProviderBatchPatch({
      previewToken: secondPreview.data.previewToken,
      previewRevision: secondPreview.data.previewRevision,
      providerIds: [1],
      patch: { group_tag: { set: "second" } },
      idempotencyKey: "payload-bound-key",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.errorCode).toBe(PROVIDER_BATCH_PATCH_ERROR_CODES.IDEMPOTENCY_CONFLICT);
    expect(applyProviderBatchOperationIfUnchangedMock).toHaveBeenCalledOnce();
  });

  it("should reject apply when the transaction reports a changed live preimage", async () => {
    findAllProvidersFreshMock.mockResolvedValue([makeProvider(1, { weight: 1 })]);
    applyProviderBatchOperationIfUnchangedMock.mockResolvedValueOnce({ status: "stale" });

    const { apply } = await setupPreviewAndApply(
      [1],
      { weight: { set: 8 } },
      { idempotencyKey: "stale-preimage-key" }
    );

    expect(apply.ok).toBe(false);
    if (apply.ok) return;
    expect(apply.errorCode).toBe(PROVIDER_BATCH_PATCH_ERROR_CODES.PREVIEW_STALE);
    expect(publishCacheInvalidationMock).not.toHaveBeenCalled();
  });

  it("should replay the original result without an explicit idempotency key", async () => {
    findAllProvidersFreshMock.mockResolvedValue([makeProvider(1)]);
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
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.data).toEqual(first.data);
    expect(applyProviderBatchOperationIfUnchangedMock).toHaveBeenCalledOnce();
  });

  it("should keep sensitive proxy URLs out of durable undo and post-commit payloads", async () => {
    findAllProvidersFreshMock.mockResolvedValue([
      makeProvider(1, {
        proxyUrl: "http://user:secret@proxy.example.com:8080",
        mcpPassthroughUrl: "https://token@example.com/mcp",
      }),
    ]);

    const { apply } = await setupPreviewAndApply([1], {
      proxy_url: { set: "http://next:secret@proxy.example.com:8080" },
      mcp_passthrough_url: { set: "https://next-token@example.com/mcp" },
    });

    expect(apply.ok).toBe(true);
    expect(applyProviderBatchOperationIfUnchangedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        undoRestorable: false,
        undoPreimage: { 1: {} },
        postCommitEffects: {
          clearLimit5hCostCache: false,
          circuitBreakerChanged: false,
          nextCircuitBreakerFailureThreshold: null,
        },
      })
    );
    const repositoryInput = applyProviderBatchOperationIfUnchangedMock.mock.calls.at(-1)?.[0];
    const serialized = JSON.stringify({
      undoPreimage: repositoryInput.undoPreimage,
      postCommitEffects: repositoryInput.postCommitEffects,
    });
    expect(serialized).not.toContain("user:secret");
    expect(serialized).not.toContain("token@example.com");
  });

  it("should map cost_multiplier to string for repository", async () => {
    findAllProvidersFreshMock.mockResolvedValue([makeProvider(1, { costMultiplier: 1.0 })]);
    const { apply } = await setupPreviewAndApply([1], { cost_multiplier: { set: 2.5 } });

    expect(apply.ok).toBe(true);
    expect(applyProviderBatchOperationIfUnchangedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        groups: [{ ids: [1], updates: expect.objectContaining({ costMultiplier: "2.5" }) }],
      })
    );
  });

  it("should map multiple fields correctly to repository format", async () => {
    findAllProvidersFreshMock.mockResolvedValue([
      makeProvider(1, { groupTag: "old", weight: 100, priority: 1 }),
    ]);
    const { apply } = await setupPreviewAndApply([1], {
      group_tag: { set: "new" },
      weight: { set: 80 },
      priority: { set: 5 },
    });

    expect(apply.ok).toBe(true);
    expect(applyProviderBatchOperationIfUnchangedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        groups: [
          {
            ids: [1],
            updates: expect.objectContaining({
              groupTag: "new",
              weight: 80,
              priority: 5,
            }),
          },
        ],
      })
    );
  });

  it("should map clear mode to null for clearable fields", async () => {
    findAllProvidersFreshMock.mockResolvedValue([
      makeProvider(1, { groupTag: "has-tag", modelRedirects: { a: "b" } }),
    ]);
    const { apply } = await setupPreviewAndApply([1], {
      group_tag: { clear: true },
      model_redirects: { clear: true },
    });

    expect(apply.ok).toBe(true);
    expect(applyProviderBatchOperationIfUnchangedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        groups: [
          {
            ids: [1],
            updates: expect.objectContaining({
              groupTag: null,
              modelRedirects: null,
            }),
          },
        ],
      })
    );
  });

  it("should map anthropic_thinking_budget_preference clear to inherit", async () => {
    findAllProvidersFreshMock.mockResolvedValue([
      makeProvider(1, { anthropicThinkingBudgetPreference: "8192" }),
    ]);
    const { apply } = await setupPreviewAndApply([1], {
      anthropic_thinking_budget_preference: { clear: true },
    });

    expect(apply.ok).toBe(true);
    expect(applyProviderBatchOperationIfUnchangedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        groups: [
          {
            ids: [1],
            updates: expect.objectContaining({
              anthropicThinkingBudgetPreference: "inherit",
            }),
          },
        ],
      })
    );
  });
});
