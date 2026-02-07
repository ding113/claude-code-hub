import { describe, expect, test, vi } from "vitest";

type ProviderRow = Record<string, unknown>;

function createProviderRow(overrides: Partial<ProviderRow> = {}): ProviderRow {
  const now = new Date("2025-01-01T00:00:00.000Z");

  return {
    id: 101,
    name: "Provider A",
    url: "https://new.example.com/v1/messages",
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

function createCreateProviderInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Provider A",
    url: "https://new.example.com/v1/messages",
    key: "test-key",
    provider_type: "claude",
    website_url: "https://vendor.example.com",
    favicon_url: null,
    tpm: null,
    rpm: null,
    rpd: null,
    cc: null,
    ...overrides,
  };
}

function createDbMock(insertedRow: ProviderRow) {
  const insertReturningMock = vi.fn(async () => [insertedRow]);
  const insertValuesMock = vi.fn(() => ({ returning: insertReturningMock }));
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const tx = {
    insert: insertMock,
  };

  const transactionMock = vi.fn(async (runInTx: (trx: typeof tx) => Promise<unknown>) => {
    return runInTx(tx);
  });

  return {
    db: {
      transaction: transactionMock,
    },
    mocks: {
      transactionMock,
      insertMock,
    },
  };
}

describe("provider repository - createProvider transactional endpoint seeding", () => {
  test("createProvider should execute vendor resolve + provider insert + endpoint seed in one transaction", async () => {
    vi.resetModules();

    const dbState = createDbMock(
      createProviderRow({
        providerType: "codex",
        url: "https://new.example.com/v1/responses",
      })
    );

    vi.doMock("@/drizzle/db", () => ({
      db: dbState.db,
    }));

    const getOrCreateProviderVendorIdFromUrlsMock = vi.fn(async () => 11);
    const ensureProviderEndpointExistsForUrlMock = vi.fn(async () => true);

    vi.doMock("@/repository/provider-endpoints", () => ({
      getOrCreateProviderVendorIdFromUrls: getOrCreateProviderVendorIdFromUrlsMock,
      ensureProviderEndpointExistsForUrl: ensureProviderEndpointExistsForUrlMock,
      syncProviderEndpointOnProviderEdit: vi.fn(),
      tryDeleteProviderVendorIfEmpty: vi.fn(),
    }));

    const { createProvider } = await import("@/repository/provider");
    const provider = await createProvider(
      createCreateProviderInput({
        provider_type: "codex",
        url: "https://new.example.com/v1/responses",
      })
    );

    expect(provider.id).toBe(101);
    expect(dbState.mocks.transactionMock).toHaveBeenCalledTimes(1);
    expect(dbState.mocks.insertMock).toHaveBeenCalledTimes(1);

    expect(getOrCreateProviderVendorIdFromUrlsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerUrl: "https://new.example.com/v1/responses",
      }),
      expect.objectContaining({ tx: expect.any(Object) })
    );

    expect(ensureProviderEndpointExistsForUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: 11,
        providerType: "codex",
        url: "https://new.example.com/v1/responses",
      }),
      expect.objectContaining({ tx: expect.any(Object) })
    );
  });

  test("createProvider should bubble endpoint seed errors to avoid partial success", async () => {
    vi.resetModules();

    const dbState = createDbMock(createProviderRow());

    vi.doMock("@/drizzle/db", () => ({
      db: dbState.db,
    }));

    const getOrCreateProviderVendorIdFromUrlsMock = vi.fn(async () => 11);
    const ensureProviderEndpointExistsForUrlMock = vi.fn(async () => {
      throw new Error("endpoint seed failed");
    });

    vi.doMock("@/repository/provider-endpoints", () => ({
      getOrCreateProviderVendorIdFromUrls: getOrCreateProviderVendorIdFromUrlsMock,
      ensureProviderEndpointExistsForUrl: ensureProviderEndpointExistsForUrlMock,
      syncProviderEndpointOnProviderEdit: vi.fn(),
      tryDeleteProviderVendorIfEmpty: vi.fn(),
    }));

    const { createProvider } = await import("@/repository/provider");

    await expect(createProvider(createCreateProviderInput())).rejects.toThrow(
      "endpoint seed failed"
    );
    expect(dbState.mocks.transactionMock).toHaveBeenCalledTimes(1);
  });
});
