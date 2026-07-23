import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDER_BATCH_PATCH_ERROR_CODES } from "@/lib/provider-batch-patch-error-codes";
import type { ProviderBatchApplyLedgerResult } from "@/drizzle/schema";
import { buildRedisMock, createRedisStore } from "./redis-mock-utils";

const getSessionMock = vi.fn();
const findAllProvidersFreshMock = vi.fn();
const updateProvidersBatchMock = vi.fn();
const findProviderBatchApplyOperationMock = vi.fn();
const applyProviderBatchOperationIfUnchangedMock = vi.fn();
const undoProviderBatchOperationMock = vi.fn();
const findProviderBatchUndoOperationMock = vi.fn();
const { store: redisStore, mocks: redisMocks } = createRedisStore();
const applyLedger = new Map<
  string,
  {
    previewToken: string;
    payloadFingerprint: string;
    result: ProviderBatchApplyLedgerResult;
    undoAvailable: boolean;
  }
>();

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/repository/provider", () => ({
  findAllProvidersFresh: findAllProvidersFreshMock,
  updateProvidersBatch: updateProvidersBatchMock,
  findProviderBatchApplyOperation: findProviderBatchApplyOperationMock,
  applyProviderBatchOperationIfUnchanged: applyProviderBatchOperationIfUnchangedMock,
  undoProviderBatchOperation: undoProviderBatchOperationMock,
  findProviderBatchUndoOperation: findProviderBatchUndoOperationMock,
  deleteProvidersBatch: vi.fn(),
}));

vi.mock("@/lib/cache/provider-cache", () => ({
  publishProviderCacheInvalidation: vi.fn(),
}));

vi.mock("@/lib/redis/client", () => buildRedisMock(redisMocks));

vi.mock("@/lib/circuit-breaker", () => ({
  clearProviderState: vi.fn(),
  clearConfigCache: vi.fn(),
  resetCircuit: vi.fn(),
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
        return existing.payloadFingerprint === payloadFingerprint
          ? { status: "replay", result: existing.result, undoAvailable: existing.undoAvailable }
          : { status: "idempotency_conflict" };
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
      preimages: input.effectiveProviderIds.map((providerId) => {
        const expected = expectedById.get(providerId);
        return {
          providerId,
          providerType: expected.providerType,
          isEnabled: expected.values.isEnabled,
          values: input.undoPreimage[providerId],
        };
      }),
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

describe("Provider Batch Patch Action Contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    redisStore.clear();
    applyLedger.clear();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findAllProvidersFreshMock.mockResolvedValue([]);
    updateProvidersBatchMock.mockResolvedValue(0);
    findProviderBatchUndoOperationMock.mockResolvedValue({ status: "expired" });
    installApplyLedgerMocks();
    undoProviderBatchOperationMock.mockImplementation(
      async ({ undoToken, operationId, groups }) => {
        const entry = [...applyLedger.values()].find(
          (candidate) => candidate.result.applyResult.undoToken === undoToken
        );
        if (!entry || !entry.undoAvailable) return { status: "expired" };
        if (entry.result.applyResult.operationId !== operationId) return { status: "conflict" };
        let revertedCount = 0;
        for (const group of groups) {
          revertedCount += await updateProvidersBatchMock(group.ids, group.updates);
        }
        entry.undoAvailable = false;
        return { status: "reverted", revertedCount };
      }
    );
  });

  it("previewProviderBatchPatch should require admin role", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: 2, role: "user" } });

    const { previewProviderBatchPatch } = await import("@/actions/providers");
    const result = await previewProviderBatchPatch({
      providerIds: [1, 2],
      patch: { group_tag: { set: "ops" } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toBe("无权限执行此操作");
  });

  it("previewProviderBatchPatch should return structured preview payload", async () => {
    const { previewProviderBatchPatch } = await import("@/actions/providers");
    const result = await previewProviderBatchPatch({
      providerIds: [3, 1, 3, 2],
      patch: {
        group_tag: { set: "blue" },
        allowed_models: { clear: true },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.providerIds).toEqual([1, 2, 3]);
    expect(result.data.summary.providerCount).toBe(3);
    expect(result.data.summary.fieldCount).toBe(2);
    expect(result.data.changedFields).toEqual(["group_tag", "allowed_models"]);
    expect(result.data.previewToken).toMatch(/^provider_patch_preview_/);
    expect(result.data.previewRevision.length).toBeGreaterThan(0);
    expect(result.data.previewExpiresAt.length).toBeGreaterThan(0);
  });

  it("previewProviderBatchPatch should return NOTHING_TO_APPLY when patch has no changes", async () => {
    const { previewProviderBatchPatch } = await import("@/actions/providers");
    const result = await previewProviderBatchPatch({
      providerIds: [1],
      patch: { group_tag: { no_change: true } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errorCode).toBe(PROVIDER_BATCH_PATCH_ERROR_CODES.NOTHING_TO_APPLY);
  });

  it("applyProviderBatchPatch should reject unknown preview token", async () => {
    const { applyProviderBatchPatch } = await import("@/actions/providers");
    const result = await applyProviderBatchPatch({
      previewToken: "provider_patch_preview_missing",
      previewRevision: "rev",
      providerIds: [1],
      patch: { group_tag: { set: "x" } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errorCode).toBe(PROVIDER_BATCH_PATCH_ERROR_CODES.PREVIEW_EXPIRED);
  });

  it("applyProviderBatchPatch should reject stale revision", async () => {
    const { previewProviderBatchPatch, applyProviderBatchPatch } = await import(
      "@/actions/providers"
    );
    const preview = await previewProviderBatchPatch({
      providerIds: [1],
      patch: { group_tag: { set: "x" } },
    });
    if (!preview.ok) throw new Error("Preview should be ok in test setup");

    const apply = await applyProviderBatchPatch({
      previewToken: preview.data.previewToken,
      previewRevision: `${preview.data.previewRevision}-stale`,
      providerIds: [1],
      patch: { group_tag: { set: "x" } },
    });

    expect(apply.ok).toBe(false);
    if (apply.ok) return;

    expect(apply.errorCode).toBe(PROVIDER_BATCH_PATCH_ERROR_CODES.PREVIEW_STALE);
  });

  it("applyProviderBatchPatch should return idempotent result for same idempotency key", async () => {
    findAllProvidersFreshMock.mockResolvedValue([makeProvider(1), makeProvider(2)]);
    const { previewProviderBatchPatch, applyProviderBatchPatch } = await import(
      "@/actions/providers"
    );
    const preview = await previewProviderBatchPatch({
      providerIds: [1, 2],
      patch: { group_tag: { set: "x" } },
    });
    if (!preview.ok) throw new Error("Preview should be ok in test setup");

    const firstApply = await applyProviderBatchPatch({
      previewToken: preview.data.previewToken,
      previewRevision: preview.data.previewRevision,
      providerIds: [1, 2],
      patch: { group_tag: { set: "x" } },
      idempotencyKey: "idempotency-key-1",
    });
    const secondApply = await applyProviderBatchPatch({
      previewToken: preview.data.previewToken,
      previewRevision: preview.data.previewRevision,
      providerIds: [1, 2],
      patch: { group_tag: { set: "x" } },
      idempotencyKey: "idempotency-key-1",
    });

    expect(firstApply.ok).toBe(true);
    expect(secondApply.ok).toBe(true);
    if (!firstApply.ok || !secondApply.ok) return;

    expect(secondApply.data.operationId).toBe(firstApply.data.operationId);
    expect(secondApply.data.undoToken).toBe(firstApply.data.undoToken);
  });

  it("undoProviderPatch should reject mismatched operation id", async () => {
    findAllProvidersFreshMock.mockResolvedValue([makeProvider(10)]);
    const { previewProviderBatchPatch, applyProviderBatchPatch, undoProviderPatch } = await import(
      "@/actions/providers"
    );

    const preview = await previewProviderBatchPatch({
      providerIds: [10],
      patch: { group_tag: { set: "undo-test" } },
    });
    if (!preview.ok) throw new Error("Preview should be ok in test setup");

    const apply = await applyProviderBatchPatch({
      previewToken: preview.data.previewToken,
      previewRevision: preview.data.previewRevision,
      providerIds: [10],
      patch: { group_tag: { set: "undo-test" } },
      idempotencyKey: "undo-case",
    });
    if (!apply.ok) throw new Error("Apply should be ok in test setup");

    const undo = await undoProviderPatch({
      undoToken: apply.data.undoToken,
      operationId: `${apply.data.operationId}-invalid`,
    });

    expect(undo.ok).toBe(false);
    if (undo.ok) return;

    expect(undo.errorCode).toBe(PROVIDER_BATCH_PATCH_ERROR_CODES.UNDO_CONFLICT);
  });

  it("undoProviderPatch should consume token on success", async () => {
    findAllProvidersFreshMock.mockResolvedValue([
      makeProvider(12, { groupTag: "before-12" }),
      makeProvider(13, { groupTag: "before-13" }),
    ]);
    updateProvidersBatchMock.mockResolvedValue(1);

    const { previewProviderBatchPatch, applyProviderBatchPatch, undoProviderPatch } = await import(
      "@/actions/providers"
    );

    const preview = await previewProviderBatchPatch({
      providerIds: [12, 13],
      patch: { group_tag: { set: "rollback" } },
    });
    if (!preview.ok) throw new Error("Preview should be ok in test setup");

    const apply = await applyProviderBatchPatch({
      previewToken: preview.data.previewToken,
      previewRevision: preview.data.previewRevision,
      providerIds: [12, 13],
      patch: { group_tag: { set: "rollback" } },
      idempotencyKey: "undo-consume",
    });
    if (!apply.ok) throw new Error("Apply should be ok in test setup");

    const firstUndo = await undoProviderPatch({
      undoToken: apply.data.undoToken,
      operationId: apply.data.operationId,
    });
    redisMocks.setex.mockClear();
    const replay = await applyProviderBatchPatch({
      previewToken: preview.data.previewToken,
      previewRevision: preview.data.previewRevision,
      providerIds: [12, 13],
      patch: { group_tag: { set: "rollback" } },
      idempotencyKey: "undo-consume",
    });
    const secondUndo = await undoProviderPatch({
      undoToken: apply.data.undoToken,
      operationId: apply.data.operationId,
    });

    expect(firstUndo.ok).toBe(true);
    if (firstUndo.ok) {
      expect(firstUndo.data.revertedCount).toBe(2);
    }
    expect(replay.ok).toBe(true);
    expect(redisMocks.setex).not.toHaveBeenCalled();
    expect(redisStore.has(`cch:prov:undo-patch:${apply.data.undoToken}`)).toBe(false);

    expect(secondUndo.ok).toBe(false);
    if (secondUndo.ok) return;

    expect(secondUndo.errorCode).toBe(PROVIDER_BATCH_PATCH_ERROR_CODES.UNDO_EXPIRED);
  });
});
