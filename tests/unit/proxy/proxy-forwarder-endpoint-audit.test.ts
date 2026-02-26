import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    getPreferredProviderEndpoints: vi.fn(),
    getEndpointFilterStats: vi.fn(async () => null),
    recordEndpointSuccess: vi.fn(async () => {}),
    recordEndpointFailure: vi.fn(async () => {}),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(async () => {}),
    getCircuitState: vi.fn(() => "closed"),
    getProviderHealthInfo: vi.fn(async () => ({
      health: { failureCount: 0 },
      config: { failureThreshold: 3 },
    })),
    isVendorTypeCircuitOpen: vi.fn(async () => false),
    recordVendorTypeAllEndpointsTimeout: vi.fn(async () => {}),
    categorizeErrorAsync: vi.fn(),
  };
});

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("@/lib/provider-endpoints/endpoint-selector", () => ({
  getPreferredProviderEndpoints: mocks.getPreferredProviderEndpoints,
  getEndpointFilterStats: mocks.getEndpointFilterStats,
}));

vi.mock("@/lib/endpoint-circuit-breaker", () => ({
  recordEndpointSuccess: mocks.recordEndpointSuccess,
  recordEndpointFailure: mocks.recordEndpointFailure,
}));

vi.mock("@/lib/circuit-breaker", () => ({
  getCircuitState: mocks.getCircuitState,
  getProviderHealthInfo: mocks.getProviderHealthInfo,
  recordSuccess: mocks.recordSuccess,
  recordFailure: mocks.recordFailure,
}));

vi.mock("@/lib/vendor-type-circuit-breaker", () => ({
  isVendorTypeCircuitOpen: mocks.isVendorTypeCircuitOpen,
  recordVendorTypeAllEndpointsTimeout: mocks.recordVendorTypeAllEndpointsTimeout,
}));

vi.mock("@/app/v1/_lib/proxy/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/v1/_lib/proxy/errors")>();
  return {
    ...actual,
    categorizeErrorAsync: mocks.categorizeErrorAsync,
  };
});

import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ProxyError } from "@/app/v1/_lib/proxy/errors";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import { logger } from "@/lib/logger";
import type { Provider, ProviderEndpoint, ProviderType } from "@/types/provider";

function makeEndpoint(input: {
  id: number;
  vendorId: number;
  providerType: ProviderType;
  url: string;
}): ProviderEndpoint {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: input.id,
    vendorId: input.vendorId,
    providerType: input.providerType,
    url: input.url,
    label: null,
    sortOrder: 0,
    isEnabled: true,
    lastProbedAt: null,
    lastProbeOk: null,
    lastProbeStatusCode: null,
    lastProbeLatencyMs: null,
    lastProbeErrorType: null,
    lastProbeErrorMessage: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 1,
    name: "p1",
    url: "https://provider.example.com",
    key: "k",
    providerVendorId: 123,
    isEnabled: true,
    weight: 1,
    priority: 0,
    costMultiplier: 1,
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
    circuitBreakerOpenDuration: 1_800_000,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    firstByteTimeoutStreamingMs: 30_000,
    streamingIdleTimeoutMs: 10_000,
    requestTimeoutNonStreamingMs: 600_000,
    websiteUrl: null,
    faviconUrl: null,
    cacheTtlPreference: null,
    context1mPreference: null,
    codexReasoningEffortPreference: null,
    codexReasoningSummaryPreference: null,
    codexTextVerbosityPreference: null,
    codexParallelToolCallsPreference: null,
    tpm: 0,
    rpm: 0,
    rpd: 0,
    cc: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function createSession(requestUrl: URL = new URL("https://example.com/v1/messages")): ProxySession {
  const headers = new Headers();
  const session = Object.create(ProxySession.prototype);

  Object.assign(session, {
    startTime: Date.now(),
    method: "POST",
    requestUrl,
    headers,
    originalHeaders: new Headers(headers),
    headerLog: JSON.stringify(Object.fromEntries(headers.entries())),
    request: {
      model: "model-x",
      log: "(test)",
      message: {
        model: "model-x",
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "ok" },
        ],
      },
    },
    userAgent: null,
    context: null,
    clientAbortSignal: null,
    userName: "test-user",
    authState: { success: true, user: null, key: null, apiKey: null },
    provider: null,
    messageContext: null,
    sessionId: null,
    requestSequence: 1,
    originalFormat: "claude",
    providerType: null,
    originalModelName: null,
    originalUrlPathname: null,
    providerChain: [],
    cacheTtlResolved: null,
    context1mApplied: false,
    specialSettings: [],
    cachedPriceData: undefined,
    cachedBillingModelSource: undefined,
    isHeaderModified: () => false,
  });

  return session as ProxySession;
}

describe("ProxyForwarder - endpoint audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("成功时应记录 endpointId 且对 endpointUrl 做脱敏", async () => {
    const session = createSession();
    const provider = createProvider({ providerType: "claude", providerVendorId: 123 });
    session.setProvider(provider);

    mocks.getPreferredProviderEndpoints.mockResolvedValue([
      makeEndpoint({
        id: 42,
        vendorId: 123,
        providerType: provider.providerType,
        url: "https://api.example.com/v1/messages?api_key=SECRET&foo=bar",
      }),
    ]);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
      "doForward"
    );
    doForward.mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "2",
        },
      })
    );

    const response = await ProxyForwarder.send(session);
    expect(response.status).toBe(200);

    const chain = session.getProviderChain();
    expect(chain).toHaveLength(1);

    const item = chain[0];
    expect(item).toEqual(
      expect.objectContaining({
        reason: "request_success",
        attemptNumber: 1,
        statusCode: 200,
        vendorId: 123,
        providerType: "claude",
        endpointId: 42,
      })
    );

    expect(item.endpointUrl).toContain("[REDACTED]");
    expect(item.endpointUrl).not.toContain("SECRET");
  });

  test("重试时应分别记录每次 attempt 的 endpoint 审计字段", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession(new URL("https://example.com/v1/chat/completions"));
      const provider = createProvider({
        providerType: "openai-compatible",
        providerVendorId: 123,
      });
      session.setProvider(provider);

      mocks.getPreferredProviderEndpoints.mockResolvedValue([
        makeEndpoint({
          id: 1,
          vendorId: 123,
          providerType: provider.providerType,
          url: "https://api.example.com/v1?token=SECRET_1",
        }),
        makeEndpoint({
          id: 2,
          vendorId: 123,
          providerType: provider.providerType,
          url: "https://api.example.com/v1?api_key=SECRET_2",
        }),
      ]);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );
      // Throw network error (SYSTEM_ERROR) to trigger endpoint switching
      // PROVIDER_ERROR (HTTP 4xx/5xx) doesn't trigger endpoint switch, only SYSTEM_ERROR does
      doForward.mockImplementationOnce(async () => {
        const err = new Error("ECONNREFUSED") as NodeJS.ErrnoException;
        err.code = "ECONNREFUSED";
        throw err;
      });
      // Configure categorizeErrorAsync to return SYSTEM_ERROR for network errors
      mocks.categorizeErrorAsync.mockResolvedValueOnce(1); // ErrorCategory.SYSTEM_ERROR = 1
      doForward.mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-length": "2",
          },
        })
      );

      const sendPromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(100);
      const response = await sendPromise;
      expect(response.status).toBe(200);

      const chain = session.getProviderChain();
      expect(chain).toHaveLength(2);

      const first = chain[0];
      const second = chain[1];

      expect(first).toEqual(
        expect.objectContaining({
          reason: "system_error",
          attemptNumber: 1,
          vendorId: 123,
          providerType: "openai-compatible",
          endpointId: 1,
        })
      );
      expect(first.endpointUrl).toContain("[REDACTED]");
      expect(first.endpointUrl).not.toContain("SECRET_1");

      expect(second).toEqual(
        expect.objectContaining({
          reason: "retry_success",
          attemptNumber: 2,
          vendorId: 123,
          providerType: "openai-compatible",
          endpointId: 2,
        })
      );
      expect(second.endpointUrl).toContain("[REDACTED]");
      expect(second.endpointUrl).not.toContain("SECRET_2");
    } finally {
      vi.useRealTimers();
    }
  });

  test("MCP 请求应保持 provider.url 语义，不触发 strict endpoint 拦截", async () => {
    const requestPath = "/mcp/custom-endpoint";
    const session = createSession(new URL(`https://example.com${requestPath}`));
    const provider = createProvider({
      providerType: "claude",
      providerVendorId: 123,
      url: `https://provider.example.com${requestPath}?key=SECRET`,
    });
    session.setProvider(provider);

    mocks.getPreferredProviderEndpoints.mockResolvedValueOnce([
      makeEndpoint({
        id: 99,
        vendorId: 123,
        providerType: "claude",
        url: "https://ep99.example.com",
      }),
    ]);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
      "doForward"
    );
    doForward.mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "2",
        },
      })
    );

    const response = await ProxyForwarder.send(session);
    expect(response.status).toBe(200);
    expect(mocks.getPreferredProviderEndpoints).not.toHaveBeenCalled();

    const chain = session.getProviderChain();
    expect(chain).toHaveLength(1);
    expect(chain[0]).toEqual(
      expect.objectContaining({
        endpointId: null,
        reason: "request_success",
      })
    );

    const warnMessages = vi.mocked(logger.warn).mock.calls.map(([message]) => message);
    expect(warnMessages).not.toContain(
      "ProxyForwarder: Strict endpoint policy blocked legacy provider.url fallback"
    );
  });

  test.each([
    { requestPath: "/v1/messages", providerType: "claude" as const },
    { requestPath: "/v1/responses", providerType: "codex" as const },
    { requestPath: "/v1/chat/completions", providerType: "openai-compatible" as const },
  ])("标准端点 $requestPath: endpoint 选择失败时不应静默回退到 provider.url", async ({
    requestPath,
    providerType,
  }) => {
    const session = createSession(new URL(`https://example.com${requestPath}`));
    const provider = createProvider({
      providerType,
      providerVendorId: 123,
      url: `https://provider.example.com${requestPath}?key=SECRET`,
    });
    session.setProvider(provider);

    mocks.getPreferredProviderEndpoints.mockRejectedValueOnce(new Error("boom"));

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
      "doForward"
    );
    doForward.mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "2",
        },
      })
    );

    const rejected = await ProxyForwarder.send(session)
      .then(() => false)
      .catch(() => true);

    expect(rejected, `标准端点 ${requestPath} endpoint 选择失败后不允许静默回退 provider.url`).toBe(
      true
    );
    expect(doForward).not.toHaveBeenCalled();

    expect(logger.warn).toHaveBeenCalledWith(
      "[ProxyForwarder] Failed to load provider endpoints",
      expect.objectContaining({
        providerId: provider.id,
        vendorId: 123,
        providerType,
        strictEndpointPolicy: true,
        reason: "selector_error",
        error: "boom",
      })
    );

    expect(logger.warn).toHaveBeenCalledWith(
      "ProxyForwarder: Strict endpoint policy blocked legacy provider.url fallback",
      expect.objectContaining({
        providerId: provider.id,
        vendorId: 123,
        providerType,
        requestPath,
        reason: "strict_blocked_legacy_fallback",
        strictBlockCause: "selector_error",
        selectorError: "boom",
      })
    );
  });

  test("标准端点空候选应记录 no_endpoint_candidates 且不混淆为 selector_error", async () => {
    const requestPath = "/v1/messages";
    const providerType = "claude" as const;
    const session = createSession(new URL(`https://example.com${requestPath}`));
    const provider = createProvider({
      providerType,
      providerVendorId: 123,
      url: "https://provider.example.com/v1/messages?key=SECRET",
    });
    session.setProvider(provider);

    mocks.getPreferredProviderEndpoints.mockResolvedValueOnce([]);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
      "doForward"
    );
    doForward.mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "2",
        },
      })
    );

    const rejected = await ProxyForwarder.send(session)
      .then(() => false)
      .catch(() => true);

    expect(rejected).toBe(true);
    expect(doForward).not.toHaveBeenCalled();

    expect(logger.warn).toHaveBeenCalledWith(
      "ProxyForwarder: Strict endpoint policy blocked legacy provider.url fallback",
      expect.objectContaining({
        providerId: provider.id,
        vendorId: 123,
        providerType,
        requestPath,
        reason: "strict_blocked_legacy_fallback",
        strictBlockCause: "no_endpoint_candidates",
        selectorError: undefined,
      })
    );

    const warnMessages = vi.mocked(logger.warn).mock.calls.map(([message]) => message);
    expect(warnMessages).not.toContain("[ProxyForwarder] Failed to load provider endpoints");
  });

  test("endpoint pool exhausted (no_endpoint_candidates) should record endpoint_pool_exhausted in provider chain", async () => {
    const requestPath = "/v1/messages";
    const session = createSession(new URL(`https://example.com${requestPath}`));
    const provider = createProvider({
      providerType: "claude",
      providerVendorId: 123,
      url: "https://provider.example.com/v1/messages",
    });
    session.setProvider(provider);

    // Return empty array => no_endpoint_candidates
    mocks.getPreferredProviderEndpoints.mockResolvedValueOnce([]);
    mocks.getEndpointFilterStats.mockResolvedValueOnce({
      total: 3,
      enabled: 2,
      circuitOpen: 2,
      available: 0,
    });

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
      "doForward"
    );

    await expect(ProxyForwarder.send(session)).rejects.toThrow();

    expect(doForward).not.toHaveBeenCalled();

    const chain = session.getProviderChain();
    const exhaustedItem = chain.find((item) => item.reason === "endpoint_pool_exhausted");
    expect(exhaustedItem).toBeDefined();
    expect(exhaustedItem).toEqual(
      expect.objectContaining({
        id: provider.id,
        name: provider.name,
        vendorId: 123,
        providerType: "claude",
        reason: "endpoint_pool_exhausted",
        strictBlockCause: "no_endpoint_candidates",
      })
    );

    // endpointFilterStats should be present at top level
    expect(exhaustedItem!.endpointFilterStats).toEqual({
      total: 3,
      enabled: 2,
      circuitOpen: 2,
      available: 0,
    });

    // errorMessage should be undefined for no_endpoint_candidates (no exception)
    expect(exhaustedItem!.errorMessage).toBeUndefined();
  });

  test("endpoint_pool_exhausted should not be deduped away when initial_selection already recorded", async () => {
    const requestPath = "/v1/messages";
    const session = createSession(new URL(`https://example.com${requestPath}`));
    const provider = createProvider({
      providerType: "claude",
      providerVendorId: 123,
      url: "https://provider.example.com/v1/messages",
    });
    session.setProvider(provider);

    // Simulate ProviderSelector already recorded initial_selection for the same provider
    session.addProviderToChain(provider, { reason: "initial_selection" });

    mocks.getPreferredProviderEndpoints.mockResolvedValueOnce([]);
    mocks.getEndpointFilterStats.mockResolvedValueOnce({
      total: 0,
      enabled: 0,
      circuitOpen: 0,
      available: 0,
    });

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
      "doForward"
    );

    await expect(ProxyForwarder.send(session)).rejects.toThrow();

    expect(doForward).not.toHaveBeenCalled();

    const chain = session.getProviderChain();
    expect(chain.some((item) => item.reason === "initial_selection")).toBe(true);

    const exhaustedItems = chain.filter((item) => item.reason === "endpoint_pool_exhausted");
    expect(exhaustedItems).toHaveLength(1);

    expect(exhaustedItems[0]).toEqual(
      expect.objectContaining({
        id: provider.id,
        name: provider.name,
        reason: "endpoint_pool_exhausted",
        strictBlockCause: "no_endpoint_candidates",
        attemptNumber: 1,
        endpointFilterStats: {
          total: 0,
          enabled: 0,
          circuitOpen: 0,
          available: 0,
        },
      })
    );
  });

  test("endpoint pool exhausted (selector_error) should record endpoint_pool_exhausted with selectorError in decisionContext", async () => {
    const requestPath = "/v1/responses";
    const session = createSession(new URL(`https://example.com${requestPath}`));
    const provider = createProvider({
      providerType: "codex",
      providerVendorId: 456,
      url: "https://provider.example.com/v1/responses",
    });
    session.setProvider(provider);

    // Throw error => selector_error cause
    mocks.getPreferredProviderEndpoints.mockRejectedValueOnce(new Error("Redis connection lost"));

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
      "doForward"
    );

    await expect(ProxyForwarder.send(session)).rejects.toThrow();

    expect(doForward).not.toHaveBeenCalled();

    const chain = session.getProviderChain();
    const exhaustedItem = chain.find((item) => item.reason === "endpoint_pool_exhausted");
    expect(exhaustedItem).toBeDefined();
    expect(exhaustedItem).toEqual(
      expect.objectContaining({
        id: provider.id,
        name: provider.name,
        vendorId: 456,
        providerType: "codex",
        reason: "endpoint_pool_exhausted",
        strictBlockCause: "selector_error",
      })
    );

    // selector_error should NOT call getEndpointFilterStats (exception path, no data available)
    // endpointFilterStats should be undefined for selector_error
    expect(exhaustedItem!.endpointFilterStats).toBeUndefined();

    // errorMessage should contain the selector error message
    expect(exhaustedItem!.errorMessage).toBe("Redis connection lost");
  });

  test("selector_error and no_endpoint_candidates are correctly distinguished in provider chain", async () => {
    // Test 1: selector_error (exception thrown)
    const session1 = createSession(new URL("https://example.com/v1/chat/completions"));
    const provider1 = createProvider({
      id: 10,
      name: "p-selector-err",
      providerType: "openai-compatible",
      providerVendorId: 789,
    });
    session1.setProvider(provider1);
    mocks.getPreferredProviderEndpoints.mockRejectedValueOnce(new Error("timeout"));

    await expect(ProxyForwarder.send(session1)).rejects.toThrow();

    const chain1 = session1.getProviderChain();
    const item1 = chain1.find((i) => i.reason === "endpoint_pool_exhausted");
    expect(item1).toBeDefined();
    expect(item1!.strictBlockCause).toBe("selector_error");
    expect(item1!.endpointFilterStats).toBeUndefined();
    expect(item1!.errorMessage).toBe("timeout");

    // Test 2: no_endpoint_candidates (empty array returned)
    const session2 = createSession(new URL("https://example.com/v1/chat/completions"));
    const provider2 = createProvider({
      id: 20,
      name: "p-empty-pool",
      providerType: "openai-compatible",
      providerVendorId: 789,
    });
    session2.setProvider(provider2);
    mocks.getPreferredProviderEndpoints.mockResolvedValueOnce([]);
    mocks.getEndpointFilterStats.mockResolvedValueOnce({
      total: 5,
      enabled: 3,
      circuitOpen: 3,
      available: 0,
    });

    await expect(ProxyForwarder.send(session2)).rejects.toThrow();

    const chain2 = session2.getProviderChain();
    const item2 = chain2.find((i) => i.reason === "endpoint_pool_exhausted");
    expect(item2).toBeDefined();
    expect(item2!.strictBlockCause).toBe("no_endpoint_candidates");
    expect(item2!.endpointFilterStats).toEqual({
      total: 5,
      enabled: 3,
      circuitOpen: 3,
      available: 0,
    });
    expect(item2!.errorMessage).toBeUndefined();
  });

  test("endpointFilterStats should gracefully handle getEndpointFilterStats failure", async () => {
    const requestPath = "/v1/messages";
    const session = createSession(new URL(`https://example.com${requestPath}`));
    const provider = createProvider({
      providerType: "claude",
      providerVendorId: 123,
      url: "https://provider.example.com/v1/messages",
    });
    session.setProvider(provider);

    mocks.getPreferredProviderEndpoints.mockResolvedValueOnce([]);
    // Stats call fails - should not break the flow
    mocks.getEndpointFilterStats.mockRejectedValueOnce(new Error("DB unavailable"));

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
      "doForward"
    );

    await expect(ProxyForwarder.send(session)).rejects.toThrow();

    expect(doForward).not.toHaveBeenCalled();

    const chain = session.getProviderChain();
    const exhaustedItem = chain.find((item) => item.reason === "endpoint_pool_exhausted");
    expect(exhaustedItem).toBeDefined();
    expect(exhaustedItem!.strictBlockCause).toBe("no_endpoint_candidates");
    // endpointFilterStats should be undefined when stats call fails
    expect(exhaustedItem!.endpointFilterStats).toBeUndefined();
  });

  test("/v1/responses/compact should use endpoint pool (not MCP path)", async () => {
    const session = createSession(new URL("https://example.com/v1/responses/compact"));
    const provider = createProvider({ providerType: "claude", providerVendorId: 123 });
    session.setProvider(provider);

    mocks.getPreferredProviderEndpoints.mockResolvedValue([
      makeEndpoint({
        id: 77,
        vendorId: 123,
        providerType: provider.providerType,
        url: "https://api.example.com/v1/responses/compact",
      }),
    ]);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
      "doForward"
    );
    doForward.mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "2",
        },
      })
    );

    const response = await ProxyForwarder.send(session);
    expect(response.status).toBe(200);

    expect(mocks.getPreferredProviderEndpoints).toHaveBeenCalled();

    const chain = session.getProviderChain();
    expect(chain).toHaveLength(1);
    expect(chain[0]).toEqual(
      expect.objectContaining({
        reason: "request_success",
        endpointId: 77,
      })
    );
  });
});
