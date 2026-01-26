import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    getPreferredProviderEndpoints: vi.fn(),
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
    findAllProviders: vi.fn(async () => []),
    getCachedProviders: vi.fn(async () => []),
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

vi.mock("@/repository/provider", () => ({
  findAllProviders: mocks.findAllProviders,
}));

vi.mock("@/lib/cache/provider-cache", () => ({
  getCachedProviders: mocks.getCachedProviders,
}));

vi.mock("@/app/v1/_lib/proxy/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/v1/_lib/proxy/errors")>();
  return {
    ...actual,
    categorizeErrorAsync: vi.fn(async () => actual.ErrorCategory.PROVIDER_ERROR),
  };
});

import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ProxyError, ErrorCategory, categorizeErrorAsync } from "@/app/v1/_lib/proxy/errors";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider, ProviderEndpoint, ProviderType } from "@/types/provider";

function makeEndpoint(input: {
  id: number;
  vendorId: number;
  providerType: ProviderType;
  url: string;
  lastProbeLatencyMs?: number | null;
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
    lastProbeOk: true,
    lastProbeStatusCode: 200,
    lastProbeLatencyMs: input.lastProbeLatencyMs ?? null,
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
    name: "test-provider",
    url: "https://provider.example.com",
    key: "test-key",
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
      model: "claude-3-opus",
      log: "(test)",
      message: {
        model: "claude-3-opus",
        messages: [{ role: "user", content: "hello" }],
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
    providersSnapshot: [],
    isHeaderModified: () => false,
  });

  return session as ProxySession;
}

describe("ProxyForwarder - retry limit enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("endpoints > maxRetry: should only use top N lowest-latency endpoints", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      // Configure provider with maxRetryAttempts=2 but 4 endpoints available
      const provider = createProvider({
        providerType: "claude",
        providerVendorId: 123,
        maxRetryAttempts: 2,
      });
      session.setProvider(provider);

      // Return 4 endpoints sorted by latency (lowest first)
      mocks.getPreferredProviderEndpoints.mockResolvedValue([
        makeEndpoint({
          id: 1,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep1.example.com",
          lastProbeLatencyMs: 100,
        }),
        makeEndpoint({
          id: 2,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep2.example.com",
          lastProbeLatencyMs: 200,
        }),
        makeEndpoint({
          id: 3,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep3.example.com",
          lastProbeLatencyMs: 300,
        }),
        makeEndpoint({
          id: 4,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep4.example.com",
          lastProbeLatencyMs: 400,
        }),
      ]);

      // Use SYSTEM_ERROR to trigger endpoint switching on retry
      vi.mocked(categorizeErrorAsync).mockResolvedValue(ErrorCategory.SYSTEM_ERROR);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );

      // Create a network-like error
      const networkError = new TypeError("fetch failed");
      Object.assign(networkError, { code: "ECONNREFUSED" });

      // First attempt fails with network error, second succeeds
      doForward.mockImplementationOnce(async () => {
        throw networkError;
      });
      doForward.mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "2" },
        })
      );

      const sendPromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(100);
      const response = await sendPromise;

      expect(response.status).toBe(200);
      // Should only call doForward twice (maxRetryAttempts=2)
      expect(doForward).toHaveBeenCalledTimes(2);

      const chain = session.getProviderChain();
      expect(chain).toHaveLength(2);

      // First attempt should use endpoint 1 (lowest latency)
      expect(chain[0].endpointId).toBe(1);
      expect(chain[0].attemptNumber).toBe(1);

      // Second attempt should use endpoint 2 (SYSTEM_ERROR advances endpoint)
      expect(chain[1].endpointId).toBe(2);
      expect(chain[1].attemptNumber).toBe(2);

      // Endpoints 3 and 4 should NOT be used
    } finally {
      vi.useRealTimers();
    }
  });

  test("endpoints < maxRetry: should stay at last endpoint after exhausting all (no wrap-around)", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      // Configure provider with maxRetryAttempts=5 but only 2 endpoints
      const provider = createProvider({
        providerType: "claude",
        providerVendorId: 123,
        maxRetryAttempts: 5,
      });
      session.setProvider(provider);

      mocks.getPreferredProviderEndpoints.mockResolvedValue([
        makeEndpoint({
          id: 1,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep1.example.com",
          lastProbeLatencyMs: 100,
        }),
        makeEndpoint({
          id: 2,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep2.example.com",
          lastProbeLatencyMs: 200,
        }),
      ]);

      // Use SYSTEM_ERROR to trigger endpoint switching
      vi.mocked(categorizeErrorAsync).mockResolvedValue(ErrorCategory.SYSTEM_ERROR);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );

      const networkError = new TypeError("fetch failed");
      Object.assign(networkError, { code: "ECONNREFUSED" });

      // All attempts fail except the last one
      doForward.mockImplementation(async () => {
        throw networkError;
      });
      // 5th attempt succeeds
      doForward.mockImplementationOnce(async () => {
        throw networkError;
      });
      doForward.mockImplementationOnce(async () => {
        throw networkError;
      });
      doForward.mockImplementationOnce(async () => {
        throw networkError;
      });
      doForward.mockImplementationOnce(async () => {
        throw networkError;
      });
      doForward.mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "2" },
        })
      );

      const sendPromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(500);
      const response = await sendPromise;

      expect(response.status).toBe(200);
      // Should call doForward 5 times (maxRetryAttempts=5)
      expect(doForward).toHaveBeenCalledTimes(5);

      const chain = session.getProviderChain();
      expect(chain).toHaveLength(5);

      // Verify NO wrap-around pattern: 1, 2, 2, 2, 2 (stays at last endpoint)
      expect(chain[0].endpointId).toBe(1);
      expect(chain[1].endpointId).toBe(2);
      expect(chain[2].endpointId).toBe(2); // stays at endpoint 2
      expect(chain[3].endpointId).toBe(2);
      expect(chain[4].endpointId).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("endpoints = maxRetry: each endpoint should be tried exactly once with SYSTEM_ERROR", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      // Configure provider with maxRetryAttempts=3 and 3 endpoints
      const provider = createProvider({
        providerType: "claude",
        providerVendorId: 123,
        maxRetryAttempts: 3,
      });
      session.setProvider(provider);

      mocks.getPreferredProviderEndpoints.mockResolvedValue([
        makeEndpoint({
          id: 1,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep1.example.com",
          lastProbeLatencyMs: 100,
        }),
        makeEndpoint({
          id: 2,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep2.example.com",
          lastProbeLatencyMs: 200,
        }),
        makeEndpoint({
          id: 3,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep3.example.com",
          lastProbeLatencyMs: 300,
        }),
      ]);

      // Use SYSTEM_ERROR to trigger endpoint switching
      vi.mocked(categorizeErrorAsync).mockResolvedValue(ErrorCategory.SYSTEM_ERROR);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );

      const networkError = new TypeError("fetch failed");
      Object.assign(networkError, { code: "ECONNREFUSED" });

      // First two fail with network error, third succeeds
      doForward.mockImplementationOnce(async () => {
        throw networkError;
      });
      doForward.mockImplementationOnce(async () => {
        throw networkError;
      });
      doForward.mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "2" },
        })
      );

      const sendPromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(300);
      const response = await sendPromise;

      expect(response.status).toBe(200);
      expect(doForward).toHaveBeenCalledTimes(3);

      const chain = session.getProviderChain();
      expect(chain).toHaveLength(3);

      // Each endpoint tried exactly once (SYSTEM_ERROR advances endpoint)
      expect(chain[0].endpointId).toBe(1);
      expect(chain[1].endpointId).toBe(2);
      expect(chain[2].endpointId).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test("MCP request: should use provider.url only, ignore vendor endpoints", async () => {
    const session = createSession(new URL("https://example.com/mcp/custom-endpoint"));
    const provider = createProvider({
      providerType: "claude",
      providerVendorId: 123,
      maxRetryAttempts: 2,
      url: "https://provider.example.com/mcp",
    });
    session.setProvider(provider);

    // Even if endpoints are available, MCP should not use them
    mocks.getPreferredProviderEndpoints.mockResolvedValue([
      makeEndpoint({
        id: 1,
        vendorId: 123,
        providerType: "claude",
        url: "https://ep1.example.com",
      }),
      makeEndpoint({
        id: 2,
        vendorId: 123,
        providerType: "claude",
        url: "https://ep2.example.com",
      }),
    ]);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
      "doForward"
    );
    doForward.mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "2" },
      })
    );

    const response = await ProxyForwarder.send(session);
    expect(response.status).toBe(200);

    // getPreferredProviderEndpoints should NOT be called for MCP requests
    expect(mocks.getPreferredProviderEndpoints).not.toHaveBeenCalled();

    const chain = session.getProviderChain();
    expect(chain).toHaveLength(1);
    // endpointId should be null (using provider.url)
    expect(chain[0].endpointId).toBeNull();
  });

  test("no vendor endpoints: should use provider.url with configured maxRetry", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      // Provider without vendorId
      const provider = createProvider({
        providerType: "claude",
        providerVendorId: null as unknown as number,
        maxRetryAttempts: 3,
        url: "https://provider.example.com",
      });
      session.setProvider(provider);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );

      // First two fail, third succeeds
      doForward.mockImplementationOnce(async () => {
        throw new ProxyError("failed", 500);
      });
      doForward.mockImplementationOnce(async () => {
        throw new ProxyError("failed", 500);
      });
      doForward.mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "2" },
        })
      );

      const sendPromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(300);
      const response = await sendPromise;

      expect(response.status).toBe(200);
      // Should retry up to maxRetryAttempts times
      expect(doForward).toHaveBeenCalledTimes(3);

      // getPreferredProviderEndpoints should NOT be called (no vendorId)
      expect(mocks.getPreferredProviderEndpoints).not.toHaveBeenCalled();

      const chain = session.getProviderChain();
      expect(chain).toHaveLength(3);
      // All attempts should use provider.url (endpointId=null)
      expect(chain[0].endpointId).toBeNull();
      expect(chain[1].endpointId).toBeNull();
      expect(chain[2].endpointId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("all retries exhausted: should not exceed maxRetryAttempts", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      const provider = createProvider({
        providerType: "claude",
        providerVendorId: 123,
        maxRetryAttempts: 2,
      });
      session.setProvider(provider);

      // 4 endpoints available but maxRetry=2
      mocks.getPreferredProviderEndpoints.mockResolvedValue([
        makeEndpoint({
          id: 1,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep1.example.com",
          lastProbeLatencyMs: 100,
        }),
        makeEndpoint({
          id: 2,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep2.example.com",
          lastProbeLatencyMs: 200,
        }),
        makeEndpoint({
          id: 3,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep3.example.com",
          lastProbeLatencyMs: 300,
        }),
        makeEndpoint({
          id: 4,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep4.example.com",
          lastProbeLatencyMs: 400,
        }),
      ]);

      // Use SYSTEM_ERROR to trigger endpoint switching
      vi.mocked(categorizeErrorAsync).mockResolvedValue(ErrorCategory.SYSTEM_ERROR);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );

      const networkError = new TypeError("fetch failed");
      Object.assign(networkError, { code: "ECONNREFUSED" });

      // All attempts fail
      doForward.mockImplementation(async () => {
        throw networkError;
      });

      const sendPromise = ProxyForwarder.send(session);
      // Attach catch handler immediately to prevent unhandled rejection warnings
      let caughtError: Error | null = null;
      sendPromise.catch((e) => {
        caughtError = e;
      });
      await vi.runAllTimersAsync();

      expect(caughtError).not.toBeNull();
      expect(caughtError).toBeInstanceOf(ProxyError);

      // Should only call doForward twice (maxRetryAttempts=2), NOT 4 times
      expect(doForward).toHaveBeenCalledTimes(2);

      const chain = session.getProviderChain();
      // Only 2 attempts recorded
      expect(chain).toHaveLength(2);
      expect(chain[0].endpointId).toBe(1);
      expect(chain[1].endpointId).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ProxyForwarder - endpoint stickiness on retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default PROVIDER_ERROR behavior
    vi.mocked(categorizeErrorAsync).mockResolvedValue(ErrorCategory.PROVIDER_ERROR);
  });

  test("SYSTEM_ERROR: should switch to next endpoint on each network error retry", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      const provider = createProvider({
        providerType: "claude",
        providerVendorId: 123,
        maxRetryAttempts: 3,
      });
      session.setProvider(provider);

      // 3 endpoints sorted by latency
      mocks.getPreferredProviderEndpoints.mockResolvedValue([
        makeEndpoint({
          id: 1,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep1.example.com",
          lastProbeLatencyMs: 100,
        }),
        makeEndpoint({
          id: 2,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep2.example.com",
          lastProbeLatencyMs: 200,
        }),
        makeEndpoint({
          id: 3,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep3.example.com",
          lastProbeLatencyMs: 300,
        }),
      ]);

      // Mock categorizeErrorAsync to return SYSTEM_ERROR (network error)
      vi.mocked(categorizeErrorAsync).mockResolvedValue(ErrorCategory.SYSTEM_ERROR);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );

      // Create a network-like error (not ProxyError)
      const networkError = new TypeError("fetch failed");
      Object.assign(networkError, { code: "ECONNREFUSED" });

      // First two fail with network error, third succeeds
      doForward.mockImplementationOnce(async () => {
        throw networkError;
      });
      doForward.mockImplementationOnce(async () => {
        throw networkError;
      });
      doForward.mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "2" },
        })
      );

      const sendPromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(300);
      const response = await sendPromise;

      expect(response.status).toBe(200);
      expect(doForward).toHaveBeenCalledTimes(3);

      const chain = session.getProviderChain();
      expect(chain).toHaveLength(3);

      // Network error should switch to next endpoint on each retry
      // attempt 1: endpoint 1, attempt 2: endpoint 2, attempt 3: endpoint 3
      expect(chain[0].endpointId).toBe(1);
      expect(chain[0].attemptNumber).toBe(1);
      expect(chain[1].endpointId).toBe(2);
      expect(chain[1].attemptNumber).toBe(2);
      expect(chain[2].endpointId).toBe(3);
      expect(chain[2].attemptNumber).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test("PROVIDER_ERROR: should keep same endpoint on non-network error retry", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      const provider = createProvider({
        providerType: "claude",
        providerVendorId: 123,
        maxRetryAttempts: 3,
      });
      session.setProvider(provider);

      // 3 endpoints sorted by latency
      mocks.getPreferredProviderEndpoints.mockResolvedValue([
        makeEndpoint({
          id: 1,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep1.example.com",
          lastProbeLatencyMs: 100,
        }),
        makeEndpoint({
          id: 2,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep2.example.com",
          lastProbeLatencyMs: 200,
        }),
        makeEndpoint({
          id: 3,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep3.example.com",
          lastProbeLatencyMs: 300,
        }),
      ]);

      // Mock categorizeErrorAsync to return PROVIDER_ERROR (HTTP error, not network)
      vi.mocked(categorizeErrorAsync).mockResolvedValue(ErrorCategory.PROVIDER_ERROR);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );

      // First two fail with HTTP 500, third succeeds
      doForward.mockImplementationOnce(async () => {
        throw new ProxyError("server error", 500);
      });
      doForward.mockImplementationOnce(async () => {
        throw new ProxyError("server error", 500);
      });
      doForward.mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "2" },
        })
      );

      const sendPromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(300);
      const response = await sendPromise;

      expect(response.status).toBe(200);
      expect(doForward).toHaveBeenCalledTimes(3);

      const chain = session.getProviderChain();
      expect(chain).toHaveLength(3);

      // Non-network error should keep same endpoint on all retries
      // All 3 attempts should use endpoint 1 (sticky)
      expect(chain[0].endpointId).toBe(1);
      expect(chain[0].attemptNumber).toBe(1);
      expect(chain[1].endpointId).toBe(1);
      expect(chain[1].attemptNumber).toBe(2);
      expect(chain[2].endpointId).toBe(1);
      expect(chain[2].attemptNumber).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test("SYSTEM_ERROR: should not wrap around when endpoints exhausted", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      const provider = createProvider({
        providerType: "claude",
        providerVendorId: 123,
        maxRetryAttempts: 4, // More retries than endpoints
      });
      session.setProvider(provider);

      // Only 2 endpoints available
      mocks.getPreferredProviderEndpoints.mockResolvedValue([
        makeEndpoint({
          id: 1,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep1.example.com",
          lastProbeLatencyMs: 100,
        }),
        makeEndpoint({
          id: 2,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep2.example.com",
          lastProbeLatencyMs: 200,
        }),
      ]);

      // Mock categorizeErrorAsync to return SYSTEM_ERROR (network error)
      vi.mocked(categorizeErrorAsync).mockResolvedValue(ErrorCategory.SYSTEM_ERROR);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );

      // Create a network-like error
      const networkError = new TypeError("fetch failed");
      Object.assign(networkError, { code: "ETIMEDOUT" });

      // All 4 attempts fail with network error, then mock switches provider
      doForward.mockImplementation(async () => {
        throw networkError;
      });

      const sendPromise = ProxyForwarder.send(session);
      // Attach catch handler immediately to prevent unhandled rejection warnings
      let caughtError: Error | null = null;
      sendPromise.catch((e) => {
        caughtError = e;
      });
      await vi.runAllTimersAsync();

      // Should fail eventually (no successful response)
      expect(caughtError).not.toBeNull();
      expect(caughtError).toBeInstanceOf(ProxyError);

      const chain = session.getProviderChain();

      // Should have attempted with both endpoints, but NOT wrap around
      // Pattern should be: endpoint 1, endpoint 2, endpoint 2, endpoint 2 (stay at last)
      // NOT: endpoint 1, endpoint 2, endpoint 1, endpoint 2 (wrap around)
      expect(chain.length).toBeGreaterThanOrEqual(2);

      // First attempt uses endpoint 1
      expect(chain[0].endpointId).toBe(1);
      // Second attempt uses endpoint 2
      expect(chain[1].endpointId).toBe(2);

      // Subsequent attempts should stay at endpoint 2 (no wrap-around)
      if (chain.length > 2) {
        expect(chain[2].endpointId).toBe(2);
      }
      if (chain.length > 3) {
        expect(chain[3].endpointId).toBe(2);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  test("mixed errors: PROVIDER_ERROR should not advance endpoint index", async () => {
    vi.useFakeTimers();

    try {
      const session = createSession();
      const provider = createProvider({
        providerType: "claude",
        providerVendorId: 123,
        maxRetryAttempts: 4,
      });
      session.setProvider(provider);

      // 3 endpoints
      mocks.getPreferredProviderEndpoints.mockResolvedValue([
        makeEndpoint({
          id: 1,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep1.example.com",
          lastProbeLatencyMs: 100,
        }),
        makeEndpoint({
          id: 2,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep2.example.com",
          lastProbeLatencyMs: 200,
        }),
        makeEndpoint({
          id: 3,
          vendorId: 123,
          providerType: "claude",
          url: "https://ep3.example.com",
          lastProbeLatencyMs: 300,
        }),
      ]);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
        "doForward"
      );

      // Create errors
      const networkError = new TypeError("fetch failed");
      Object.assign(networkError, { code: "ECONNREFUSED" });
      const httpError = new ProxyError("server error", 500);

      // Attempt 1: SYSTEM_ERROR (switch endpoint)
      // Attempt 2: PROVIDER_ERROR (keep endpoint)
      // Attempt 3: SYSTEM_ERROR (switch endpoint)
      // Attempt 4: success
      let attemptCount = 0;
      vi.mocked(categorizeErrorAsync).mockImplementation(async () => {
        attemptCount++;
        if (attemptCount === 1) return ErrorCategory.SYSTEM_ERROR;
        if (attemptCount === 2) return ErrorCategory.PROVIDER_ERROR;
        if (attemptCount === 3) return ErrorCategory.SYSTEM_ERROR;
        return ErrorCategory.PROVIDER_ERROR;
      });

      doForward.mockImplementationOnce(async () => {
        throw networkError; // SYSTEM_ERROR -> advance to ep2
      });
      doForward.mockImplementationOnce(async () => {
        throw httpError; // PROVIDER_ERROR -> stay at ep2
      });
      doForward.mockImplementationOnce(async () => {
        throw networkError; // SYSTEM_ERROR -> advance to ep3
      });
      doForward.mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "2" },
        })
      );

      const sendPromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(500);
      const response = await sendPromise;

      expect(response.status).toBe(200);
      expect(doForward).toHaveBeenCalledTimes(4);

      const chain = session.getProviderChain();
      expect(chain).toHaveLength(4);

      // Verify endpoint progression:
      // attempt 1: ep1 (SYSTEM_ERROR -> advance)
      // attempt 2: ep2 (PROVIDER_ERROR -> stay)
      // attempt 3: ep2 (SYSTEM_ERROR -> advance)
      // attempt 4: ep3 (success)
      expect(chain[0].endpointId).toBe(1);
      expect(chain[1].endpointId).toBe(2);
      expect(chain[2].endpointId).toBe(2);
      expect(chain[3].endpointId).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
