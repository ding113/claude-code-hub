import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDER_BATCH_PATCH_ERROR_CODES } from "@/lib/provider-batch-patch-error-codes";
import { buildRedisMock, createRedisStore } from "./redis-mock-utils";

const getSessionMock = vi.fn();
const findAllProvidersFreshMock = vi.fn();
const updateProvidersBatchMock = vi.fn();
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

describe("Provider Batch Patch Action Contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    redisStore.clear();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findAllProvidersFreshMock.mockResolvedValue([]);
    updateProvidersBatchMock.mockResolvedValue(0);
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
    const secondUndo = await undoProviderPatch({
      undoToken: apply.data.undoToken,
      operationId: apply.data.operationId,
    });

    expect(firstUndo.ok).toBe(true);
    if (firstUndo.ok) {
      expect(firstUndo.data.revertedCount).toBe(2);
    }

    expect(secondUndo.ok).toBe(false);
    if (secondUndo.ok) return;

    expect(secondUndo.errorCode).toBe(PROVIDER_BATCH_PATCH_ERROR_CODES.UNDO_EXPIRED);
  });
});
