import { beforeEach, describe, expect, test, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import { V1_ENDPOINT_PATHS } from "@/app/v1/_lib/proxy/endpoint-paths";

const mocks = vi.hoisted(() => {
  return {
    getCachedSystemSettings: vi.fn(),
    isHttp2Enabled: vi.fn(async () => false),
    getPreferredProviderEndpoints: vi.fn(async () => []),
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
    updateSessionBindingSmart: vi.fn(async () => ({
      updated: true,
      reason: "failover_success",
      details: null,
    })),
    updateSessionProvider: vi.fn(async () => undefined),
    clearSessionProvider: vi.fn(async () => undefined),
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

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    getCachedSystemSettings: (...args: unknown[]) => mocks.getCachedSystemSettings(...args),
    isHttp2Enabled: (...args: unknown[]) => mocks.isHttp2Enabled(...args),
  };
});

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

vi.mock("@/lib/session-manager", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session-manager")>();
  return {
    ...actual,
    SessionManager: {
      ...actual.SessionManager,
      updateSessionBindingSmart: (...args: unknown[]) => mocks.updateSessionBindingSmart(...args),
      updateSessionProvider: (...args: unknown[]) => mocks.updateSessionProvider(...args),
      clearSessionProvider: (...args: unknown[]) => mocks.clearSessionProvider(...args),
    },
  };
});

vi.mock("@/app/v1/_lib/proxy/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/v1/_lib/proxy/errors")>();
  return {
    ...actual,
    categorizeErrorAsync: vi.fn(async () => actual.ErrorCategory.PROVIDER_ERROR),
    getErrorDetectionResultAsync: vi.fn(async () => ({ matched: false })),
  };
});

import {
  categorizeErrorAsync,
  EmptyResponseError,
  ErrorCategory,
  ProxyError,
} from "@/app/v1/_lib/proxy/errors";
import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider } from "@/types/provider";

function createProvider(id: number, overrides: Partial<Provider> = {}): Provider {
  return {
    id,
    name: `provider-${id}`,
    url: `https://provider-${id}.example.com`,
    key: `key-${id}`,
    providerVendorId: id + 100,
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
    maxRetryAttempts: 3,
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

function createRawSession(pathname: string): ProxySession {
  const session = Object.create(ProxySession.prototype);
  const headers = new Headers();

  Object.assign(session, {
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL(`https://example.com${pathname}`),
    headers,
    originalHeaders: new Headers(headers),
    headerLog: JSON.stringify(Object.fromEntries(headers.entries())),
    request: {
      model: "claude-sonnet-4-5",
      log: "(test)",
      message: {
        model: "claude-sonnet-4-5",
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
    sessionId: "sess_raw",
    requestSequence: 1,
    originalFormat: "claude",
    providerType: null,
    originalModelName: null,
    originalUrlPathname: null,
    providerChain: [],
    endpointPolicy: resolveEndpointPolicy(pathname),
    cacheTtlResolved: null,
    context1mApplied: false,
    specialSettings: [],
    cachedPriceData: undefined,
    cachedBillingModelSource: undefined,
    providersSnapshot: [],
    setProvider(provider: Provider | null) {
      this.provider = provider;
    },
    addProviderToChain(itemProvider: Provider, meta: Record<string, unknown>) {
      this.providerChain.push({
        id: itemProvider.id,
        name: itemProvider.name,
        providerType: itemProvider.providerType,
        ...meta,
      });
    },
    getProviderChain() {
      return this.providerChain;
    },
    isHeaderModified: () => false,
    isProbeRequest: () => false,
    shouldTrackSessionObservability: () => false,
    shouldPersistSessionDebugArtifacts: () => false,
  });

  (session as ProxySession).setRawCrossProviderFallbackEnabled(
    (session as ProxySession).getEndpointPolicy().allowRawCrossProviderFallback
  );

  return session as ProxySession;
}

describe("non-chat endpoint fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCachedSystemSettings.mockResolvedValue({
      allowNonConversationEndpointProviderFallback: true,
      enableClaudeMetadataUserIdInjection: false,
      enableBillingHeaderRectifier: false,
      enableResponseFixer: false,
      enableResponseInputRectifier: true,
      enableThinkingSignatureRectifier: true,
      enableThinkingBudgetRectifier: true,
    });
    mocks.getPreferredProviderEndpoints.mockResolvedValue([
      {
        id: 501,
        vendorId: 101,
        providerType: "claude",
        url: "https://endpoint-a.example.com",
      },
    ]);
  });

  test("enabled setting lets count tokens and compact reuse existing provider fallback chain", async () => {
    const session = createRawSession(V1_ENDPOINT_PATHS.MESSAGES_COUNT_TOKENS);
    const providerA = createProvider(1);
    const providerB = createProvider(2);
    session.setProvider(providerA);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
      "doForward"
    );
    const selectAlternative = vi.spyOn(
      ProxyForwarder as unknown as { selectAlternative: (...args: unknown[]) => unknown },
      "selectAlternative"
    );

    doForward.mockRejectedValueOnce(new ProxyError("upstream failed", 500)).mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "2" },
      })
    );
    selectAlternative.mockResolvedValueOnce(providerB);

    const response = await ProxyForwarder.send(session);

    expect(response.status).toBe(200);
    expect(doForward).toHaveBeenCalledTimes(2);
    expect(doForward.mock.calls[0]?.[1]).toMatchObject({ id: providerA.id });
    expect(doForward.mock.calls[1]?.[1]).toMatchObject({ id: providerB.id });
    expect(selectAlternative).toHaveBeenCalledTimes(1);
    expect(mocks.updateSessionBindingSmart).toHaveBeenCalledWith(
      "sess_raw",
      providerB.id,
      providerB.priority || 0,
      false,
      true,
      null
    );
  });

  test("disabled setting preserves immediate throw behavior for target raw endpoints", async () => {
    mocks.getCachedSystemSettings.mockResolvedValueOnce({
      allowNonConversationEndpointProviderFallback: false,
      enableClaudeMetadataUserIdInjection: false,
      enableBillingHeaderRectifier: false,
      enableResponseFixer: false,
      enableResponseInputRectifier: true,
      enableThinkingSignatureRectifier: true,
      enableThinkingBudgetRectifier: true,
    });

    const session = createRawSession(V1_ENDPOINT_PATHS.RESPONSES_COMPACT);
    const providerA = createProvider(1, { providerType: "codex" });
    session.originalFormat = "response";
    session.setRawCrossProviderFallbackEnabled(false);
    session.request.message = {
      model: "gpt-5",
      input: [{ role: "user", content: "compact me" }],
    };
    session.setProvider(providerA);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
      "doForward"
    );
    const selectAlternative = vi.spyOn(
      ProxyForwarder as unknown as { selectAlternative: (...args: unknown[]) => unknown },
      "selectAlternative"
    );
    doForward.mockRejectedValueOnce(new ProxyError("upstream failed", 500));

    await expect(ProxyForwarder.send(session)).rejects.toBeInstanceOf(ProxyError);
    expect(doForward).toHaveBeenCalledTimes(1);
    expect(selectAlternative).not.toHaveBeenCalled();
  });

  test("disabled setting preserves immediate throw behavior for raw endpoint system errors", async () => {
    const session = createRawSession(V1_ENDPOINT_PATHS.RESPONSES_COMPACT);
    const providerA = createProvider(1, { providerType: "codex" });
    session.originalFormat = "response";
    session.setRawCrossProviderFallbackEnabled(false);
    session.request.message = {
      model: "gpt-5",
      input: [{ role: "user", content: "compact me" }],
    };
    session.setProvider(providerA);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
      "doForward"
    );
    const selectAlternative = vi.spyOn(
      ProxyForwarder as unknown as { selectAlternative: (...args: unknown[]) => unknown },
      "selectAlternative"
    );
    vi.mocked(categorizeErrorAsync).mockResolvedValueOnce(ErrorCategory.SYSTEM_ERROR);
    doForward.mockRejectedValueOnce(new Error("socket hang up"));

    await expect(ProxyForwarder.send(session)).rejects.toThrow("socket hang up");
    expect(doForward).toHaveBeenCalledTimes(1);
    expect(selectAlternative).not.toHaveBeenCalled();
  });

  test("disabled setting preserves immediate throw behavior for raw endpoint 404s", async () => {
    const session = createRawSession(V1_ENDPOINT_PATHS.RESPONSES_COMPACT);
    const providerA = createProvider(1, { providerType: "codex" });
    session.originalFormat = "response";
    session.setRawCrossProviderFallbackEnabled(false);
    session.request.message = {
      model: "gpt-5",
      input: [{ role: "user", content: "compact me" }],
    };
    session.setProvider(providerA);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
      "doForward"
    );
    const selectAlternative = vi.spyOn(
      ProxyForwarder as unknown as { selectAlternative: (...args: unknown[]) => unknown },
      "selectAlternative"
    );
    vi.mocked(categorizeErrorAsync).mockResolvedValueOnce(ErrorCategory.RESOURCE_NOT_FOUND);
    doForward.mockRejectedValueOnce(new ProxyError("not found", 404));

    await expect(ProxyForwarder.send(session)).rejects.toBeInstanceOf(ProxyError);
    expect(doForward).toHaveBeenCalledTimes(1);
    expect(selectAlternative).not.toHaveBeenCalled();
  });

  test("disabled setting preserves immediate throw behavior for raw endpoint empty responses", async () => {
    const session = createRawSession(V1_ENDPOINT_PATHS.RESPONSES_COMPACT);
    const providerA = createProvider(1, { providerType: "codex" });
    session.originalFormat = "response";
    session.setRawCrossProviderFallbackEnabled(false);
    session.request.message = {
      model: "gpt-5",
      input: [{ role: "user", content: "compact me" }],
    };
    session.setProvider(providerA);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
      "doForward"
    );
    const selectAlternative = vi.spyOn(
      ProxyForwarder as unknown as { selectAlternative: (...args: unknown[]) => unknown },
      "selectAlternative"
    );
    vi.mocked(categorizeErrorAsync).mockResolvedValueOnce(ErrorCategory.PROVIDER_ERROR);
    doForward.mockRejectedValueOnce(
      new EmptyResponseError(providerA.id, providerA.name, "empty_body")
    );

    await expect(ProxyForwarder.send(session)).rejects.toBeInstanceOf(EmptyResponseError);
    expect(doForward).toHaveBeenCalledTimes(1);
    expect(selectAlternative).not.toHaveBeenCalled();
  });

  test("disabled setting preserves immediate throw behavior for raw endpoint strict pool exhaustion", async () => {
    const session = createRawSession(V1_ENDPOINT_PATHS.MESSAGES_COUNT_TOKENS);
    const providerA = createProvider(1);
    session.setRawCrossProviderFallbackEnabled(false);
    session.setProvider(providerA);

    mocks.getPreferredProviderEndpoints.mockRejectedValueOnce(
      new Error("endpoint selector temporarily unavailable")
    );

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
      "doForward"
    );
    const selectAlternative = vi.spyOn(
      ProxyForwarder as unknown as { selectAlternative: (...args: unknown[]) => unknown },
      "selectAlternative"
    );

    await expect(ProxyForwarder.send(session)).rejects.toBeInstanceOf(ProxyError);
    expect(doForward).not.toHaveBeenCalled();
    expect(selectAlternative).not.toHaveBeenCalled();
  });

  test("enabled raw fallback does not hedge or mutate circuit breaker accounting", async () => {
    const session = createRawSession(V1_ENDPOINT_PATHS.MESSAGES_COUNT_TOKENS);
    session.setProvider(createProvider(1));
    session.request.message = {
      model: "claude-sonnet-4-5",
      stream: true,
      messages: [{ role: "user", content: "count me" }],
    };

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
      "doForward"
    );
    const sendStreamingWithHedge = vi.spyOn(
      ProxyForwarder as unknown as { sendStreamingWithHedge: (...args: unknown[]) => unknown },
      "sendStreamingWithHedge"
    );
    const selectAlternative = vi.spyOn(
      ProxyForwarder as unknown as { selectAlternative: (...args: unknown[]) => unknown },
      "selectAlternative"
    );

    doForward
      .mockRejectedValueOnce(
        new ProxyError("upstream failed", 500, {
          body: "raw upstream secret body",
          parsed: { secret: "upstream-payload" },
        })
      )
      .mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "2" },
        })
      );
    selectAlternative.mockResolvedValueOnce(createProvider(2));

    await ProxyForwarder.send(session);

    expect(sendStreamingWithHedge).not.toHaveBeenCalled();
    const failedAttempt = session.getProviderChain().find((item) => item.reason === "retry_failed");
    expect(failedAttempt?.errorDetails).toMatchObject({
      provider: {
        id: 1,
        name: "provider-1",
        statusCode: 500,
        statusText: "upstream failed",
      },
    });
    expect(failedAttempt?.errorDetails).not.toHaveProperty("provider.upstreamBody");
    expect(failedAttempt?.errorDetails).not.toHaveProperty("provider.upstreamParsed");
    expect(mocks.recordSuccess).not.toHaveBeenCalled();
    expect(mocks.recordFailure).not.toHaveBeenCalled();
  });

  test("raw fallback switches providers without same-provider retry", async () => {
    const session = createRawSession(V1_ENDPOINT_PATHS.MESSAGES_COUNT_TOKENS);
    const providerA = createProvider(1, { maxRetryAttempts: 5 });
    const providerB = createProvider(2);
    session.setProvider(providerA);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as { doForward: (...args: unknown[]) => unknown },
      "doForward"
    );
    const selectAlternative = vi.spyOn(
      ProxyForwarder as unknown as { selectAlternative: (...args: unknown[]) => unknown },
      "selectAlternative"
    );

    doForward.mockRejectedValueOnce(new ProxyError("upstream failed", 500)).mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "2" },
      })
    );
    selectAlternative.mockResolvedValueOnce(providerB);

    await ProxyForwarder.send(session);

    const attemptedProviderIds = doForward.mock.calls.map((call) => (call[1] as Provider).id);
    expect(attemptedProviderIds).toEqual([providerA.id, providerB.id]);
    expect(selectAlternative).toHaveBeenCalledTimes(1);
  });
});
