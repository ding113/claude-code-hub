import { beforeEach, describe, expect, test, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";

const mocks = vi.hoisted(() => ({
  pickRandomProviderWithExclusion: vi.fn(),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(async () => {}),
  getCircuitState: vi.fn(() => "closed"),
  getProviderHealthInfo: vi.fn(async () => ({
    health: { failureCount: 0 },
    config: { failureThreshold: 3 },
  })),
  updateSessionBindingSmart: vi.fn(async () => ({ updated: true, reason: "test" })),
  updateSessionProvider: vi.fn(async () => {}),
  clearSessionProvider: vi.fn(async () => {}),
  isHttp2Enabled: vi.fn(async () => false),
  getPreferredProviderEndpoints: vi.fn(async () => []),
  getEndpointFilterStats: vi.fn(async () => null),
  recordEndpointSuccess: vi.fn(async () => {}),
  recordEndpointFailure: vi.fn(async () => {}),
  isVendorTypeCircuitOpen: vi.fn(async () => false),
  recordVendorTypeAllEndpointsTimeout: vi.fn(async () => {}),
  categorizeErrorAsync: vi.fn(async () => 0),
  storeSessionSpecialSettings: vi.fn(async () => {}),
}));

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
    isHttp2Enabled: mocks.isHttp2Enabled,
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
  recordFailure: mocks.recordFailure,
  recordSuccess: mocks.recordSuccess,
}));

vi.mock("@/lib/vendor-type-circuit-breaker", () => ({
  isVendorTypeCircuitOpen: mocks.isVendorTypeCircuitOpen,
  recordVendorTypeAllEndpointsTimeout: mocks.recordVendorTypeAllEndpointsTimeout,
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    updateSessionBindingSmart: mocks.updateSessionBindingSmart,
    updateSessionProvider: mocks.updateSessionProvider,
    clearSessionProvider: mocks.clearSessionProvider,
    storeSessionSpecialSettings: mocks.storeSessionSpecialSettings,
  },
}));

vi.mock("@/app/v1/_lib/proxy/provider-selector", () => ({
  ProxyProviderResolver: {
    pickRandomProviderWithExclusion: mocks.pickRandomProviderWithExclusion,
  },
}));

vi.mock("@/app/v1/_lib/proxy/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/v1/_lib/proxy/errors")>();
  return {
    ...actual,
    categorizeErrorAsync: mocks.categorizeErrorAsync,
  };
});

import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider } from "@/types/provider";

type AttemptRuntime = {
  clearResponseTimeout?: () => void;
  responseController?: AbortController;
};

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 1,
    name: "p1",
    url: "https://provider.example.com",
    key: "k",
    providerVendorId: null,
    isEnabled: true,
    weight: 1,
    priority: 0,
    groupPriorities: null,
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
    maxRetryAttempts: 1,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerOpenDuration: 1_800_000,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    firstByteTimeoutStreamingMs: 100,
    streamingIdleTimeoutMs: 0,
    requestTimeoutNonStreamingMs: 0,
    websiteUrl: null,
    faviconUrl: null,
    cacheTtlPreference: null,
    context1mPreference: null,
    codexReasoningEffortPreference: null,
    codexReasoningSummaryPreference: null,
    codexTextVerbosityPreference: null,
    codexParallelToolCallsPreference: null,
    codexServiceTierPreference: null,
    anthropicMaxTokensPreference: null,
    anthropicThinkingBudgetPreference: null,
    anthropicAdaptiveThinking: null,
    geminiGoogleSearchPreference: null,
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

function createSession(clientAbortSignal: AbortSignal | null = null): ProxySession {
  const headers = new Headers();
  const session = Object.create(ProxySession.prototype);

  Object.assign(session, {
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("https://example.com/v1/messages"),
    headers,
    originalHeaders: new Headers(headers),
    headerLog: JSON.stringify(Object.fromEntries(headers.entries())),
    request: {
      model: "claude-test",
      log: "(test)",
      message: {
        model: "claude-test",
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      },
    },
    userAgent: null,
    context: null,
    clientAbortSignal,
    userName: "test-user",
    authState: { success: true, user: null, key: null, apiKey: null },
    provider: null,
    messageContext: null,
    sessionId: "sess-hedge",
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
    endpointPolicy: resolveEndpointPolicy("/v1/messages"),
    isHeaderModified: () => false,
  });

  return session as ProxySession;
}

function createStreamingResponse(params: {
  label: string;
  firstChunkDelayMs: number;
  controller: AbortController;
}): Response {
  const encoder = new TextEncoder();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const onAbort = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        controller.close();
      };

      if (params.controller.signal.aborted) {
        onAbort();
        return;
      }

      params.controller.signal.addEventListener("abort", onAbort, { once: true });
      timeoutId = setTimeout(() => {
        if (params.controller.signal.aborted) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(`data: {"provider":"${params.label}"}\n\n`));
        controller.close();
      }, params.firstChunkDelayMs);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("ProxyForwarder - first-byte hedge scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("first provider exceeds first-byte threshold, second provider starts and wins by first chunk", async () => {
    vi.useFakeTimers();

    try {
      const provider1 = createProvider({ id: 1, name: "p1", firstByteTimeoutStreamingMs: 100 });
      const provider2 = createProvider({ id: 2, name: "p2", firstByteTimeoutStreamingMs: 100 });
      const session = createSession();
      session.setProvider(provider1);

      mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(provider2);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );

      const controller1 = new AbortController();
      const controller2 = new AbortController();

      doForward.mockImplementationOnce(async (attemptSession) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller1;
        runtime.clearResponseTimeout = vi.fn();
        return createStreamingResponse({
          label: "p1",
          firstChunkDelayMs: 220,
          controller: controller1,
        });
      });

      doForward.mockImplementationOnce(async (attemptSession) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller2;
        runtime.clearResponseTimeout = vi.fn();
        return createStreamingResponse({
          label: "p2",
          firstChunkDelayMs: 40,
          controller: controller2,
        });
      });

      const responsePromise = ProxyForwarder.send(session);

      await vi.advanceTimersByTimeAsync(100);
      expect(doForward).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(50);
      const response = await responsePromise;
      expect(await response.text()).toContain('"provider":"p2"');
      expect(controller1.signal.aborted).toBe(true);
      expect(controller2.signal.aborted).toBe(false);
      expect(mocks.recordFailure).not.toHaveBeenCalled();
      expect(mocks.recordSuccess).not.toHaveBeenCalled();
      expect(session.provider?.id).toBe(2);
      expect(mocks.updateSessionBindingSmart).toHaveBeenCalledWith("sess-hedge", 2, 0, false, true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("first provider can still win after hedge started if it emits first chunk earlier than fallback", async () => {
    vi.useFakeTimers();

    try {
      const provider1 = createProvider({ id: 1, name: "p1", firstByteTimeoutStreamingMs: 100 });
      const provider2 = createProvider({ id: 2, name: "p2", firstByteTimeoutStreamingMs: 100 });
      const session = createSession();
      session.setProvider(provider1);

      mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(provider2);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );

      const controller1 = new AbortController();
      const controller2 = new AbortController();

      doForward.mockImplementationOnce(async (attemptSession) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller1;
        runtime.clearResponseTimeout = vi.fn();
        return createStreamingResponse({
          label: "p1",
          firstChunkDelayMs: 140,
          controller: controller1,
        });
      });

      doForward.mockImplementationOnce(async (attemptSession) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller2;
        runtime.clearResponseTimeout = vi.fn();
        return createStreamingResponse({
          label: "p2",
          firstChunkDelayMs: 120,
          controller: controller2,
        });
      });

      const responsePromise = ProxyForwarder.send(session);

      await vi.advanceTimersByTimeAsync(100);
      expect(doForward).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(45);
      const response = await responsePromise;
      expect(await response.text()).toContain('"provider":"p1"');
      expect(controller1.signal.aborted).toBe(false);
      expect(controller2.signal.aborted).toBe(true);
      expect(mocks.recordFailure).not.toHaveBeenCalled();
      expect(mocks.recordSuccess).not.toHaveBeenCalled();
      expect(session.provider?.id).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("when multiple providers all exceed threshold, hedge scheduler keeps expanding until a later provider wins", async () => {
    vi.useFakeTimers();

    try {
      const provider1 = createProvider({ id: 1, name: "p1", firstByteTimeoutStreamingMs: 100 });
      const provider2 = createProvider({ id: 2, name: "p2", firstByteTimeoutStreamingMs: 100 });
      const provider3 = createProvider({ id: 3, name: "p3", firstByteTimeoutStreamingMs: 100 });
      const session = createSession();
      session.setProvider(provider1);

      mocks.pickRandomProviderWithExclusion
        .mockResolvedValueOnce(provider2)
        .mockResolvedValueOnce(provider3);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );

      const controller1 = new AbortController();
      const controller2 = new AbortController();
      const controller3 = new AbortController();

      doForward.mockImplementationOnce(async (attemptSession) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller1;
        runtime.clearResponseTimeout = vi.fn();
        return createStreamingResponse({
          label: "p1",
          firstChunkDelayMs: 400,
          controller: controller1,
        });
      });

      doForward.mockImplementationOnce(async (attemptSession) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller2;
        runtime.clearResponseTimeout = vi.fn();
        return createStreamingResponse({
          label: "p2",
          firstChunkDelayMs: 400,
          controller: controller2,
        });
      });

      doForward.mockImplementationOnce(async (attemptSession) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller3;
        runtime.clearResponseTimeout = vi.fn();
        return createStreamingResponse({
          label: "p3",
          firstChunkDelayMs: 20,
          controller: controller3,
        });
      });

      const responsePromise = ProxyForwarder.send(session);

      await vi.advanceTimersByTimeAsync(200);
      expect(doForward).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(25);
      const response = await responsePromise;
      expect(await response.text()).toContain('"provider":"p3"');
      expect(controller1.signal.aborted).toBe(true);
      expect(controller2.signal.aborted).toBe(true);
      expect(controller3.signal.aborted).toBe(false);
      expect(mocks.recordFailure).not.toHaveBeenCalled();
      expect(mocks.recordSuccess).not.toHaveBeenCalled();
      expect(session.provider?.id).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test("client abort before any winner should abort all in-flight attempts, return 499, and clear sticky provider binding", async () => {
    vi.useFakeTimers();

    try {
      const provider1 = createProvider({ id: 1, name: "p1", firstByteTimeoutStreamingMs: 100 });
      const provider2 = createProvider({ id: 2, name: "p2", firstByteTimeoutStreamingMs: 100 });
      const clientAbortController = new AbortController();
      const session = createSession(clientAbortController.signal);
      session.setProvider(provider1);

      mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(provider2);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );

      const controller1 = new AbortController();
      const controller2 = new AbortController();

      doForward.mockImplementationOnce(async (attemptSession) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller1;
        runtime.clearResponseTimeout = vi.fn();
        return createStreamingResponse({
          label: "p1",
          firstChunkDelayMs: 500,
          controller: controller1,
        });
      });

      doForward.mockImplementationOnce(async (attemptSession) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller2;
        runtime.clearResponseTimeout = vi.fn();
        return createStreamingResponse({
          label: "p2",
          firstChunkDelayMs: 500,
          controller: controller2,
        });
      });

      const responsePromise = ProxyForwarder.send(session);
      const rejection = expect(responsePromise).rejects.toMatchObject({
        statusCode: 499,
      });

      await vi.advanceTimersByTimeAsync(100);
      expect(doForward).toHaveBeenCalledTimes(2);

      clientAbortController.abort(new Error("client_cancelled"));
      await vi.runAllTimersAsync();

      await rejection;
      expect(controller1.signal.aborted).toBe(true);
      expect(controller2.signal.aborted).toBe(true);
      expect(mocks.clearSessionProvider).toHaveBeenCalledWith("sess-hedge");
      expect(mocks.recordFailure).not.toHaveBeenCalled();
      expect(mocks.recordSuccess).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("hedge launcher rejection should settle request instead of hanging", async () => {
    vi.useFakeTimers();

    try {
      const provider1 = createProvider({ id: 1, name: "p1", firstByteTimeoutStreamingMs: 100 });
      const session = createSession();
      session.setProvider(provider1);

      mocks.pickRandomProviderWithExclusion.mockRejectedValueOnce(new Error("selector down"));

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );

      const controller1 = new AbortController();

      doForward.mockImplementationOnce(async (attemptSession) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller1;
        runtime.clearResponseTimeout = vi.fn();
        return createStreamingResponse({
          label: "p1",
          firstChunkDelayMs: 500,
          controller: controller1,
        });
      });

      const responsePromise = ProxyForwarder.send(session);
      const rejection = expect(responsePromise).rejects.toMatchObject({
        statusCode: 503,
      });

      await vi.advanceTimersByTimeAsync(100);
      await vi.runAllTimersAsync();

      await rejection;
      expect(controller1.signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("strict endpoint pool errors should reject with sanitized ProxyError instead of raw selector error", async () => {
    vi.useFakeTimers();

    try {
      const provider1 = createProvider({
        id: 1,
        name: "p1",
        providerType: "claude",
        providerVendorId: 123,
        firstByteTimeoutStreamingMs: 100,
      });
      const session = createSession();
      session.requestUrl = new URL("https://example.com/v1/messages");
      session.setProvider(provider1);

      mocks.getPreferredProviderEndpoints.mockRejectedValueOnce(new Error("Redis connection lost"));
      mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(null);

      const responsePromise = ProxyForwarder.send(session);
      const rejection = expect(responsePromise).rejects.toMatchObject({
        statusCode: 503,
        message: "No available provider endpoints",
      });

      await vi.runAllTimersAsync();
      await rejection;

      expect(mocks.pickRandomProviderWithExclusion).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("endpoint resolution failure should not inflate launchedProviderCount, winner gets request_success not hedge_winner", async () => {
    vi.useFakeTimers();

    try {
      const provider1 = createProvider({
        id: 1,
        name: "p1",
        providerVendorId: 123,
        firstByteTimeoutStreamingMs: 100,
      });
      const provider2 = createProvider({
        id: 2,
        name: "p2",
        providerVendorId: null,
        firstByteTimeoutStreamingMs: 100,
      });
      const session = createSession();
      session.requestUrl = new URL("https://example.com/v1/messages");
      session.setProvider(provider1);

      // Provider 1's strict endpoint resolution will fail
      mocks.getPreferredProviderEndpoints.mockRejectedValueOnce(
        new Error("Endpoint resolution failed")
      );

      // After provider 1 fails, pick provider 2 as alternative
      mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(provider2);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );

      const controller2 = new AbortController();

      // Only provider 2 reaches doForward (provider 1 fails at endpoint resolution)
      doForward.mockImplementationOnce(async (attemptSession) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller2;
        runtime.clearResponseTimeout = vi.fn();
        return createStreamingResponse({
          label: "p2",
          firstChunkDelayMs: 10,
          controller: controller2,
        });
      });

      const responsePromise = ProxyForwarder.send(session);

      await vi.advanceTimersByTimeAsync(200);
      const response = await responsePromise;

      expect(await response.text()).toContain('"provider":"p2"');
      expect(session.provider?.id).toBe(2);

      // Key assertion: since only provider 2 actually launched (provider 1 failed at
      // endpoint resolution before incrementing launchedProviderCount), the winner
      // should be classified as "request_success" not "hedge_winner".
      const chain = session.getProviderChain();
      const winnerEntry = chain.find(
        (entry) => entry.reason === "request_success" || entry.reason === "hedge_winner"
      );
      expect(winnerEntry).toBeDefined();
      expect(winnerEntry!.reason).toBe("request_success");
    } finally {
      vi.useRealTimers();
    }
  });
});
