import { describe, expect, test, vi } from "vitest";

type ProviderRow = Record<string, unknown>;

function createProviderRow(overrides: Partial<ProviderRow> = {}): ProviderRow {
  const now = new Date("2025-01-01T00:00:00.000Z");

  return {
    id: 1,
    name: "Provider A",
    url: "https://old.example.com/v1/messages",
    key: "test-key",
    providerVendorId: 11,
    isEnabled: true,
    weight: 1,
    priority: 0,
    costMultiplier: "1.0",
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
    limitConcurrentSessions: 0,
    maxRetryAttempts: null,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerOpenDuration: 1800000,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    firstByteTimeoutStreamingMs: 30000,
    streamingIdleTimeoutMs: 10000,
    requestTimeoutNonStreamingMs: 600000,
    websiteUrl: "https://vendor.example.com",
    faviconUrl: null,
    cacheTtlPreference: null,
    context1mPreference: null,
    codexReasoningEffortPreference: null,
    codexReasoningSummaryPreference: null,
    codexTextVerbosityPreference: null,
    codexParallelToolCallsPreference: null,
    anthropicMaxTokensPreference: null,
    anthropicThinkingBudgetPreference: null,
    geminiGoogleSearchPreference: null,
    tpm: null,
    rpm: null,
    rpd: null,
    cc: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function createDbMock(currentRow: ProviderRow, updatedRow: ProviderRow) {
  const selectLimitMock = vi.fn(async () => [currentRow]);
  const selectWhereMock = vi.fn(() => ({ limit: selectLimitMock }));
  const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
  const selectMock = vi.fn(() => ({ from: selectFromMock }));

  const updateReturningMock = vi.fn(async () => [updatedRow]);
  const updateWhereMock = vi.fn(() => ({ returning: updateReturningMock }));
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const tx = {
    select: selectMock,
    update: updateMock,
  };
  const transactionMock = vi.fn(async (runInTx: (trx: typeof tx) => Promise<unknown>) => {
    return runInTx(tx);
  });

  return {
    select: selectMock,
    update: updateMock,
    transaction: transactionMock,
  };
}

async function arrangeUrlEditRedScenario(input: {
  oldUrl: string;
  newUrl: string;
  previousVendorId?: number;
  nextVendorId?: number;
}) {
  vi.resetModules();

  const previousVendorId = input.previousVendorId ?? 11;
  const nextVendorId = input.nextVendorId ?? previousVendorId;

  const currentRow = createProviderRow({
    id: 1,
    url: input.oldUrl,
    providerVendorId: previousVendorId,
    providerType: "claude",
  });
  const updatedRow = createProviderRow({
    id: 1,
    url: input.newUrl,
    providerVendorId: nextVendorId,
    providerType: "claude",
  });

  const db = createDbMock(currentRow, updatedRow);
  vi.doMock("../../../src/drizzle/db", () => ({ db }));

  const getOrCreateProviderVendorIdFromUrlsMock = vi.fn(async () => nextVendorId);
  const ensureProviderEndpointExistsForUrlMock = vi.fn(async () => true);
  const tryDeleteProviderVendorIfEmptyMock = vi.fn(async () => false);
  const syncProviderEndpointOnProviderEditMock = vi.fn(async () => ({ action: "noop" }));

  vi.doMock("../../../src/repository/provider-endpoints", () => ({
    getOrCreateProviderVendorIdFromUrls: getOrCreateProviderVendorIdFromUrlsMock,
    ensureProviderEndpointExistsForUrl: ensureProviderEndpointExistsForUrlMock,
    tryDeleteProviderVendorIfEmpty: tryDeleteProviderVendorIfEmptyMock,
    syncProviderEndpointOnProviderEdit: syncProviderEndpointOnProviderEditMock,
  }));

  const { updateProvider } = await import("../../../src/repository/provider");

  return {
    updateProvider,
    mocks: {
      ensureProviderEndpointExistsForUrlMock,
      syncProviderEndpointOnProviderEditMock,
      tryDeleteProviderVendorIfEmptyMock,
    },
  };
}

describe("provider repository - endpoint sync on edit (#722 RED)", () => {
  test("old-url exists + new-url absent: should update endpoint row instead of insert-only ensure", async () => {
    const oldUrl = "https://old.example.com/v1/messages";
    const newUrl = "https://new.example.com/v1/messages";

    const { updateProvider, mocks } = await arrangeUrlEditRedScenario({ oldUrl, newUrl });
    const provider = await updateProvider(1, { url: newUrl });

    expect(provider?.url).toBe(newUrl);
    expect(mocks.syncProviderEndpointOnProviderEditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 1,
        vendorId: 11,
        providerType: "claude",
        previousUrl: oldUrl,
        nextUrl: newUrl,
      }),
      expect.objectContaining({ tx: expect.any(Object) })
    );
  });

  test("old-url exists + new-url exists: should avoid duplicate accumulation and not call insert-only ensure", async () => {
    const oldUrl = "https://old.example.com/v1/messages";
    const newUrl = "https://new.example.com/v1/messages";

    const { updateProvider, mocks } = await arrangeUrlEditRedScenario({ oldUrl, newUrl });
    await updateProvider(1, { url: newUrl });

    expect(mocks.ensureProviderEndpointExistsForUrlMock).not.toHaveBeenCalled();
  });

  test("old-url still referenced by another active provider: should keep old-url endpoint (safe cleanup guard)", async () => {
    const oldUrl = "https://shared.example.com/v1/messages";
    const newUrl = "https://new.example.com/v1/messages";

    const { updateProvider, mocks } = await arrangeUrlEditRedScenario({ oldUrl, newUrl });
    await updateProvider(1, { url: newUrl });

    expect(mocks.syncProviderEndpointOnProviderEditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        previousUrl: oldUrl,
        nextUrl: newUrl,
        keepPreviousWhenReferenced: true,
      }),
      expect.objectContaining({ tx: expect.any(Object) })
    );
    expect(mocks.tryDeleteProviderVendorIfEmptyMock).not.toHaveBeenCalled();
  });

  test("endpoint sync throw: should bubble error instead of silent partial success", async () => {
    const oldUrl = "https://old.example.com/v1/messages";
    const newUrl = "https://new.example.com/v1/messages";

    const { updateProvider, mocks } = await arrangeUrlEditRedScenario({ oldUrl, newUrl });
    mocks.syncProviderEndpointOnProviderEditMock.mockRejectedValueOnce(new Error("sync failed"));

    await expect(updateProvider(1, { url: newUrl })).rejects.toThrow("sync failed");
    expect(mocks.tryDeleteProviderVendorIfEmptyMock).not.toHaveBeenCalled();
  });

  test("vendor cleanup failure should not block provider update", async () => {
    const oldUrl = "https://old-vendor.example.com/v1/messages";
    const newUrl = "https://new-vendor.example.com/v1/messages";

    const { updateProvider, mocks } = await arrangeUrlEditRedScenario({
      oldUrl,
      newUrl,
      previousVendorId: 11,
      nextVendorId: 22,
    });

    mocks.tryDeleteProviderVendorIfEmptyMock.mockRejectedValueOnce(new Error("cleanup failed"));

    const provider = await updateProvider(1, { url: newUrl });
    expect(provider?.providerVendorId).toBe(22);
    expect(mocks.tryDeleteProviderVendorIfEmptyMock).toHaveBeenCalledWith(11);
  });
});
