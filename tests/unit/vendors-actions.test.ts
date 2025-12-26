import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

const createVendorRepositoryMock = vi.fn();
const updateVendorRepositoryMock = vi.fn();
const deleteVendorRepositoryMock = vi.fn();
const findAllVendorsRepositoryMock = vi.fn();
const findVendorByIdRepositoryMock = vi.fn();

vi.mock("@/repository/vendor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/vendor")>();
  return {
    ...actual,
    createVendor: createVendorRepositoryMock,
    updateVendor: updateVendorRepositoryMock,
    deleteVendor: deleteVendorRepositoryMock,
    findAllVendors: findAllVendorsRepositoryMock,
    findVendorById: findVendorByIdRepositoryMock,
  };
});

const createVendorEndpointRepositoryMock = vi.fn();
const updateVendorEndpointRepositoryMock = vi.fn();
const deleteVendorEndpointRepositoryMock = vi.fn();
const findVendorEndpointsByVendorIdRepositoryMock = vi.fn();
const findVendorEndpointByIdRepositoryMock = vi.fn();

vi.mock("@/repository/vendor-endpoint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/vendor-endpoint")>();
  return {
    ...actual,
    createVendorEndpoint: createVendorEndpointRepositoryMock,
    updateVendorEndpoint: updateVendorEndpointRepositoryMock,
    deleteVendorEndpoint: deleteVendorEndpointRepositoryMock,
    findVendorEndpointsByVendorId: findVendorEndpointsByVendorIdRepositoryMock,
    findVendorEndpointById: findVendorEndpointByIdRepositoryMock,
  };
});

const createVendorKeyRepositoryMock = vi.fn();
const updateVendorKeyRepositoryMock = vi.fn();
const deleteVendorKeyRepositoryMock = vi.fn();
const findVendorKeysByVendorIdRepositoryMock = vi.fn();
const findVendorKeyByIdRepositoryMock = vi.fn();

vi.mock("@/repository/vendor-key", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/vendor-key")>();
  return {
    ...actual,
    createVendorKey: createVendorKeyRepositoryMock,
    updateVendorKey: updateVendorKeyRepositoryMock,
    deleteVendorKey: deleteVendorKeyRepositoryMock,
    findVendorKeysByVendorId: findVendorKeysByVendorIdRepositoryMock,
    findVendorKeyById: findVendorKeyByIdRepositoryMock,
  };
});

const createVendorBalanceCheckRepositoryMock = vi.fn();
vi.mock("@/repository/vendor-balance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/vendor-balance")>();
  return {
    ...actual,
    createVendorBalanceCheck: createVendorBalanceCheckRepositoryMock,
  };
});

const upsertRemoteConfigSyncRepositoryMock = vi.fn();
vi.mock("@/repository/remote-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/remote-config")>();
  return {
    ...actual,
    upsertRemoteConfigSync: upsertRemoteConfigSyncRepositoryMock,
  };
});

const syncVendorsMock = vi.fn();
vi.mock("@/lib/remote-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/remote-config")>();
  return {
    ...actual,
    RemoteConfigSyncService: vi.fn().mockImplementation(() => ({
      syncVendors: syncVendorsMock,
    })),
  };
});

describe("vendors (actions)", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    revalidatePathMock.mockReset();

    createVendorRepositoryMock.mockReset();
    updateVendorRepositoryMock.mockReset();
    deleteVendorRepositoryMock.mockReset();
    findAllVendorsRepositoryMock.mockReset();
    findVendorByIdRepositoryMock.mockReset();

    createVendorEndpointRepositoryMock.mockReset();
    updateVendorEndpointRepositoryMock.mockReset();
    deleteVendorEndpointRepositoryMock.mockReset();
    findVendorEndpointsByVendorIdRepositoryMock.mockReset();
    findVendorEndpointByIdRepositoryMock.mockReset();

    createVendorKeyRepositoryMock.mockReset();
    updateVendorKeyRepositoryMock.mockReset();
    deleteVendorKeyRepositoryMock.mockReset();
    findVendorKeysByVendorIdRepositoryMock.mockReset();
    findVendorKeyByIdRepositoryMock.mockReset();

    createVendorBalanceCheckRepositoryMock.mockReset();
    upsertRemoteConfigSyncRepositoryMock.mockReset();
    syncVendorsMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("createVendor rejects non-admin", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "user" } });

    const { createVendor } = await import("@/actions/vendors");
    const result = await createVendor({
      slug: "openai",
      name: "OpenAI",
      category: "official",
    });

    expect(result.ok).toBe(false);
    expect(createVendorRepositoryMock).not.toHaveBeenCalled();
  });

  test("getVendors masks vendor key secrets", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });

    findAllVendorsRepositoryMock.mockResolvedValue([
      {
        id: 10,
        slug: "openai",
        name: "OpenAI",
        description: null,
        category: "official",
        isManaged: false,
        isEnabled: true,
        tags: ["codex"],
        websiteUrl: null,
        faviconUrl: null,
        balanceCheckEnabled: false,
        balanceCheckEndpoint: null,
        balanceCheckJsonpath: null,
        balanceCheckIntervalSeconds: null,
        balanceCheckLowThresholdUsd: null,
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        updatedAt: new Date("2024-01-01T00:00:00.000Z"),
      },
    ]);

    findVendorEndpointsByVendorIdRepositoryMock.mockResolvedValue([]);
    findVendorKeysByVendorIdRepositoryMock.mockResolvedValue([
      {
        id: 123,
        vendorId: 10,
        endpointId: 1,
        isUserOverride: false,
        balanceUsd: null,
        balanceUpdatedAt: null,
        name: "Key 1",
        description: null,
        url: "https://api.openai.com",
        key: "sk-1234567890abcdef",
        isEnabled: true,
        weight: 1,
        priority: 0,
        costMultiplier: 1,
        groupTag: null,
        providerType: "codex",
        preserveClientIp: false,
        modelRedirects: null,
        allowedModels: null,
        joinClaudePool: false,
        codexInstructionsStrategy: "auto",
        mcpPassthroughType: "none",
        mcpPassthroughUrl: null,
        limit5hUsd: null,
        limitDailyUsd: null,
        dailyResetMode: "fixed",
        dailyResetTime: "00:00",
        limitWeeklyUsd: null,
        limitMonthlyUsd: null,
        limitConcurrentSessions: 0,
        maxRetryAttempts: null,
        circuitBreakerFailureThreshold: 5,
        circuitBreakerOpenDuration: 1800000,
        circuitBreakerHalfOpenSuccessThreshold: 2,
        proxyUrl: null,
        proxyFallbackToDirect: false,
        firstByteTimeoutStreamingMs: 0,
        streamingIdleTimeoutMs: 0,
        requestTimeoutNonStreamingMs: 0,
        websiteUrl: null,
        faviconUrl: null,
        cacheTtlPreference: null,
        context1mPreference: null,
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        updatedAt: new Date("2024-01-01T00:00:00.000Z"),
      },
    ]);

    const { getVendors } = await import("@/actions/vendors");
    const result = await getVendors();

    expect(result).toHaveLength(1);
    expect(result[0]?.vendor.slug).toBe("openai");
    expect(result[0]?.keys).toHaveLength(1);
    expect(result[0]?.keys[0]?.maskedKey).toContain("••••••");
    expect("key" in (result[0]?.keys[0] ?? {})).toBe(false);
  });

  test("syncVendorsFromRemote creates vendors and endpoints", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });

    syncVendorsMock.mockResolvedValue({
      ok: true,
      source: "cdn",
      remoteVersion: "v1",
      data: {
        metadata: { version: "v1" },
        vendors: [
          {
            slug: "anthropic",
            name: "Anthropic",
            category: "official",
            tags: ["claude"],
            endpoints: [
              {
                name: "Official API",
                url: "https://api.anthropic.com",
                api_format: "claude",
              },
            ],
            balance_check: {
              enabled: true,
              endpoint: "/v1/usage",
              jsonpath: "$.remaining",
              interval_seconds: 60,
              low_threshold_usd: 10,
            },
          },
        ],
      },
    });

    findAllVendorsRepositoryMock.mockResolvedValue([]);
    createVendorRepositoryMock.mockResolvedValue({
      id: 1,
      slug: "anthropic",
      name: "Anthropic",
      description: null,
      category: "official",
      isManaged: true,
      isEnabled: true,
      tags: ["claude"],
      websiteUrl: null,
      faviconUrl: null,
      balanceCheckEnabled: true,
      balanceCheckEndpoint: "/v1/usage",
      balanceCheckJsonpath: "$.remaining",
      balanceCheckIntervalSeconds: 60,
      balanceCheckLowThresholdUsd: 10,
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    });

    findVendorEndpointsByVendorIdRepositoryMock.mockResolvedValue([]);
    createVendorEndpointRepositoryMock.mockResolvedValue({
      id: 100,
      vendorId: 1,
      name: "Official API",
      url: "https://api.anthropic.com",
      apiFormat: "claude",
      isEnabled: true,
      priority: 0,
      latencyMs: null,
      healthCheckEnabled: false,
      healthCheckEndpoint: null,
      healthCheckIntervalSeconds: null,
      healthCheckTimeoutMs: null,
      healthCheckLastCheckedAt: null,
      healthCheckLastStatusCode: null,
      healthCheckErrorMessage: null,
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    });

    upsertRemoteConfigSyncRepositoryMock.mockResolvedValue({
      id: 1,
      configKey: "vendors",
      remoteVersion: "v1",
      lastAttemptAt: null,
      lastSyncedAt: null,
      lastErrorMessage: null,
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    });

    const { syncVendorsFromRemote } = await import("@/actions/vendors");
    const result = await syncVendorsFromRemote();

    expect(createVendorRepositoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "anthropic", isManaged: true, balanceCheckEnabled: true })
    );
    expect(createVendorEndpointRepositoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: 1,
        url: "https://api.anthropic.com",
        apiFormat: "claude",
      })
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.remoteVersion).toBe("v1");
      expect(result.data.vendors.inserted).toBe(1);
      expect(result.data.endpoints.inserted).toBe(1);
    }
  });

  test("checkVendorBalance performs a balance check and records results", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });

    findVendorKeyByIdRepositoryMock.mockResolvedValue({
      id: 1,
      vendorId: 10,
      endpointId: 100,
      isUserOverride: false,
      balanceUsd: null,
      balanceUpdatedAt: null,
      name: "Key",
      description: null,
      url: "https://api.example/",
      key: "test-key",
      isEnabled: true,
      weight: 1,
      priority: 0,
      costMultiplier: 1,
      groupTag: null,
      providerType: "codex",
      preserveClientIp: false,
      modelRedirects: null,
      allowedModels: null,
      joinClaudePool: false,
      codexInstructionsStrategy: "auto",
      mcpPassthroughType: "none",
      mcpPassthroughUrl: null,
      limit5hUsd: null,
      limitDailyUsd: null,
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitConcurrentSessions: 0,
      maxRetryAttempts: null,
      circuitBreakerFailureThreshold: 5,
      circuitBreakerOpenDuration: 1800000,
      circuitBreakerHalfOpenSuccessThreshold: 2,
      proxyUrl: null,
      proxyFallbackToDirect: false,
      firstByteTimeoutStreamingMs: 0,
      streamingIdleTimeoutMs: 0,
      requestTimeoutNonStreamingMs: 0,
      websiteUrl: null,
      faviconUrl: null,
      cacheTtlPreference: null,
      context1mPreference: null,
      tpm: null,
      rpm: null,
      rpd: null,
      cc: null,
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    });

    findVendorByIdRepositoryMock.mockResolvedValue({
      id: 10,
      slug: "openai",
      name: "OpenAI",
      description: null,
      category: "official",
      isManaged: false,
      isEnabled: true,
      tags: [],
      websiteUrl: null,
      faviconUrl: null,
      balanceCheckEnabled: true,
      balanceCheckEndpoint: "/v1/usage",
      balanceCheckJsonpath: "$.remaining_credits",
      balanceCheckIntervalSeconds: null,
      balanceCheckLowThresholdUsd: null,
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    });

    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ remaining_credits: 12.34 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    updateVendorKeyRepositoryMock.mockResolvedValue({
      id: 1,
      vendorId: 10,
      endpointId: 100,
      isUserOverride: false,
      balanceUsd: 12.34,
      balanceUpdatedAt: new Date("2024-01-01T00:00:00.000Z"),
      name: "Key",
      description: null,
      url: "https://api.example/",
      key: "test-key",
      isEnabled: true,
      weight: 1,
      priority: 0,
      costMultiplier: 1,
      groupTag: null,
      providerType: "codex",
      preserveClientIp: false,
      modelRedirects: null,
      allowedModels: null,
      joinClaudePool: false,
      codexInstructionsStrategy: "auto",
      mcpPassthroughType: "none",
      mcpPassthroughUrl: null,
      limit5hUsd: null,
      limitDailyUsd: null,
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitConcurrentSessions: 0,
      maxRetryAttempts: null,
      circuitBreakerFailureThreshold: 5,
      circuitBreakerOpenDuration: 1800000,
      circuitBreakerHalfOpenSuccessThreshold: 2,
      proxyUrl: null,
      proxyFallbackToDirect: false,
      firstByteTimeoutStreamingMs: 0,
      streamingIdleTimeoutMs: 0,
      requestTimeoutNonStreamingMs: 0,
      websiteUrl: null,
      faviconUrl: null,
      cacheTtlPreference: null,
      context1mPreference: null,
      tpm: null,
      rpm: null,
      rpd: null,
      cc: null,
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    });

    createVendorBalanceCheckRepositoryMock.mockResolvedValue({
      id: 1,
      vendorKeyId: 1,
      vendorId: 10,
      endpointId: 100,
      checkedAt: new Date("2024-01-01T00:00:00.000Z"),
      durationMs: 1,
      statusCode: 200,
      isSuccess: true,
      balanceUsd: 12.34,
      rawResponse: { remaining_credits: 12.34 },
      errorMessage: null,
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
    });

    const { checkVendorBalance } = await import("@/actions/vendors");
    const result = await checkVendorBalance(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.example/v1/usage");

    expect(updateVendorKeyRepositoryMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ balanceUsd: 12.34 })
    );
    expect(createVendorBalanceCheckRepositoryMock).toHaveBeenCalledTimes(1);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.vendorKeyId).toBe(1);
      expect(result.data.ok).toBe(true);
      expect(result.data.balanceUsd).toBeCloseTo(12.34);
    }
  });

  test("createVendorEndpoint creates an endpoint", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });

    createVendorEndpointRepositoryMock.mockResolvedValue({
      id: 100,
      vendorId: 1,
      name: "Official API",
      url: "https://api.anthropic.com",
      apiFormat: "claude",
      isEnabled: true,
      priority: 0,
      latencyMs: null,
      healthCheckEnabled: false,
      healthCheckEndpoint: null,
      healthCheckIntervalSeconds: null,
      healthCheckTimeoutMs: null,
      healthCheckLastCheckedAt: null,
      healthCheckLastStatusCode: null,
      healthCheckErrorMessage: null,
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    });

    const { createVendorEndpoint } = await import("@/actions/vendors");
    const result = await createVendorEndpoint({
      vendorId: 1,
      name: "Official API",
      url: "https://api.anthropic.com",
      apiFormat: "claude",
    });

    expect(createVendorEndpointRepositoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: 1,
        url: "https://api.anthropic.com",
        apiFormat: "claude",
      })
    );
    expect(result.ok).toBe(true);
  });

  test("deleteVendorEndpoint deletes the endpoint", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });

    deleteVendorEndpointRepositoryMock.mockResolvedValue(true);

    const { deleteVendorEndpoint } = await import("@/actions/vendors");
    const result = await deleteVendorEndpoint(100);

    expect(deleteVendorEndpointRepositoryMock).toHaveBeenCalledWith(100);
    expect(result.ok).toBe(true);
  });

  test("createVendorKey returns maskedKey and never returns secret key", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });

    createVendorKeyRepositoryMock.mockResolvedValue({
      id: 123,
      vendorId: 10,
      endpointId: 100,
      isUserOverride: false,
      balanceUsd: null,
      balanceUpdatedAt: null,
      name: "Key 1",
      description: null,
      url: "https://api.openai.com",
      key: "sk-1234567890abcdef",
      isEnabled: true,
      weight: 1,
      priority: 0,
      costMultiplier: 1,
      groupTag: null,
      providerType: "codex",
      preserveClientIp: false,
      modelRedirects: null,
      allowedModels: null,
      joinClaudePool: false,
      codexInstructionsStrategy: "auto",
      mcpPassthroughType: "none",
      mcpPassthroughUrl: null,
      limit5hUsd: null,
      limitDailyUsd: null,
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitConcurrentSessions: 0,
      maxRetryAttempts: null,
      circuitBreakerFailureThreshold: 5,
      circuitBreakerOpenDuration: 1800000,
      circuitBreakerHalfOpenSuccessThreshold: 2,
      proxyUrl: null,
      proxyFallbackToDirect: false,
      firstByteTimeoutStreamingMs: 0,
      streamingIdleTimeoutMs: 0,
      requestTimeoutNonStreamingMs: 0,
      websiteUrl: null,
      faviconUrl: null,
      cacheTtlPreference: null,
      context1mPreference: null,
      tpm: null,
      rpm: null,
      rpd: null,
      cc: null,
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    });

    const { createVendorKey } = await import("@/actions/vendors");
    const result = await createVendorKey({
      vendorId: 10,
      endpointId: 100,
      name: "Key 1",
      url: "https://api.openai.com",
      key: "sk-1234567890abcdef",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.maskedKey).toContain("••••••");
      expect("key" in result.data).toBe(false);
    }
  });

  test("deleteVendorKey deletes the key", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });

    deleteVendorKeyRepositoryMock.mockResolvedValue(true);

    const { deleteVendorKey } = await import("@/actions/vendors");
    const result = await deleteVendorKey(123);

    expect(deleteVendorKeyRepositoryMock).toHaveBeenCalledWith(123);
    expect(result.ok).toBe(true);
  });
});
