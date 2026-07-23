import { beforeEach, describe, expect, test, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";

const mocks = vi.hoisted(() => ({
  pickRandomProviderWithExclusion: vi.fn(),
  pickDiscoveryProviders: vi.fn(),
  resolveEffectivePriorityForSession: vi.fn(
    (provider: { priority?: number | null }) => provider.priority ?? 0
  ),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(async () => {}),
  getCircuitState: vi.fn(() => "closed"),
  getProviderHealthInfo: vi.fn(async () => ({
    health: { failureCount: 0 },
    config: { failureThreshold: 3 },
  })),
  updateSessionBindingSmart: vi.fn(async () => ({
    updated: true,
    reason: "test",
  })),
  updateSessionProvider: vi.fn(async () => {}),
  clearSessionProvider: vi.fn(async () => {}),
  clearSessionProviders: vi.fn(async () => false),
  isHttp2Enabled: vi.fn(async () => false),
  getPreferredProviderEndpoints: vi.fn(async () => []),
  getEndpointFilterStats: vi.fn(async () => null),
  recordEndpointSuccess: vi.fn(async () => {}),
  recordEndpointFailure: vi.fn(async () => {}),
  isVendorTypeCircuitOpen: vi.fn(async () => false),
  recordVendorTypeAllEndpointsTimeout: vi.fn(async () => {}),
  checkAndTrackProviderSession: vi.fn(async () => ({
    allowed: true,
    count: 1,
    tracked: true,
    referenced: true,
  })),
  releaseProviderSession: vi.fn(async (_providerId: number, _sessionId: string) => {}),
  categorizeErrorAsync: vi.fn(async () => 0),
  getErrorDetectionResultAsync: vi.fn(async () => ({ matched: false })),
  getCachedSystemSettings: vi.fn(async () => ({
    enableThinkingSignatureRectifier: true,
    enableThinkingBudgetRectifier: true,
  })),
  storeSessionSpecialSettings: vi.fn(async () => {}),
  storeSessionRequestPhaseSnapshot: vi.fn(async () => {}),
  storeSessionResponsePhaseSnapshot: vi.fn(async () => {}),
  getVersionedBindingCapabilityState: vi.fn(() => "available"),
  ensureVersionedBindingCapability: vi.fn(async () => "available"),
  getSessionBindingSnapshot: vi.fn(async (sessionId: string, keyId: number) => ({
    status: "ok",
    legacyFallbackAllowed: false,
    source: "existing",
    snapshot: { sessionId, keyId, providerId: null, generation: "g-test" },
  })),
  acquireSessionDiscoveryLease: vi.fn(async () => ({
    status: "acquired",
    ownerToken: "lease-test",
    legacyFallbackAllowed: false,
  })),
  releaseSessionDiscoveryLease: vi.fn(async () => ({
    status: "released",
    legacyFallbackAllowed: false,
  })),
  clearVersionedSessionProvider: vi.fn(async (snapshot: unknown) => ({
    status: "ok",
    legacyFallbackAllowed: false,
    source: "cleared",
    snapshot: {
      ...(snapshot as Record<string, unknown>),
      providerId: null,
      generation: "g-cleared",
    },
  })),
  isWebsocketClientRequest: vi.fn(() => false),
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
    getCachedSystemSettings: mocks.getCachedSystemSettings,
    isHttp2Enabled: mocks.isHttp2Enabled,
  };
});

vi.mock("@/lib/provider-endpoints/endpoint-selector", () => ({
  getPreferredProviderEndpoints: mocks.getPreferredProviderEndpoints,
  getEndpointFilterStats: mocks.getEndpointFilterStats,
}));

vi.mock("@/app/v1/_lib/responses-ws/eligibility", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/v1/_lib/responses-ws/eligibility")>();
  return {
    ...actual,
    isWebsocketClientRequest: mocks.isWebsocketClientRequest,
  };
});

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

vi.mock("@/lib/rate-limit/service", () => ({
  RateLimitService: {
    checkAndTrackProviderSession: mocks.checkAndTrackProviderSession,
    releaseProviderSession: mocks.releaseProviderSession,
  },
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    getVersionedBindingCapabilityState: mocks.getVersionedBindingCapabilityState,
    ensureVersionedBindingCapability: mocks.ensureVersionedBindingCapability,
    getSessionBindingSnapshot: mocks.getSessionBindingSnapshot,
    acquireSessionDiscoveryLease: mocks.acquireSessionDiscoveryLease,
    releaseSessionDiscoveryLease: mocks.releaseSessionDiscoveryLease,
    clearVersionedSessionProvider: mocks.clearVersionedSessionProvider,
    updateSessionBindingSmart: mocks.updateSessionBindingSmart,
    updateSessionProvider: mocks.updateSessionProvider,
    clearSessionProvider: mocks.clearSessionProvider,
    clearSessionProviders: mocks.clearSessionProviders,
    storeSessionSpecialSettings: mocks.storeSessionSpecialSettings,
    storeSessionRequestPhaseSnapshot: mocks.storeSessionRequestPhaseSnapshot,
    storeSessionResponsePhaseSnapshot: mocks.storeSessionResponsePhaseSnapshot,
  },
}));

vi.mock("@/app/v1/_lib/proxy/provider-selector", () => ({
  ProxyProviderResolver: {
    pickRandomProviderWithExclusion: mocks.pickRandomProviderWithExclusion,
    pickDiscoveryProviders: mocks.pickDiscoveryProviders,
    resolveEffectivePriorityForSession: mocks.resolveEffectivePriorityForSession,
  },
}));

vi.mock("@/app/v1/_lib/proxy/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/v1/_lib/proxy/errors")>();
  return {
    ...actual,
    categorizeErrorAsync: mocks.categorizeErrorAsync,
    getErrorDetectionResultAsync: mocks.getErrorDetectionResultAsync,
  };
});

import {
  ErrorCategory as ProxyErrorCategory,
  ProxyError as UpstreamProxyError,
  getErrorDetectionResultAsync,
} from "@/app/v1/_lib/proxy/errors";
import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ModelRedirector } from "@/app/v1/_lib/proxy/model-redirector";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import { peekDeferredStreamingFinalization } from "@/app/v1/_lib/proxy/stream-finalization";
import { DbPoolAdmissionError } from "@/drizzle/admitted-client";
import { logger } from "@/lib/logger";
import type { Provider } from "@/types/provider";
import type { SystemSettings } from "@/types/system-config";

type AttemptRuntime = {
  clearResponseTimeout?: () => void;
  responseController?: AbortController;
  releaseAgent?: () => void;
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
    codexImageGenerationPreference: null,
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
    streamingHedgeDisabled: false,
    sessionBindingAllowed: true,
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

function setProviderWithSessionRef(session: ProxySession, provider: Provider): void {
  session.setProvider(provider);
  session.recordProviderSessionRef(provider.id);
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

      params.controller.signal.addEventListener("abort", onAbort, {
        once: true,
      });
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

function createDelayedFailure(params: {
  delayMs: number;
  error: Error;
  controller: AbortController;
}): Promise<Response> {
  return new Promise((_, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const rejectWithError = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      reject(params.error);
    };

    if (params.controller.signal.aborted) {
      rejectWithError();
      return;
    }

    params.controller.signal.addEventListener("abort", rejectWithError, {
      once: true,
    });
    timeoutId = setTimeout(() => {
      params.controller.signal.removeEventListener("abort", rejectWithError);
      reject(params.error);
    }, params.delayMs);
  });
}

function withThinkingBlocks(session: ProxySession): void {
  session.request.message = {
    model: "claude-test",
    stream: true,
    messages: [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "t", signature: "sig_thinking" },
          { type: "text", text: "hello", signature: "sig_text_should_remove" },
          { type: "redacted_thinking", data: "r", signature: "sig_redacted" },
        ],
      },
    ],
  };
}

describe("ProxyForwarder - first-byte hedge scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCachedSystemSettings.mockResolvedValue({
      enableThinkingSignatureRectifier: true,
      enableThinkingBudgetRectifier: true,
    });
    mocks.checkAndTrackProviderSession.mockResolvedValue({
      allowed: true,
      count: 1,
      tracked: true,
      referenced: true,
    });
    mocks.ensureVersionedBindingCapability.mockResolvedValue("available");
    mocks.getSessionBindingSnapshot.mockImplementation(
      async (sessionId: string, keyId: number) => ({
        status: "ok",
        legacyFallbackAllowed: false,
        source: "existing",
        snapshot: { sessionId, keyId, providerId: null, generation: "g-test" },
      })
    );
    mocks.acquireSessionDiscoveryLease.mockResolvedValue({
      status: "acquired",
      ownerToken: "lease-test",
      legacyFallbackAllowed: false,
    });
    mocks.releaseSessionDiscoveryLease.mockResolvedValue({
      status: "released",
      legacyFallbackAllowed: false,
    });
    mocks.clearVersionedSessionProvider.mockImplementation(async (snapshot: unknown) => ({
      status: "ok",
      legacyFallbackAllowed: false,
      source: "cleared",
      snapshot: {
        ...(snapshot as Record<string, unknown>),
        providerId: null,
        generation: "g-cleared",
      },
    }));
    mocks.categorizeErrorAsync.mockResolvedValue(ProxyErrorCategory.PROVIDER_ERROR);
    mocks.isWebsocketClientRequest.mockReturnValue(false);
  });

  test("Discovery actively probes an unknown binding capability before acquiring its lease", async () => {
    const provider = createProvider({ id: 1 });
    const session = createSession();
    session.authState = {
      success: true,
      user: null,
      key: { id: 20 },
      apiKey: null,
    } as typeof session.authState;
    session.setProvider(provider);
    mocks.getVersionedBindingCapabilityState.mockReturnValueOnce("unknown");
    mocks.ensureVersionedBindingCapability.mockResolvedValueOnce("available");

    const prepareStreamingDiscovery = (
      ProxyForwarder as unknown as {
        prepareStreamingDiscovery: (
          session: ProxySession,
          settings: SystemSettings,
          requestStartedAt: number
        ) => Promise<unknown>;
      }
    ).prepareStreamingDiscovery;
    const prepared = await prepareStreamingDiscovery(
      session,
      {
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 1,
        discoverySlaMs: 50,
        stickySlaMs: 50,
        racingTotalTimeoutMs: 200,
        stickyTimeoutCooldownMs: 300_000,
      } as SystemSettings,
      Date.now()
    );

    expect(prepared).toMatchObject({ status: "prepared" });
    expect(mocks.ensureVersionedBindingCapability).toHaveBeenCalledTimes(1);
    expect(mocks.getSessionBindingSnapshot).toHaveBeenCalledWith("sess-hedge", 20);
    expect(mocks.acquireSessionDiscoveryLease).toHaveBeenCalledTimes(1);
  });

  test.each(["unknown", "unavailable"] as const)(
    "Discovery fails closed when the binding capability probe returns %s",
    async (capabilityState) => {
      const provider = createProvider({ id: 1 });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 21 },
        apiKey: null,
      } as typeof session.authState;
      session.setProvider(provider);
      mocks.ensureVersionedBindingCapability.mockResolvedValueOnce(capabilityState);

      const prepareStreamingDiscovery = (
        ProxyForwarder as unknown as {
          prepareStreamingDiscovery: (
            session: ProxySession,
            settings: SystemSettings,
            requestStartedAt: number
          ) => Promise<unknown>;
        }
      ).prepareStreamingDiscovery;
      const prepared = await prepareStreamingDiscovery(
        session,
        {
          discoveryEnabled: true,
          discoveryConcurrency: 2,
          maxDiscoveryRounds: 1,
          discoverySlaMs: 50,
          stickySlaMs: 50,
          racingTotalTimeoutMs: 200,
          stickyTimeoutCooldownMs: 300_000,
        } as SystemSettings,
        Date.now()
      );

      expect(prepared).toEqual({
        status: "skipped",
        reason: "redis_capability_unavailable",
      });
      expect(mocks.ensureVersionedBindingCapability).toHaveBeenCalledTimes(1);
      expect(mocks.getSessionBindingSnapshot).not.toHaveBeenCalled();
      expect(mocks.acquireSessionDiscoveryLease).not.toHaveBeenCalled();
    }
  );

  test("shadow session redirect should not overwrite initial provider redirect and winner should keep its own redirect", () => {
    const requestedModel = "claude-haiku-4-5-20251001";
    const fireworksRedirect = "accounts/fireworks/routers/kimi-k2p5-turbo";
    const minimaxRedirect = "MiniMax-M2.7-highspeed";

    const fireworks = createProvider({
      id: 383,
      name: "fireworks",
      modelRedirects: [
        {
          matchType: "exact",
          source: requestedModel,
          target: fireworksRedirect,
        },
      ],
    });
    const minimax = createProvider({
      id: 206,
      name: "Minimax Max",
      modelRedirects: [{ matchType: "exact", source: requestedModel, target: minimaxRedirect }],
    });

    const session = createSession();
    session.request.model = requestedModel;
    session.request.message.model = requestedModel;
    session.setProvider(fireworks);
    session.addProviderToChain(fireworks, { reason: "initial_selection" });

    expect(ModelRedirector.apply(session, fireworks)).toBe(true);
    expect(session.request.model).toBe(fireworksRedirect);
    expect(session.getProviderChain()[0].modelRedirect).toMatchObject({
      originalModel: requestedModel,
      redirectedModel: fireworksRedirect,
      billingModel: requestedModel,
    });

    const shadow = (
      ProxyForwarder as unknown as {
        createStreamingShadowSession: (session: ProxySession, provider: Provider) => ProxySession;
      }
    ).createStreamingShadowSession(session, minimax);

    expect(shadow.request.model).toBe(fireworksRedirect);
    expect(ModelRedirector.apply(shadow, minimax)).toBe(true);
    expect(shadow.request.model).toBe(minimaxRedirect);

    // Hedge 备选供应商的重定向只能影响自己的 attempt，不能污染初始供应商的链路项。
    expect(session.getProviderChain()[0].modelRedirect).toMatchObject({
      originalModel: requestedModel,
      redirectedModel: fireworksRedirect,
      billingModel: requestedModel,
    });

    (
      ProxyForwarder as unknown as {
        syncWinningAttemptSession: (target: ProxySession, source: ProxySession) => void;
      }
    ).syncWinningAttemptSession(session, shadow);

    session.setProvider(minimax);
    session.addProviderToChain(minimax, {
      reason: "hedge_winner",
      attemptNumber: 2,
      statusCode: 200,
    });

    const hedgeWinner = session
      .getProviderChain()
      .find((item) => item.id === minimax.id && item.reason === "hedge_winner");

    expect(hedgeWinner?.modelRedirect).toMatchObject({
      originalModel: requestedModel,
      redirectedModel: minimaxRedirect,
      billingModel: requestedModel,
    });
  });

  test("shadow session should clone current model redirect snapshot instead of sharing it", () => {
    const requestedModel = "claude-haiku-4-5-20251001";
    const fireworksRedirect = "accounts/fireworks/routers/kimi-k2p5-turbo";
    const fireworks = createProvider({
      id: 383,
      name: "fireworks",
      modelRedirects: [
        {
          matchType: "exact",
          source: requestedModel,
          target: fireworksRedirect,
        },
      ],
    });
    const fallback = createProvider({
      id: 206,
      name: "Minimax Max",
    });

    const session = createSession();
    session.request.model = requestedModel;
    session.request.message.model = requestedModel;
    session.setProvider(fireworks);
    session.addProviderToChain(fireworks, { reason: "initial_selection" });
    expect(ModelRedirector.apply(session, fireworks)).toBe(true);

    const shadow = (
      ProxyForwarder as unknown as {
        createStreamingShadowSession: (session: ProxySession, provider: Provider) => ProxySession;
      }
    ).createStreamingShadowSession(session, fallback);

    const sessionState = session as unknown as {
      currentModelRedirect: {
        providerId: number;
        redirect: {
          originalModel: string;
          redirectedModel: string;
          billingModel: string;
        };
      } | null;
    };
    const shadowState = shadow as unknown as {
      currentModelRedirect: {
        providerId: number;
        redirect: {
          originalModel: string;
          redirectedModel: string;
          billingModel: string;
        };
      } | null;
    };

    expect(shadowState.currentModelRedirect).toEqual(sessionState.currentModelRedirect);

    if (!sessionState.currentModelRedirect || !shadowState.currentModelRedirect) {
      throw new Error("expected currentModelRedirect to be copied into shadow session");
    }

    shadowState.currentModelRedirect.redirect.redirectedModel = "shadow-only-model";

    expect(sessionState.currentModelRedirect.redirect.redirectedModel).toBe(fireworksRedirect);
  });

  test("switching to provider without redirect should clear stale redirect snapshot", () => {
    const requestedModel = "claude-haiku-4-5-20251001";
    const fireworksRedirect = "accounts/fireworks/routers/kimi-k2p5-turbo";
    const fireworks = createProvider({
      id: 383,
      name: "fireworks",
      modelRedirects: [
        {
          matchType: "exact",
          source: requestedModel,
          target: fireworksRedirect,
        },
      ],
    });
    const plainProvider = createProvider({
      id: 520,
      name: "plain provider",
      modelRedirects: null,
    });

    const session = createSession();
    session.request.model = requestedModel;
    session.request.message.model = requestedModel;
    session.setProvider(fireworks);
    session.addProviderToChain(fireworks, { reason: "initial_selection" });
    expect(ModelRedirector.apply(session, fireworks)).toBe(true);

    expect(ModelRedirector.apply(session, plainProvider)).toBe(false);
    expect(session.request.model).toBe(requestedModel);

    const sessionState = session as unknown as {
      currentModelRedirect: unknown;
    };
    expect(sessionState.currentModelRedirect).toBeNull();

    session.setProvider(plainProvider);
    session.addProviderToChain(plainProvider, {
      reason: "retry_success",
      attemptNumber: 2,
      statusCode: 200,
    });

    const plainEntry = session
      .getProviderChain()
      .find((item) => item.id === plainProvider.id && item.reason === "retry_success");

    expect(plainEntry?.modelRedirect).toBeUndefined();
  });

  test("public hedge path should preserve redirect details for winner and loser attempts", async () => {
    vi.useFakeTimers();

    try {
      const requestedModel = "claude-haiku-4-5-20251001";
      const fireworksRedirect = "accounts/fireworks/routers/kimi-k2p5-turbo";
      const minimaxRedirect = "MiniMax-M2.7-highspeed";
      const fireworks = createProvider({
        id: 383,
        name: "fireworks",
        firstByteTimeoutStreamingMs: 100,
        modelRedirects: [
          {
            matchType: "exact",
            source: requestedModel,
            target: fireworksRedirect,
          },
        ],
      });
      const minimax = createProvider({
        id: 206,
        name: "Minimax Max",
        firstByteTimeoutStreamingMs: 100,
        modelRedirects: [
          {
            matchType: "exact",
            source: requestedModel,
            target: minimaxRedirect,
          },
        ],
      });
      const session = createSession();
      session.request.model = requestedModel;
      session.request.message.model = requestedModel;
      setProviderWithSessionRef(session, fireworks);
      session.addProviderToChain(fireworks, { reason: "initial_selection" });

      mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(minimax);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );

      const controller1 = new AbortController();
      const controller2 = new AbortController();
      const releaseInitialAgent = vi.fn();
      const releaseLoserAgent = vi.fn();

      doForward.mockImplementationOnce(async (attemptSession, providerForRequest) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller1;
        runtime.clearResponseTimeout = vi.fn();
        runtime.releaseAgent = releaseInitialAgent;
        expect(
          ModelRedirector.apply(attemptSession as ProxySession, providerForRequest as Provider)
        ).toBe(true);
        return createStreamingResponse({
          label: "fireworks",
          firstChunkDelayMs: 220,
          controller: controller1,
        });
      });

      doForward.mockImplementationOnce(async (attemptSession, providerForRequest) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller2;
        runtime.clearResponseTimeout = vi.fn();
        runtime.releaseAgent = releaseLoserAgent;
        expect(
          ModelRedirector.apply(attemptSession as ProxySession, providerForRequest as Provider)
        ).toBe(true);
        return createStreamingResponse({
          label: "minimax",
          firstChunkDelayMs: 40,
          controller: controller2,
        });
      });

      const responsePromise = ProxyForwarder.send(session);

      await vi.advanceTimersByTimeAsync(100);
      expect(doForward).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(50);
      const response = await responsePromise;
      expect(await response.text()).toContain('"provider":"minimax"');

      const chain = session.getProviderChain();
      expect(
        chain.find((item) => item.id === minimax.id && item.reason === "hedge_winner")
          ?.modelRedirect
      ).toMatchObject({
        originalModel: requestedModel,
        redirectedModel: minimaxRedirect,
        billingModel: requestedModel,
      });
      expect(
        chain.find((item) => item.id === fireworks.id && item.reason === "hedge_loser_cancelled")
          ?.modelRedirect
      ).toMatchObject({
        originalModel: requestedModel,
        redirectedModel: fireworksRedirect,
        billingModel: requestedModel,
      });
      expect(mocks.releaseProviderSession).toHaveBeenCalledWith(fireworks.id, "sess-hedge");
      expect(releaseInitialAgent).toHaveBeenCalledTimes(1);
      expect(releaseLoserAgent).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("hedge loser 在 releaseAgent 晚到时仍会释放 agent cleanup", async () => {
    vi.useFakeTimers();

    try {
      const slow = createProvider({
        id: 383,
        name: "slow",
        firstByteTimeoutStreamingMs: 100,
      });
      const fast = createProvider({
        id: 206,
        name: "fast",
        firstByteTimeoutStreamingMs: 100,
      });
      const session = createSession();
      setProviderWithSessionRef(session, slow);
      session.addProviderToChain(slow, { reason: "initial_selection" });

      mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(fast);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );

      const slowController = new AbortController();
      const fastController = new AbortController();
      const releaseSlowAgent = vi.fn();
      const releaseFastAgent = vi.fn();

      doForward.mockImplementationOnce(async (attemptSession) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 180));
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = slowController;
        runtime.clearResponseTimeout = vi.fn();
        runtime.releaseAgent = releaseSlowAgent;
        return createStreamingResponse({
          label: "slow",
          firstChunkDelayMs: 0,
          controller: slowController,
        });
      });

      doForward.mockImplementationOnce(async (attemptSession) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = fastController;
        runtime.clearResponseTimeout = vi.fn();
        runtime.releaseAgent = releaseFastAgent;
        return createStreamingResponse({
          label: "fast",
          firstChunkDelayMs: 20,
          controller: fastController,
        });
      });

      const responsePromise = ProxyForwarder.send(session);

      await vi.advanceTimersByTimeAsync(100);
      expect(doForward).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(50);
      const response = await responsePromise;
      expect(await response.text()).toContain('"provider":"fast"');
      expect(releaseSlowAgent).not.toHaveBeenCalled();
      expect(releaseFastAgent).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(150);

      expect(releaseSlowAgent).toHaveBeenCalledTimes(1);
      expect(releaseFastAgent).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("public hedge path should retain redirect on shadow retry_failed entries", async () => {
    vi.useFakeTimers();

    try {
      const requestedModel = "claude-haiku-4-5-20251001";
      const fireworksRedirect = "accounts/fireworks/routers/kimi-k2p5-turbo";
      const minimaxRedirect = "MiniMax-M2.7-highspeed";
      const fireworks = createProvider({
        id: 383,
        name: "fireworks",
        firstByteTimeoutStreamingMs: 100,
        modelRedirects: [
          {
            matchType: "exact",
            source: requestedModel,
            target: fireworksRedirect,
          },
        ],
      });
      const minimax = createProvider({
        id: 206,
        name: "Minimax Max",
        firstByteTimeoutStreamingMs: 100,
        modelRedirects: [
          {
            matchType: "exact",
            source: requestedModel,
            target: minimaxRedirect,
          },
        ],
      });
      const session = createSession();
      session.request.model = requestedModel;
      session.request.message.model = requestedModel;
      session.setProvider(fireworks);
      session.addProviderToChain(fireworks, { reason: "initial_selection" });

      mocks.pickRandomProviderWithExclusion
        .mockResolvedValueOnce(minimax)
        .mockResolvedValueOnce(null);
      mocks.categorizeErrorAsync.mockResolvedValue(ProxyErrorCategory.PROVIDER_ERROR);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );

      const controller1 = new AbortController();

      doForward.mockImplementationOnce(async (attemptSession, providerForRequest) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller1;
        runtime.clearResponseTimeout = vi.fn();
        expect(
          ModelRedirector.apply(attemptSession as ProxySession, providerForRequest as Provider)
        ).toBe(true);
        return createStreamingResponse({
          label: "fireworks",
          firstChunkDelayMs: 220,
          controller: controller1,
        });
      });

      doForward.mockImplementationOnce(async (attemptSession, providerForRequest) => {
        expect(
          ModelRedirector.apply(attemptSession as ProxySession, providerForRequest as Provider)
        ).toBe(true);
        throw new UpstreamProxyError("minimax upstream failed", 500);
      });

      const responsePromise = ProxyForwarder.send(session);

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(150);

      const response = await responsePromise;
      expect(await response.text()).toContain('"provider":"fireworks"');

      const retryFailed = session
        .getProviderChain()
        .find((item) => item.id === minimax.id && item.reason === "retry_failed");

      expect(retryFailed?.modelRedirect).toMatchObject({
        originalModel: requestedModel,
        redirectedModel: minimaxRedirect,
        billingModel: requestedModel,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("shadow hedge winner 应把最终 request.after 与 response.before phase snapshot 写回原始 session", async () => {
    vi.useFakeTimers();

    try {
      const fireworks = createProvider({
        id: 383,
        name: "fireworks",
        url: "https://fireworks.example.com",
      });
      const minimax = createProvider({
        id: 206,
        name: "minimax",
        url: "https://minimax.example.com",
      });
      const session = createSession();
      session.setProvider(fireworks);
      session.addProviderToChain(fireworks, { reason: "initial_selection" });

      mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(minimax);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );

      const controller1 = new AbortController();
      const controller2 = new AbortController();

      doForward.mockImplementationOnce(async (attemptSession) => {
        const runtime = attemptSession as ProxySession &
          AttemptRuntime & {
            detailSnapshotRequestAfter?: {
              body: string | null;
              headers: Headers;
              meta: { clientUrl: null; upstreamUrl: string; method: string };
            };
            detailSnapshotResponseBefore?: {
              headers: Headers;
              meta: { upstreamUrl: string; statusCode: number };
            };
          };
        runtime.responseController = controller1;
        runtime.clearResponseTimeout = vi.fn();
        runtime.forwardedRequestBody = '{"provider":"fireworks"}';
        runtime.detailSnapshotRequestAfter = {
          body: '{"provider":"fireworks"}',
          headers: new Headers({ "x-attempt": "loser" }),
          meta: {
            clientUrl: null,
            upstreamUrl: "https://fireworks.example.com/v1/messages",
            method: "POST",
          },
        };
        runtime.detailSnapshotResponseBefore = {
          headers: new Headers({ "x-upstream": "loser" }),
          meta: {
            upstreamUrl: "https://fireworks.example.com/v1/messages",
            statusCode: 200,
          },
        };

        return createStreamingResponse({
          label: "fireworks",
          firstChunkDelayMs: 220,
          controller: controller1,
        });
      });

      doForward.mockImplementationOnce(async (attemptSession) => {
        const runtime = attemptSession as ProxySession &
          AttemptRuntime & {
            detailSnapshotRequestAfter?: {
              body: string | null;
              headers: Headers;
              meta: { clientUrl: null; upstreamUrl: string; method: string };
            };
            detailSnapshotResponseBefore?: {
              headers: Headers;
              meta: { upstreamUrl: string; statusCode: number };
            };
          };
        runtime.responseController = controller2;
        runtime.clearResponseTimeout = vi.fn();
        runtime.forwardedRequestBody = '{"provider":"minimax"}';
        runtime.detailSnapshotRequestAfter = {
          body: '{"provider":"minimax"}',
          headers: new Headers({ "x-attempt": "winner" }),
          meta: {
            clientUrl: null,
            upstreamUrl: "https://minimax.example.com/v1/messages",
            method: "POST",
          },
        };
        runtime.detailSnapshotResponseBefore = {
          headers: new Headers({ "x-upstream": "winner" }),
          meta: {
            upstreamUrl: "https://minimax.example.com/v1/messages",
            statusCode: 200,
          },
        };

        return createStreamingResponse({
          label: "minimax",
          firstChunkDelayMs: 40,
          controller: controller2,
        });
      });

      const responsePromise = ProxyForwarder.send(session);

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(50);
      const response = await responsePromise;

      expect(await response.text()).toContain('"provider":"minimax"');
      expect(mocks.storeSessionRequestPhaseSnapshot).toHaveBeenCalledTimes(1);
      expect(mocks.storeSessionResponsePhaseSnapshot).toHaveBeenCalledTimes(1);

      const [requestSnapshotSessionId, requestSnapshotPhase, requestSnapshot, requestSequence] =
        mocks.storeSessionRequestPhaseSnapshot.mock.calls[0];
      expect(requestSnapshotSessionId).toBe("sess-hedge");
      expect(requestSnapshotPhase).toBe("after");
      expect(requestSequence).toBe(1);
      expect(requestSnapshot.body).toBe('{"provider":"minimax"}');
      expect(requestSnapshot.meta).toEqual({
        clientUrl: null,
        upstreamUrl: "https://minimax.example.com/v1/messages",
        method: "POST",
      });
      expect(requestSnapshot.headers.get("x-attempt")).toBe("winner");

      const [responseSnapshotSessionId, responseSnapshotPhase, responseSnapshotMeta, sequence] =
        mocks.storeSessionResponsePhaseSnapshot.mock.calls[0];
      expect(responseSnapshotSessionId).toBe("sess-hedge");
      expect(responseSnapshotPhase).toBe("before");
      expect(sequence).toBe(1);
      expect(responseSnapshotMeta.meta).toEqual({
        upstreamUrl: "https://minimax.example.com/v1/messages",
        statusCode: 200,
      });
      expect(responseSnapshotMeta.headers.get("x-upstream")).toBe("winner");
    } finally {
      vi.useRealTimers();
    }
  });

  test("first provider exceeds first-byte threshold, second provider starts and wins by first chunk", async () => {
    vi.useFakeTimers();

    try {
      const provider1 = createProvider({
        id: 1,
        name: "p1",
        firstByteTimeoutStreamingMs: 100,
      });
      const provider2 = createProvider({
        id: 2,
        name: "p2",
        firstByteTimeoutStreamingMs: 100,
      });
      const session = createSession();
      session.authState = {
        ...session.authState!,
        key: { id: 456 },
      } as never;
      setProviderWithSessionRef(session, provider1);
      const winnerBindingSnapshot = {
        sessionId: "sess-hedge",
        keyId: 456,
        providerId: 2,
        generation: "hedge-winner-generation",
      };
      mocks.updateSessionBindingSmart.mockResolvedValueOnce({
        updated: true,
        reason: "race_winner_forced",
        bindingSnapshot: winnerBindingSnapshot,
      } as never);

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
      const deferred = peekDeferredStreamingFinalization(session);
      expect(await response.text()).toContain('"provider":"p2"');
      await expect(deferred?.hedgeBindingAuthorityPromise).resolves.toEqual({
        snapshot: winnerBindingSnapshot,
        legacyClearAllowed: false,
      });
      expect(controller1.signal.aborted).toBe(true);
      expect(controller2.signal.aborted).toBe(false);
      expect(mocks.recordFailure).not.toHaveBeenCalled();
      expect(mocks.recordSuccess).not.toHaveBeenCalled();
      expect(session.provider?.id).toBe(2);
      // Actual hedge win (launchedProviderCount > 1) forces the session-reuse
      // binding to the winner (forceUpdate=true, the trailing arg).
      expect(mocks.updateSessionBindingSmart).toHaveBeenCalledWith(
        "sess-hedge",
        2,
        0,
        false,
        true,
        456,
        true
      );
      expect(mocks.releaseProviderSession).toHaveBeenCalledWith(1, "sess-hedge");
    } finally {
      vi.useRealTimers();
    }
  });

  test("hedge skips provider when concurrent session acquire is rejected", async () => {
    vi.useFakeTimers();

    try {
      const provider1 = createProvider({
        id: 1,
        name: "p1",
        firstByteTimeoutStreamingMs: 100,
      });
      const provider2 = createProvider({
        id: 2,
        name: "p2",
        firstByteTimeoutStreamingMs: 100,
        limitConcurrentSessions: 1,
      });
      const provider3 = createProvider({
        id: 3,
        name: "p3",
        firstByteTimeoutStreamingMs: 100,
      });
      const session = createSession();
      setProviderWithSessionRef(session, provider1);

      mocks.pickRandomProviderWithExclusion
        .mockResolvedValueOnce(provider2)
        .mockResolvedValueOnce(provider3);
      mocks.checkAndTrackProviderSession
        .mockResolvedValueOnce({
          allowed: false,
          count: 1,
          tracked: false,
          referenced: false,
          reason: "供应商并发 Session 上限已达到（1/1）",
        })
        .mockResolvedValueOnce({
          allowed: true,
          count: 1,
          tracked: true,
          referenced: true,
        });

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );

      const controller1 = new AbortController();
      const controller3 = new AbortController();

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
        runtime.responseController = controller3;
        runtime.clearResponseTimeout = vi.fn();
        return createStreamingResponse({
          label: "p3",
          firstChunkDelayMs: 40,
          controller: controller3,
        });
      });

      const responsePromise = ProxyForwarder.send(session);

      await vi.advanceTimersByTimeAsync(100);
      expect(doForward).toHaveBeenCalledTimes(2);
      expect(doForward).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 2 }),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything()
      );

      await vi.advanceTimersByTimeAsync(50);
      const response = await responsePromise;

      expect(await response.text()).toContain('"provider":"p3"');
      expect(session.provider?.id).toBe(3);
      expect(mocks.checkAndTrackProviderSession).toHaveBeenNthCalledWith(1, 2, "sess-hedge", 1);
      expect(mocks.checkAndTrackProviderSession).toHaveBeenNthCalledWith(2, 3, "sess-hedge", 0);
      expect(session.getProviderChain()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 2, reason: "concurrent_limit_failed" }),
          expect.objectContaining({ id: 3, reason: "hedge_winner" }),
        ])
      );
      expect(mocks.releaseProviderSession).toHaveBeenCalledWith(1, "sess-hedge");
      expect(mocks.releaseProviderSession).not.toHaveBeenCalledWith(2, "sess-hedge");
    } finally {
      vi.useRealTimers();
    }
  });

  test("高并发模式：hedge winner 成功后不应写 session provider 观测信息", async () => {
    vi.useFakeTimers();

    try {
      const provider1 = createProvider({
        id: 1,
        name: "p1",
        firstByteTimeoutStreamingMs: 100,
      });
      const provider2 = createProvider({
        id: 2,
        name: "p2",
        firstByteTimeoutStreamingMs: 100,
      });
      const session = createSession();
      session.setHighConcurrencyModeEnabled(true);
      setProviderWithSessionRef(session, provider1);

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
      await vi.advanceTimersByTimeAsync(50);

      const response = await responsePromise;
      expect(await response.text()).toContain('"provider":"p2"');
      expect(mocks.updateSessionProvider).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("characterization: hedge still launches alternative provider when maxRetryAttempts > 1", async () => {
    vi.useFakeTimers();

    try {
      const provider1 = createProvider({
        id: 1,
        name: "p1",
        maxRetryAttempts: 3,
        firstByteTimeoutStreamingMs: 100,
      });
      const provider2 = createProvider({
        id: 2,
        name: "p2",
        maxRetryAttempts: 3,
        firstByteTimeoutStreamingMs: 100,
      });
      const session = createSession();
      setProviderWithSessionRef(session, provider1);

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
      expect(mocks.pickRandomProviderWithExclusion).toHaveBeenCalledTimes(1);

      const chainBeforeWinner = session.getProviderChain();
      expect(chainBeforeWinner).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ reason: "hedge_triggered", id: 1 }),
          expect.objectContaining({ reason: "hedge_launched", id: 2 }),
        ])
      );

      await vi.advanceTimersByTimeAsync(50);
      const response = await responsePromise;

      expect(await response.text()).toContain('"provider":"p2"');
      expect(controller1.signal.aborted).toBe(true);
      expect(session.provider?.id).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("first provider can still win after hedge started if it emits first chunk earlier than fallback", async () => {
    vi.useFakeTimers();

    try {
      const provider1 = createProvider({
        id: 1,
        name: "p1",
        firstByteTimeoutStreamingMs: 100,
      });
      const provider2 = createProvider({
        id: 2,
        name: "p2",
        firstByteTimeoutStreamingMs: 100,
      });
      const session = createSession();
      setProviderWithSessionRef(session, provider1);

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
      // Initial provider won the race (launchedProviderCount > 1): the binding
      // must still be force-updated to the winner (forceUpdate=true), closing
      // the gap where the smart path could keep a stale/higher-priority binding.
      expect(mocks.updateSessionBindingSmart).toHaveBeenCalledWith(
        "sess-hedge",
        1,
        0,
        false,
        false,
        null,
        true
      );
      expect(mocks.releaseProviderSession).toHaveBeenCalledWith(2, "sess-hedge");
    } finally {
      vi.useRealTimers();
    }
  });

  test("when multiple providers all exceed threshold, hedge scheduler keeps expanding until a later provider wins", async () => {
    vi.useFakeTimers();

    try {
      const provider1 = createProvider({
        id: 1,
        name: "p1",
        firstByteTimeoutStreamingMs: 100,
      });
      const provider2 = createProvider({
        id: 2,
        name: "p2",
        firstByteTimeoutStreamingMs: 100,
      });
      const provider3 = createProvider({
        id: 3,
        name: "p3",
        firstByteTimeoutStreamingMs: 100,
      });
      const session = createSession();
      setProviderWithSessionRef(session, provider1);

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
      expect(mocks.releaseProviderSession).toHaveBeenCalledWith(1, "sess-hedge");
      expect(mocks.releaseProviderSession).toHaveBeenCalledWith(2, "sess-hedge");
      expect(mocks.releaseProviderSession).not.toHaveBeenCalledWith(3, "sess-hedge");
    } finally {
      vi.useRealTimers();
    }
  });

  test("client abort before any winner should abort all in-flight attempts, return 499, and clear sticky provider binding", async () => {
    vi.useFakeTimers();

    try {
      const requestedModel = "claude-haiku-4-5-20251001";
      const provider1 = createProvider({
        id: 1,
        name: "p1",
        firstByteTimeoutStreamingMs: 100,
        modelRedirects: [
          {
            matchType: "exact",
            source: requestedModel,
            target: "accounts/fireworks/routers/kimi-k2p5-turbo",
          },
        ],
      });
      const provider2 = createProvider({
        id: 2,
        name: "p2",
        firstByteTimeoutStreamingMs: 100,
        modelRedirects: [
          {
            matchType: "exact",
            source: requestedModel,
            target: "MiniMax-M2.7-highspeed",
          },
        ],
      });
      const clientAbortController = new AbortController();
      const session = createSession(clientAbortController.signal);
      session.request.model = requestedModel;
      session.request.message.model = requestedModel;
      setProviderWithSessionRef(session, provider1);

      mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(provider2);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );

      const controller1 = new AbortController();
      const controller2 = new AbortController();

      doForward.mockImplementationOnce(async (attemptSession, providerForRequest) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller1;
        runtime.clearResponseTimeout = vi.fn();
        expect(
          ModelRedirector.apply(attemptSession as ProxySession, providerForRequest as Provider)
        ).toBe(true);
        return createStreamingResponse({
          label: "p1",
          firstChunkDelayMs: 500,
          controller: controller1,
        });
      });

      doForward.mockImplementationOnce(async (attemptSession, providerForRequest) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller2;
        runtime.clearResponseTimeout = vi.fn();
        expect(
          ModelRedirector.apply(attemptSession as ProxySession, providerForRequest as Provider)
        ).toBe(true);
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
      expect(mocks.clearSessionProviders).toHaveBeenCalledWith("sess-hedge", new Set([1, 2]), null);
      expect(mocks.recordFailure).not.toHaveBeenCalled();
      expect(mocks.recordSuccess).not.toHaveBeenCalled();

      const chain = session.getProviderChain();
      expect(
        chain.find((item) => item.id === provider1.id && item.reason === "client_abort")
          ?.modelRedirect
      ).toMatchObject({
        originalModel: requestedModel,
        redirectedModel: "accounts/fireworks/routers/kimi-k2p5-turbo",
        billingModel: requestedModel,
      });
      expect(
        chain.find((item) => item.id === provider2.id && item.reason === "client_abort")
          ?.modelRedirect
      ).toMatchObject({
        originalModel: requestedModel,
        redirectedModel: "MiniMax-M2.7-highspeed",
        billingModel: requestedModel,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("hedge launcher rejection should settle request instead of hanging", async () => {
    vi.useFakeTimers();

    try {
      const provider1 = createProvider({
        id: 1,
        name: "p1",
        firstByteTimeoutStreamingMs: 100,
      });
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

  test("strict endpoint pool exhaustion should converge to terminal fallback instead of provider-specific error", async () => {
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
      setProviderWithSessionRef(session, provider1);

      mocks.getPreferredProviderEndpoints.mockRejectedValueOnce(new Error("Redis connection lost"));
      mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(null);

      const responsePromise = ProxyForwarder.send(session);
      const errorPromise = responsePromise.catch((rejection) => rejection as UpstreamProxyError);

      await vi.runAllTimersAsync();
      const error = await errorPromise;

      expect(mocks.pickRandomProviderWithExclusion).toHaveBeenCalled();
      expect(error).toBeInstanceOf(UpstreamProxyError);
      expect(error.statusCode).toBe(503);
      expect(error.message).toBe("所有供应商暂时不可用，请稍后重试");
    } finally {
      vi.useRealTimers();
    }
  });

  test("provider-local model 404 should not cancel another in-flight hedge candidate", async () => {
    vi.useFakeTimers();

    try {
      const provider1 = createProvider({ id: 1, name: "p1", firstByteTimeoutStreamingMs: 100 });
      const provider2 = createProvider({ id: 2, name: "p2", firstByteTimeoutStreamingMs: 100 });
      const session = createSession();
      session.setProvider(provider1);

      mocks.pickRandomProviderWithExclusion
        .mockResolvedValueOnce(provider2)
        .mockResolvedValueOnce(null);
      mocks.categorizeErrorAsync.mockResolvedValue(ProxyErrorCategory.RESOURCE_NOT_FOUND);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );
      const controller1 = new AbortController();
      const controller2 = new AbortController();
      const providerLocal404 = new UpstreamProxyError(
        'Model "gpt-5.6-sol" is not supported by any configured account in this group',
        404,
        {
          body: '{"error":{"type":"model_not_found","message":"invalid request: not supported by any configured account in this group"}}',
          providerId: provider1.id,
          providerName: provider1.name,
        }
      );

      doForward.mockImplementationOnce(async (attemptSession) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller1;
        runtime.clearResponseTimeout = vi.fn();
        return createDelayedFailure({
          delayMs: 150,
          error: providerLocal404,
          controller: controller1,
        });
      });
      doForward.mockImplementationOnce(async (attemptSession) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller2;
        runtime.clearResponseTimeout = vi.fn();
        return createStreamingResponse({
          label: "p2",
          firstChunkDelayMs: 80,
          controller: controller2,
        });
      });

      const responsePromise = ProxyForwarder.send(session);

      await vi.advanceTimersByTimeAsync(100);
      expect(doForward).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(50);
      expect(controller2.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(30);

      const response = await responsePromise;
      expect(await response.text()).toContain('"provider":"p2"');
      expect(controller2.signal.aborted).toBe(false);
      expect(mocks.recordFailure).not.toHaveBeenCalledWith(provider1.id, providerLocal404);
      expect(session.getProviderChain()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: provider1.id, reason: "resource_not_found" }),
          expect.objectContaining({ id: provider2.id, reason: "hedge_winner" }),
        ])
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test.each([
    {
      name: "provider error",
      category: ProxyErrorCategory.PROVIDER_ERROR,
      errorFactory: (provider: Provider) =>
        new UpstreamProxyError("Provider returned 401: invalid key", 401, {
          body: '{"error":"invalid_api_key"}',
          providerId: provider.id,
          providerName: provider.name,
        }),
    },
    {
      name: "provider-local resource not found",
      category: ProxyErrorCategory.RESOURCE_NOT_FOUND,
      errorFactory: (provider: Provider) =>
        new UpstreamProxyError(
          'Model "gpt-5.6-sol" is not supported by any configured account in this group',
          404,
          {
            body: '{"error":{"type":"model_not_found"}}',
            providerId: provider.id,
            providerName: provider.name,
          }
        ),
    },
    {
      name: "system error",
      category: ProxyErrorCategory.SYSTEM_ERROR,
      errorFactory: () => new Error("fetch failed"),
    },
  ])(
    "when a real hedge race ends with only $name, terminal error should be generic fallback",
    async ({ category, errorFactory }) => {
      vi.useFakeTimers();

      try {
        const provider1 = createProvider({
          id: 1,
          name: "p1",
          firstByteTimeoutStreamingMs: 100,
        });
        const provider2 = createProvider({
          id: 2,
          name: "p2",
          firstByteTimeoutStreamingMs: 100,
        });
        const session = createSession();
        session.setProvider(provider1);

        mocks.pickRandomProviderWithExclusion
          .mockResolvedValueOnce(provider2)
          .mockResolvedValueOnce(null);
        mocks.categorizeErrorAsync.mockResolvedValueOnce(category).mockResolvedValueOnce(category);

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
          return createDelayedFailure({
            delayMs: 150,
            error: errorFactory(provider1),
            controller: controller1,
          });
        });

        doForward.mockImplementationOnce(async (attemptSession) => {
          const runtime = attemptSession as ProxySession & AttemptRuntime;
          runtime.responseController = controller2;
          runtime.clearResponseTimeout = vi.fn();
          return createDelayedFailure({
            delayMs: 160,
            error: errorFactory(provider2),
            controller: controller2,
          });
        });

        const responsePromise = ProxyForwarder.send(session);
        const errorPromise = responsePromise.catch((rejection) => rejection as UpstreamProxyError);

        await vi.advanceTimersByTimeAsync(100);
        expect(doForward).toHaveBeenCalledTimes(2);

        await vi.runAllTimersAsync();
        const error = await errorPromise;

        expect(error).toBeInstanceOf(UpstreamProxyError);
        expect(error.statusCode).toBe(503);
        expect(error.message).toBe("所有供应商暂时不可用，请稍后重试");
        expect(error.message).not.toContain("invalid key");
        expect(error.message).not.toContain("model not found");
        expect(mocks.clearSessionProviders).toHaveBeenCalledWith(
          "sess-hedge",
          new Set([1, 2]),
          null
        );
      } finally {
        vi.useRealTimers();
      }
    }
  );

  test("non-retryable client errors should stop hedge immediately and preserve original error", async () => {
    const provider1 = createProvider({
      id: 1,
      name: "p1",
      firstByteTimeoutStreamingMs: 100,
    });
    const provider2 = createProvider({
      id: 2,
      name: "p2",
      firstByteTimeoutStreamingMs: 100,
    });
    const session = createSession();
    session.setProvider(provider1);

    const originalError = new UpstreamProxyError("prompt too long", 400, {
      body: '{"error":"prompt_too_long"}',
      providerId: provider1.id,
      providerName: provider1.name,
    });

    mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(provider2);
    mocks.categorizeErrorAsync.mockResolvedValueOnce(ProxyErrorCategory.NON_RETRYABLE_CLIENT_ERROR);
    vi.mocked(getErrorDetectionResultAsync).mockResolvedValueOnce({
      matched: true,
      ruleId: 42,
      category: "thinking_error",
      pattern: "prompt too long",
      matchType: "contains",
      description: "Prompt too long",
      overrideStatusCode: 400,
    });

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      },
      "doForward"
    );

    doForward.mockRejectedValueOnce(originalError);

    const error = await ProxyForwarder.send(session).catch(
      (rejection) => rejection as UpstreamProxyError
    );

    expect(error).toBe(originalError);
    expect(error.message).toBe("prompt too long");
    expect(doForward).toHaveBeenCalledTimes(1);
    expect(mocks.pickRandomProviderWithExclusion).not.toHaveBeenCalled();
    expect(mocks.clearSessionProviders).toHaveBeenCalledWith("sess-hedge", new Set([1]), null);
    expect(session.getProviderChain()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "client_error_non_retryable",
          statusCode: 400,
          errorDetails: expect.objectContaining({
            matchedRule: expect.objectContaining({
              ruleId: 42,
            }),
          }),
        }),
      ])
    );
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      "ProxyForwarder: Non-retryable client error in hedge, aborting all attempts",
      expect.objectContaining({
        matchedRuleId: 42,
        matchedRuleName: "Prompt too long",
        matchedRulePattern: "prompt too long",
        matchedRuleCategory: "thinking_error",
        matchedRuleMatchType: "contains",
        matchedRuleHasOverrideResponse: false,
        matchedRuleHasOverrideStatusCode: true,
      })
    );
  });

  test("local DB admission overload should stop hedge without circuit mutation or failover", async () => {
    const provider = createProvider({
      id: 1,
      name: "p1",
      firstByteTimeoutStreamingMs: 100,
    });
    const session = createSession();
    session.setProvider(provider);

    const admissionCause = Object.assign(new Error("Database pool data is full"), {
      name: "DbPoolAdmissionError",
      code: "DB_POOL_ADMISSION_EXCEEDED",
      pool: "data",
      maxOutstanding: 32,
    });
    const wrappedError = new Error("Failed query", { cause: admissionCause });
    mocks.categorizeErrorAsync.mockResolvedValueOnce(ProxyErrorCategory.LOCAL_OVERLOAD);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      },
      "doForward"
    );
    doForward.mockRejectedValueOnce(wrappedError);

    const error = await ProxyForwarder.send(session).catch((rejection) => rejection as Error);

    expect(error).toBe(wrappedError);
    expect(doForward).toHaveBeenCalledTimes(1);
    expect(mocks.pickRandomProviderWithExclusion).not.toHaveBeenCalled();
    expect(mocks.recordEndpointFailure).not.toHaveBeenCalled();
    expect(mocks.recordFailure).not.toHaveBeenCalled();
    expect(mocks.clearSessionProviders).toHaveBeenCalledWith("sess-hedge", new Set([1]), null);
    expect(session.getProviderChain()).toEqual([
      expect.objectContaining({
        id: provider.id,
        reason: "system_error",
        errorDetails: expect.objectContaining({
          system: expect.objectContaining({
            errorCode: "DB_POOL_ADMISSION_EXCEEDED",
          }),
        }),
      }),
    ]);
  });

  test("hedge 备选供应商命中 thinking signature 错误时，应整流后在同供应商重试并保留审计", async () => {
    vi.useFakeTimers();

    try {
      const provider1 = createProvider({
        id: 1,
        name: "p1",
        firstByteTimeoutStreamingMs: 100,
      });
      const provider2 = createProvider({
        id: 2,
        name: "p2",
        firstByteTimeoutStreamingMs: 100,
      });
      const session = createSession();
      session.setProvider(provider1);
      withThinkingBlocks(session);

      mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(provider2);
      mocks.categorizeErrorAsync.mockResolvedValueOnce(
        ProxyErrorCategory.NON_RETRYABLE_CLIENT_ERROR
      );

      const signatureError = new UpstreamProxyError(
        "Invalid `signature` in `thinking` block",
        400,
        {
          body: '{"error":"invalid_signature"}',
          providerId: provider2.id,
          providerName: provider2.name,
        }
      );

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );

      const controller1 = new AbortController();
      const controller2First = new AbortController();
      const controller2Retry = new AbortController();

      doForward.mockImplementationOnce(async (attemptSession) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller1;
        runtime.clearResponseTimeout = vi.fn();
        return createStreamingResponse({
          label: "p1",
          firstChunkDelayMs: 600,
          controller: controller1,
        });
      });

      doForward.mockImplementationOnce(async (attemptSession) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller2First;
        runtime.clearResponseTimeout = vi.fn();
        return createDelayedFailure({
          delayMs: 50,
          error: signatureError,
          controller: controller2First,
        });
      });

      doForward.mockImplementationOnce(async (attemptSession) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        const body = runtime.request.message as {
          messages: Array<{ content: Array<Record<string, unknown>> }>;
        };
        const blocks = body.messages[0].content;

        expect(blocks.some((block) => block.type === "thinking")).toBe(false);
        expect(blocks.some((block) => block.type === "redacted_thinking")).toBe(false);
        expect(blocks.some((block) => "signature" in block)).toBe(false);

        runtime.responseController = controller2Retry;
        runtime.clearResponseTimeout = vi.fn();
        return createStreamingResponse({
          label: "p2-rectified",
          firstChunkDelayMs: 180,
          controller: controller2Retry,
        });
      });

      const responsePromise = ProxyForwarder.send(session);

      await vi.advanceTimersByTimeAsync(100);
      expect(doForward).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(55);
      expect(doForward).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(200);
      const response = await responsePromise;

      expect(await response.text()).toContain('"provider":"p2-rectified"');
      expect(session.provider?.id).toBe(2);
      expect(controller1.signal.aborted).toBe(true);
      expect(mocks.pickRandomProviderWithExclusion).toHaveBeenCalled();
      expect(mocks.storeSessionSpecialSettings).toHaveBeenCalledWith(
        "sess-hedge",
        expect.arrayContaining([
          expect.objectContaining({
            type: "thinking_signature_rectifier",
            hit: true,
            providerId: 2,
          }),
        ]),
        1
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test("hedge 路径的上游存储容量型 400 应记录失败并启动替代供应商", async () => {
    vi.useFakeTimers();

    try {
      const provider1 = createProvider({ id: 1, name: "p1", firstByteTimeoutStreamingMs: 100 });
      const provider2 = createProvider({ id: 2, name: "p2", firstByteTimeoutStreamingMs: 100 });
      const provider3 = createProvider({ id: 3, name: "p3", firstByteTimeoutStreamingMs: 100 });
      const session = createSession();
      session.setProvider(provider1);

      mocks.pickRandomProviderWithExclusion
        .mockResolvedValueOnce(provider2)
        .mockResolvedValueOnce(provider3)
        .mockResolvedValueOnce(null);
      mocks.categorizeErrorAsync.mockResolvedValue(ProxyErrorCategory.PROVIDER_ERROR);

      const storageError = new UpstreamProxyError(
        "invalid request: upstream storage failure",
        400,
        {
          body: '{"error":{"message":"disk storage creation failed: failed to write to temp file; disk free-space floor reached"}}',
          providerId: provider2.id,
          providerName: provider2.name,
        }
      );

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
          firstChunkDelayMs: 500,
          controller: controller1,
        });
      });

      doForward.mockImplementationOnce(async (attemptSession) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller2;
        runtime.clearResponseTimeout = vi.fn();
        return createDelayedFailure({
          delayMs: 50,
          error: storageError,
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

      await vi.advanceTimersByTimeAsync(100);
      expect(doForward).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(55);
      expect(doForward).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(30);
      const response = await responsePromise;

      expect(await response.text()).toContain('"provider":"p3"');
      expect(mocks.recordFailure).toHaveBeenCalledWith(provider2.id, storageError);
      expect(mocks.storeSessionSpecialSettings).not.toHaveBeenCalled();
      expect(
        session.getProviderChain().some((entry) => entry.reason === "client_error_non_retryable")
      ).toBe(false);
      expect(controller1.signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("hedge 路径命中 thinking budget 错误时，应整流后在同供应商重试", async () => {
    vi.useFakeTimers();

    try {
      const provider1 = createProvider({
        id: 1,
        name: "p1",
        firstByteTimeoutStreamingMs: 100,
      });
      const provider2 = createProvider({
        id: 2,
        name: "p2",
        firstByteTimeoutStreamingMs: 100,
      });
      const session = createSession();
      session.setProvider(provider1);
      session.request.message = {
        model: "claude-test",
        stream: true,
        max_tokens: 1000,
        thinking: { type: "enabled", budget_tokens: 500 },
        messages: [{ role: "user", content: "hi" }],
      };

      mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(provider2);
      mocks.categorizeErrorAsync.mockResolvedValueOnce(
        ProxyErrorCategory.NON_RETRYABLE_CLIENT_ERROR
      );

      const budgetError = new UpstreamProxyError(
        "thinking.enabled.budget_tokens: Input should be greater than or equal to 1024",
        400,
        {
          body: '{"error":"budget_too_low"}',
          providerId: provider1.id,
          providerName: provider1.name,
        }
      );

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );

      const controller1First = new AbortController();
      const controller1Retry = new AbortController();
      const controller2 = new AbortController();

      doForward.mockImplementationOnce(async (attemptSession) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller1First;
        runtime.clearResponseTimeout = vi.fn();
        return createDelayedFailure({
          delayMs: 140,
          error: budgetError,
          controller: controller1First,
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

      doForward.mockImplementationOnce(async (attemptSession) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        const body = runtime.request.message as {
          max_tokens: number;
          thinking: { type: string; budget_tokens: number };
        };

        expect(body.max_tokens).toBe(64000);
        expect(body.thinking.type).toBe("enabled");
        expect(body.thinking.budget_tokens).toBe(32000);

        runtime.responseController = controller1Retry;
        runtime.clearResponseTimeout = vi.fn();
        return createStreamingResponse({
          label: "p1-budget-rectified",
          firstChunkDelayMs: 40,
          controller: controller1Retry,
        });
      });

      const responsePromise = ProxyForwarder.send(session);

      await vi.advanceTimersByTimeAsync(100);
      expect(doForward).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(45);
      expect(doForward).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(50);
      const response = await responsePromise;

      expect(await response.text()).toContain('"provider":"p1-budget-rectified"');
      expect(session.provider?.id).toBe(1);
      expect(mocks.pickRandomProviderWithExclusion).toHaveBeenCalledTimes(1);
      expect(session.getSpecialSettings()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "thinking_budget_rectifier",
            hit: true,
            providerId: 1,
          }),
        ])
      );
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
      setProviderWithSessionRef(session, provider1);

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

      const chain = session.getProviderChain();
      const winnerEntry = chain.find(
        (entry) => entry.reason === "request_success" || entry.reason === "hedge_winner"
      );
      expect(winnerEntry).toBeDefined();
      expect(winnerEntry!.reason).toBe("request_success");
      expect(mocks.releaseProviderSession).toHaveBeenCalledWith(1, "sess-hedge");
    } finally {
      vi.useRealTimers();
    }
  });

  test("Discovery commits a lower-priority ready stream when the higher tier fails", async () => {
    vi.useFakeTimers();

    try {
      const high = createProvider({ id: 1, name: "high", priority: 1 });
      const low = createProvider({ id: 2, name: "low", priority: 10 });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 1 },
        apiKey: null,
      } as typeof session.authState;
      session.setProvider(high);
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 1,
        discoverySlaMs: 100,
        stickySlaMs: 100,
        racingTotalTimeoutMs: 500,
        stickyTimeoutCooldownMs: 300_000,
      });
      mocks.pickDiscoveryProviders.mockResolvedValueOnce([low]);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );

      doForward.mockImplementationOnce(
        async (_attemptSession, _provider, _baseUrl, _audit, _count, _stream, signal) => {
          await new Promise<never>((_resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("high tier failed")), 30);
            signal?.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(new Error("high tier aborted"));
              },
              { once: true }
            );
          });
        }
      );
      doForward.mockImplementationOnce(
        async (_attemptSession, _provider, _baseUrl, _audit, _count, _stream, signal) => {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              const timer = setTimeout(() => {
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"type":"content_block_delta","delta":{"text":"low"}}\n\n'
                  )
                );
                controller.close();
              }, 5);
              signal?.addEventListener(
                "abort",
                () => {
                  clearTimeout(timer);
                  controller.close();
                },
                { once: true }
              );
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        }
      );

      const responsePromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(30);
      const response = await responsePromise;

      expect(await response.text()).toContain('"low"');
      expect(session.provider?.id).toBe(low.id);
      expect(doForward).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("Discovery lease conflict forces a single upstream and forbids binding writes", async () => {
    const provider = createProvider({
      id: 1,
      firstByteTimeoutStreamingMs: 100,
    });
    const session = createSession();
    session.authState = {
      success: true,
      user: null,
      key: { id: 7 },
      apiKey: null,
    } as typeof session.authState;
    session.setProvider(provider);
    mocks.getCachedSystemSettings.mockResolvedValue({
      discoveryEnabled: true,
      racingTotalTimeoutMs: 500,
    });
    mocks.acquireSessionDiscoveryLease.mockResolvedValueOnce({
      status: "conflict",
      reason: "lease_held",
      legacyFallbackAllowed: false,
    });

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      },
      "doForward"
    );
    doForward.mockResolvedValueOnce(
      new Response('data: {"type":"message_stop"}\n\n', {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })
    );

    const response = await ProxyForwarder.send(session);
    expect(response.status).toBe(200);
    expect(doForward).toHaveBeenCalledTimes(1);
    expect(session.isStreamingHedgeDisabled()).toBe(true);
    expect(session.isSessionBindingAllowed()).toBe(false);
    expect(mocks.pickDiscoveryProviders).not.toHaveBeenCalled();
    expect(mocks.releaseSessionDiscoveryLease).not.toHaveBeenCalled();
    expect(mocks.getCachedSystemSettings).toHaveBeenCalledTimes(1);
  });

  test("foreign binding state uses single-upstream routing with serial fallback", async () => {
    const provider = createProvider({
      id: 1,
      firstByteTimeoutStreamingMs: 100,
    });
    const alternative = createProvider({ id: 2, name: "serial-fallback" });
    const session = createSession();
    session.authState = {
      success: true,
      user: null,
      key: { id: 8 },
      apiKey: null,
    } as typeof session.authState;
    session.setProvider(provider);
    mocks.getCachedSystemSettings.mockResolvedValue({ discoveryEnabled: true });
    mocks.getSessionBindingSnapshot.mockResolvedValueOnce({
      status: "conflict",
      reason: "legacy_owner_mismatch",
      legacyFallbackAllowed: false,
    });
    mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(alternative);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      },
      "doForward"
    );
    doForward
      .mockRejectedValueOnce(new UpstreamProxyError("initial provider failed", 500))
      .mockResolvedValueOnce(
        new Response('data: {"type":"message_stop"}\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })
      );

    const response = await ProxyForwarder.send(session);
    expect(response.status).toBe(200);
    expect(doForward).toHaveBeenCalledTimes(2);
    expect(doForward.mock.calls.map((call) => (call[1] as Provider).id)).toEqual([
      provider.id,
      alternative.id,
    ]);
    expect(mocks.pickRandomProviderWithExclusion).toHaveBeenCalledTimes(1);
    expect(session.isStreamingHedgeDisabled()).toBe(true);
    expect(session.isSessionBindingAllowed()).toBe(false);
    expect(peekDeferredStreamingFinalization(session)?.bindingIntent).toBe("none");
    expect(mocks.acquireSessionDiscoveryLease).not.toHaveBeenCalled();
    expect(mocks.pickDiscoveryProviders).not.toHaveBeenCalled();
  });

  test("Sticky fallback stays held while timeout CAS and the next wave are being prepared", async () => {
    vi.useFakeTimers();
    try {
      const sticky = createProvider({ id: 1, name: "sticky", priority: 1 });
      const normal = createProvider({ id: 2, name: "normal", priority: 1 });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 9 },
        apiKey: null,
      } as typeof session.authState;
      session.request.message.messages = [
        { role: "user", content: "first" },
        { role: "user", content: "second" },
      ];
      session.setProvider(sticky);
      session.setSessionBindingSnapshot({
        sessionId: session.sessionId!,
        keyId: 9,
        providerId: sticky.id,
        generation: "g-sticky",
      });
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 2,
        discoverySlaMs: 50,
        stickySlaMs: 10,
        racingTotalTimeoutMs: 200,
        stickyTimeoutCooldownMs: 300_000,
      });
      mocks.pickDiscoveryProviders.mockResolvedValueOnce([normal]);

      let resolveClear!: (value: unknown) => void;
      mocks.clearVersionedSessionProvider.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveClear = resolve;
        })
      );

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );
      doForward.mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              setTimeout(() => {
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"type":"content_block_delta","delta":{"text":"sticky"}}\n\n'
                  )
                );
                controller.close();
              }, 15);
            },
          }),
          { headers: { "content-type": "text/event-stream" } }
        )
      );
      doForward.mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              setTimeout(() => {
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"type":"content_block_delta","delta":{"text":"normal"}}\n\n'
                  )
                );
                controller.close();
              }, 5);
            },
          }),
          { headers: { "content-type": "text/event-stream" } }
        )
      );

      let settledEarly = false;
      const responsePromise = ProxyForwarder.send(session).then((response) => {
        settledEarly = true;
        return response;
      });
      await vi.advanceTimersByTimeAsync(20);
      expect(settledEarly).toBe(false);

      resolveClear({
        status: "ok",
        legacyFallbackAllowed: false,
        source: "cleared",
        snapshot: {
          sessionId: session.sessionId!,
          keyId: 9,
          providerId: null,
          generation: "g-cleared",
        },
      });
      await vi.advanceTimersByTimeAsync(10);
      const response = await responsePromise;
      expect(await response.text()).toContain('"normal"');
      expect(session.provider?.id).toBe(normal.id);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a Sticky rectifier retry stalled in setup still demotes to fallback", async () => {
    vi.useFakeTimers();
    try {
      const sticky = createProvider({ id: 1, name: "sticky", priority: 1 });
      const normal = createProvider({ id: 2, name: "normal", priority: 1 });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 36 },
        apiKey: null,
      } as typeof session.authState;
      session.request.message.messages = [
        { role: "user", content: "first" },
        {
          role: "assistant",
          content: [{ type: "thinking", thinking: "t", signature: "sig" }],
        },
      ];
      setProviderWithSessionRef(session, sticky);
      session.setSessionBindingSnapshot({
        sessionId: session.sessionId!,
        keyId: 36,
        providerId: sticky.id,
        generation: "g-sticky-rectifier-setup",
      });
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 1,
        discoverySlaMs: 50,
        stickySlaMs: 10,
        racingTotalTimeoutMs: 100,
        stickyTimeoutCooldownMs: 300_000,
        enableThinkingSignatureRectifier: true,
      });
      mocks.pickDiscoveryProviders.mockResolvedValueOnce([normal]);

      const retrySetup = Promise.withResolvers<{
        endpointId: number | null;
        baseUrl: string;
        endpointUrl: string;
      }>();
      const retrySetupStarted = Promise.withResolvers<void>();
      let stickyEndpointCalls = 0;
      const endpointResolver = vi.spyOn(
        ProxyForwarder as unknown as {
          resolveStreamingHedgeEndpoint: (
            session: ProxySession,
            provider: Provider
          ) => Promise<{
            endpointId: number | null;
            baseUrl: string;
            endpointUrl: string;
          }>;
        },
        "resolveStreamingHedgeEndpoint"
      );
      endpointResolver.mockImplementation(async (_attemptSession, provider) => {
        if (provider.id === sticky.id) {
          stickyEndpointCalls += 1;
          if (stickyEndpointCalls > 1) {
            retrySetupStarted.resolve();
            return retrySetup.promise;
          }
        }
        return {
          endpointId: null,
          baseUrl: provider.url,
          endpointUrl: provider.url,
        };
      });

      const signatureError = new UpstreamProxyError(
        "Invalid `signature` in `thinking` block",
        400,
        {
          body: '{"error":"invalid_signature"}',
          providerId: sticky.id,
          providerName: sticky.name,
        }
      );
      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );
      doForward.mockImplementation(async (attemptSession) => {
        if ((attemptSession as ProxySession).provider?.id === sticky.id) throw signatureError;
        return new Response('data: {"type":"content_block_delta","delta":{"text":"normal"}}\n\n', {
          headers: { "content-type": "text/event-stream" },
        });
      });

      const responsePromise = ProxyForwarder.send(session);
      await retrySetupStarted.promise;
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(0);

      expect(mocks.clearVersionedSessionProvider).toHaveBeenCalledWith(
        expect.objectContaining({ generation: "g-sticky-rectifier-setup" }),
        sticky.id,
        300
      );
      expect(mocks.pickDiscoveryProviders).toHaveBeenCalledTimes(1);
      expect(doForward).toHaveBeenCalledTimes(2);

      retrySetup.resolve({
        endpointId: null,
        baseUrl: sticky.url,
        endpointUrl: sticky.url,
      });
      await vi.advanceTimersByTimeAsync(0);
      const response = await responsePromise;
      expect(await response.text()).toContain('"normal"');
      expect(doForward).toHaveBeenCalledTimes(2);
      expect(mocks.releaseProviderSession).toHaveBeenCalledWith(sticky.id, session.sessionId);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a timed-out Sticky retry setup failure starts exactly one full Discovery wave", async () => {
    vi.useFakeTimers();
    try {
      const sticky = createProvider({ id: 1, name: "sticky", priority: 1 });
      const normalOne = createProvider({
        id: 2,
        name: "normal-one",
        priority: 1,
      });
      const normalTwo = createProvider({
        id: 3,
        name: "normal-two",
        priority: 1,
      });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 38 },
        apiKey: null,
      } as typeof session.authState;
      session.request.message.messages = [
        { role: "user", content: "first" },
        {
          role: "assistant",
          content: [{ type: "thinking", thinking: "t", signature: "sig" }],
        },
      ];
      setProviderWithSessionRef(session, sticky);
      session.setSessionBindingSnapshot({
        sessionId: session.sessionId!,
        keyId: 38,
        providerId: sticky.id,
        generation: "g-sticky-retry-failure",
      });
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 1,
        discoverySlaMs: 50,
        stickySlaMs: 10,
        racingTotalTimeoutMs: 100,
        stickyTimeoutCooldownMs: 300_000,
        enableThinkingSignatureRectifier: true,
      });
      mocks.pickDiscoveryProviders.mockResolvedValueOnce([normalOne, normalTwo]);

      const clearBinding = Promise.withResolvers<unknown>();
      mocks.clearVersionedSessionProvider.mockReturnValueOnce(clearBinding.promise);
      const retrySetup = Promise.withResolvers<{
        endpointId: number | null;
        baseUrl: string;
        endpointUrl: string;
      }>();
      const retrySetupStarted = Promise.withResolvers<void>();
      let stickyEndpointCalls = 0;
      vi.spyOn(
        ProxyForwarder as unknown as {
          resolveStreamingHedgeEndpoint: (
            session: ProxySession,
            provider: Provider
          ) => Promise<{
            endpointId: number | null;
            baseUrl: string;
            endpointUrl: string;
          }>;
        },
        "resolveStreamingHedgeEndpoint"
      ).mockImplementation(async (_attemptSession, provider) => {
        if (provider.id === sticky.id && ++stickyEndpointCalls > 1) {
          retrySetupStarted.resolve();
          return retrySetup.promise;
        }
        return {
          endpointId: null,
          baseUrl: provider.url,
          endpointUrl: provider.url,
        };
      });

      const signatureError = new UpstreamProxyError(
        "Invalid `signature` in `thinking` block",
        400,
        {
          body: '{"error":"invalid_signature"}',
          providerId: sticky.id,
          providerName: sticky.name,
        }
      );
      const normalTwoResponse = Promise.withResolvers<Response>();
      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );
      doForward.mockImplementation(async (attemptSession) => {
        const providerId = (attemptSession as ProxySession).provider?.id;
        if (providerId === sticky.id) throw signatureError;
        if (providerId === normalTwo.id) return normalTwoResponse.promise;
        return new Response(new ReadableStream<Uint8Array>(), {
          headers: { "content-type": "text/event-stream" },
        });
      });

      const responsePromise = ProxyForwarder.send(session);
      await retrySetupStarted.promise;
      await vi.advanceTimersByTimeAsync(10);
      retrySetup.reject(new Error("sticky retry setup failed"));
      await vi.advanceTimersByTimeAsync(0);
      // The failed rectifier setup frees the fallback slot, but the reserved
      // wave remains behind the Sticky binding-clear CAS.
      expect(mocks.pickDiscoveryProviders).not.toHaveBeenCalled();

      clearBinding.resolve({
        status: "ok",
        legacyFallbackAllowed: false,
        source: "cleared",
        snapshot: {
          sessionId: session.sessionId!,
          keyId: 38,
          providerId: null,
          generation: "g-sticky-retry-failure-cleared",
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.pickDiscoveryProviders).toHaveBeenCalledTimes(1);
      expect(mocks.pickDiscoveryProviders).toHaveBeenCalledWith(
        expect.anything(),
        2,
        expect.arrayContaining([sticky.id])
      );
      normalTwoResponse.resolve(
        new Response('data: {"type":"content_block_delta","delta":{"text":"winner"}}\n\n', {
          headers: { "content-type": "text/event-stream" },
        })
      );
      await vi.advanceTimersByTimeAsync(0);

      const response = await responsePromise;
      expect(await response.text()).toContain('"winner"');
      expect(mocks.pickDiscoveryProviders).toHaveBeenCalledTimes(1);
      expect(doForward).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test("Sticky timeout and fallback failure consume a single replacement-wave reservation", async () => {
    vi.useFakeTimers();
    try {
      const sticky = createProvider({ id: 1, name: "sticky", priority: 1 });
      const normalOne = createProvider({
        id: 2,
        name: "normal-one",
        priority: 1,
      });
      const normalTwo = createProvider({
        id: 3,
        name: "normal-two",
        priority: 1,
      });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 28 },
        apiKey: null,
      } as typeof session.authState;
      session.request.message.messages = [
        { role: "user", content: "first" },
        { role: "user", content: "second" },
      ];
      session.setProvider(sticky);
      session.setSessionBindingSnapshot({
        sessionId: session.sessionId!,
        keyId: 28,
        providerId: sticky.id,
        generation: "g-sticky-single-wave",
      });
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 1,
        discoverySlaMs: 50,
        stickySlaMs: 10,
        racingTotalTimeoutMs: 200,
        stickyTimeoutCooldownMs: 300_000,
      });

      const clearBinding = Promise.withResolvers<unknown>();
      mocks.clearVersionedSessionProvider.mockReturnValueOnce(clearBinding.promise);
      const replacementWave = Promise.withResolvers<Provider[]>();
      mocks.pickDiscoveryProviders.mockReturnValueOnce(replacementWave.promise);

      const stickyAttempt = Promise.withResolvers<Response>();
      const normalOneAttempt = Promise.withResolvers<Response>();
      const normalTwoAttempt = Promise.withResolvers<Response>();
      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );
      doForward.mockImplementation(async (attemptSession) => {
        switch ((attemptSession as ProxySession).provider?.id) {
          case sticky.id:
            return stickyAttempt.promise;
          case normalOne.id:
            return normalOneAttempt.promise;
          case normalTwo.id:
            return normalTwoAttempt.promise;
          default:
            throw new Error("unexpected Provider");
        }
      });

      const responsePromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(10);
      expect(mocks.clearVersionedSessionProvider).toHaveBeenCalledTimes(1);
      expect(mocks.pickDiscoveryProviders).not.toHaveBeenCalled();

      clearBinding.resolve({
        status: "ok",
        legacyFallbackAllowed: false,
        source: "cleared",
        snapshot: {
          sessionId: session.sessionId!,
          keyId: 28,
          providerId: null,
          generation: "g-cleared-single-wave",
        },
      });
      // Resolve the cooldown and fail the fallback in the same turn. This
      // exercises the claim-to-queue-start window: the claimed N-1 wave must
      // remain expandable to full concurrency before placeholders register.
      stickyAttempt.reject(new Error("Sticky fallback failed while the wave was being claimed"));
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.pickDiscoveryProviders).toHaveBeenCalledTimes(1);
      expect(mocks.pickDiscoveryProviders).toHaveBeenCalledWith(
        expect.anything(),
        2,
        expect.arrayContaining([sticky.id])
      );

      replacementWave.resolve([normalOne, normalTwo]);
      await vi.advanceTimersByTimeAsync(0);
      expect(doForward).toHaveBeenCalledTimes(3);

      normalOneAttempt.resolve(
        new Response('data: {"type":"content_block_delta","delta":{"text":"normal-one"}}\n\n', {
          headers: { "content-type": "text/event-stream" },
        })
      );
      await vi.advanceTimersByTimeAsync(0);
      const response = await responsePromise;
      expect(await response.text()).toContain('"normal-one"');
      expect(session.provider?.id).toBe(normalOne.id);

      normalTwoAttempt.resolve(new Response(null));
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("Sticky timeout cooldown completes once before a racing total deadline settles", async () => {
    vi.useFakeTimers();
    try {
      const sticky = createProvider({ id: 1, name: "sticky", priority: 1 });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 32 },
        apiKey: null,
      } as typeof session.authState;
      session.request.message.messages = [
        { role: "user", content: "first" },
        { role: "user", content: "second" },
      ];
      session.setProvider(sticky);
      session.setSessionBindingSnapshot({
        sessionId: session.sessionId!,
        keyId: 32,
        providerId: sticky.id,
        generation: "g-sticky-cooldown-deadline",
      });
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 1,
        discoverySlaMs: 20,
        stickySlaMs: 10,
        racingTotalTimeoutMs: 30,
        stickyTimeoutCooldownMs: 300_000,
      });

      const cooldownClear = Promise.withResolvers<{
        status: "ok";
        legacyFallbackAllowed: false;
        source: "cleared";
        snapshot: {
          sessionId: string;
          keyId: number;
          providerId: null;
          generation: string;
        };
      }>();
      const order: string[] = [];
      mocks.clearVersionedSessionProvider.mockImplementationOnce(
        async (_snapshot, _providerId, cooldownTtlSeconds) => {
          order.push(`cooldown-start:${cooldownTtlSeconds}`);
          const result = await cooldownClear.promise;
          order.push("cooldown-end");
          return result;
        }
      );
      mocks.releaseSessionDiscoveryLease.mockImplementationOnce(async () => {
        order.push("lease-release");
        return { status: "released", legacyFallbackAllowed: false };
      });
      vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      ).mockResolvedValueOnce(
        new Response(new ReadableStream<Uint8Array>(), {
          headers: { "content-type": "text/event-stream" },
        })
      );

      let requestSettled = false;
      const observed = ProxyForwarder.send(session).then(
        (response) => {
          requestSettled = true;
          return response;
        },
        (error) => {
          requestSettled = true;
          return error;
        }
      );

      await vi.advanceTimersByTimeAsync(10);
      expect(mocks.clearVersionedSessionProvider).toHaveBeenCalledWith(
        expect.objectContaining({ generation: "g-sticky-cooldown-deadline" }),
        sticky.id,
        300
      );
      expect(order).toEqual(["cooldown-start:300"]);

      await vi.advanceTimersByTimeAsync(20);
      expect(requestSettled).toBe(false);
      expect(mocks.clearVersionedSessionProvider).toHaveBeenCalledOnce();
      expect(mocks.releaseSessionDiscoveryLease).not.toHaveBeenCalled();

      cooldownClear.resolve({
        status: "ok",
        legacyFallbackAllowed: false,
        source: "cleared",
        snapshot: {
          sessionId: session.sessionId!,
          keyId: 32,
          providerId: null,
          generation: "g-sticky-cooldown-applied",
        },
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(await observed).toBeInstanceOf(UpstreamProxyError);
      expect(mocks.clearVersionedSessionProvider).toHaveBeenCalledOnce();
      expect(mocks.pickDiscoveryProviders).not.toHaveBeenCalled();
      expect(order).toEqual(["cooldown-start:300", "cooldown-end", "lease-release"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a racing deadline bounds a stalled Sticky cooldown cleanup", async () => {
    vi.useFakeTimers();
    try {
      const sticky = createProvider({ id: 1, name: "sticky", priority: 1 });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 39 },
        apiKey: null,
      } as typeof session.authState;
      session.request.message.messages = [
        { role: "user", content: "first" },
        { role: "user", content: "second" },
      ];
      session.setProvider(sticky);
      session.setSessionBindingSnapshot({
        sessionId: session.sessionId!,
        keyId: 39,
        providerId: sticky.id,
        generation: "g-sticky-cleanup-bound",
      });
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 1,
        discoverySlaMs: 20,
        stickySlaMs: 10,
        racingTotalTimeoutMs: 30,
        stickyTimeoutCooldownMs: 300_000,
      });
      mocks.clearVersionedSessionProvider.mockReturnValueOnce(new Promise(() => {}));
      vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      ).mockResolvedValueOnce(
        new Response(new ReadableStream<Uint8Array>(), {
          headers: { "content-type": "text/event-stream" },
        })
      );

      const observed = ProxyForwarder.send(session).catch((error) => error);
      await vi.advanceTimersByTimeAsync(30);
      let settled = false;
      void observed.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(999);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(await observed).toBeInstanceOf(UpstreamProxyError);
      expect(mocks.releaseSessionDiscoveryLease).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  test("client abort preserves an already-reserved Sticky timeout cooldown", async () => {
    vi.useFakeTimers();
    try {
      const clientAbort = new AbortController();
      const sticky = createProvider({ id: 1, name: "sticky", priority: 1 });
      const session = createSession(clientAbort.signal);
      session.authState = {
        success: true,
        user: null,
        key: { id: 33 },
        apiKey: null,
      } as typeof session.authState;
      session.request.message.messages = [
        { role: "user", content: "first" },
        { role: "user", content: "second" },
      ];
      session.setProvider(sticky);
      session.setSessionBindingSnapshot({
        sessionId: session.sessionId!,
        keyId: 33,
        providerId: sticky.id,
        generation: "g-sticky-cooldown-abort",
      });
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 1,
        discoverySlaMs: 50,
        stickySlaMs: 10,
        racingTotalTimeoutMs: 100,
        stickyTimeoutCooldownMs: 300_000,
      });

      const cooldownClear = Promise.withResolvers<{
        status: "ok";
        legacyFallbackAllowed: false;
        source: "cleared";
        snapshot: {
          sessionId: string;
          keyId: number;
          providerId: null;
          generation: string;
        };
      }>();
      mocks.clearVersionedSessionProvider.mockReturnValueOnce(cooldownClear.promise);
      vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      ).mockResolvedValueOnce(
        new Response(new ReadableStream<Uint8Array>(), {
          headers: { "content-type": "text/event-stream" },
        })
      );

      let requestSettled = false;
      const observed = ProxyForwarder.send(session).catch((error) => {
        requestSettled = true;
        return error;
      });
      await vi.advanceTimersByTimeAsync(10);
      clientAbort.abort(new Error("client disconnected"));
      await vi.advanceTimersByTimeAsync(0);

      expect(requestSettled).toBe(true);
      expect(mocks.clearVersionedSessionProvider).toHaveBeenCalledOnce();
      expect(mocks.clearVersionedSessionProvider).toHaveBeenCalledWith(
        expect.objectContaining({ generation: "g-sticky-cooldown-abort" }),
        sticky.id,
        300
      );

      cooldownClear.resolve({
        status: "ok",
        legacyFallbackAllowed: false,
        source: "cleared",
        snapshot: {
          sessionId: session.sessionId!,
          keyId: 33,
          providerId: null,
          generation: "g-sticky-cooldown-abort-applied",
        },
      });
      await vi.advanceTimersByTimeAsync(0);

      const error = await observed;
      expect(error).toBeInstanceOf(UpstreamProxyError);
      expect((error as UpstreamProxyError).statusCode).toBe(499);
      expect(mocks.clearVersionedSessionProvider).toHaveBeenCalledOnce();
      expect(mocks.releaseSessionDiscoveryLease).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  test("a ready-held Sticky fallback survives a stalled next-wave selector until the total deadline", async () => {
    vi.useFakeTimers();
    try {
      const sticky = createProvider({ id: 1, name: "sticky", priority: 1 });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 27 },
        apiKey: null,
      } as typeof session.authState;
      session.request.message.messages = [
        { role: "user", content: "first" },
        { role: "user", content: "second" },
      ];
      session.setProvider(sticky);
      session.setSessionBindingSnapshot({
        sessionId: session.sessionId!,
        keyId: 27,
        providerId: sticky.id,
        generation: "g-sticky-deadline",
      });
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 1,
        discoverySlaMs: 20,
        stickySlaMs: 10,
        racingTotalTimeoutMs: 50,
        stickyTimeoutCooldownMs: 300_000,
      });

      const stalledSelector = Promise.withResolvers<Provider[]>();
      mocks.pickDiscoveryProviders.mockReturnValueOnce(stalledSelector.promise);
      vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      ).mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              setTimeout(() => {
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"type":"content_block_delta","delta":{"text":"sticky-fallback"}}\n\n'
                  )
                );
                controller.close();
              }, 15);
            },
          }),
          { headers: { "content-type": "text/event-stream" } }
        )
      );

      let settledEarly = false;
      const responsePromise = ProxyForwarder.send(session).then((response) => {
        settledEarly = true;
        return response;
      });

      await vi.advanceTimersByTimeAsync(10);
      expect(mocks.pickDiscoveryProviders).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5);
      expect(settledEarly).toBe(false);

      await vi.advanceTimersByTimeAsync(35);
      const response = await responsePromise;
      const deferred = peekDeferredStreamingFinalization(session);
      expect(await response.text()).toContain('"sticky-fallback"');
      expect(session.provider?.id).toBe(sticky.id);
      expect(deferred?.bindingIntent).toBe("none");
      expect(deferred?.requiresCompletionMarker).toBe(true);

      stalledSelector.resolve([]);
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("Sticky probing does not consume a configured Discovery round", async () => {
    vi.useFakeTimers();
    try {
      const sticky = createProvider({ id: 1, name: "sticky", priority: 1 });
      const roundOne = createProvider({
        id: 2,
        name: "round-one",
        priority: 1,
      });
      const roundTwo = createProvider({
        id: 3,
        name: "round-two",
        priority: 1,
      });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 19 },
        apiKey: null,
      } as typeof session.authState;
      session.request.message.messages = [
        { role: "user", content: "first" },
        { role: "user", content: "second" },
      ];
      session.setProvider(sticky);
      session.setSessionBindingSnapshot({
        sessionId: session.sessionId!,
        keyId: 19,
        providerId: sticky.id,
        generation: "g-sticky-rounds",
      });
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 2,
        discoverySlaMs: 20,
        stickySlaMs: 10,
        racingTotalTimeoutMs: 100,
        stickyTimeoutCooldownMs: 300_000,
      });
      mocks.pickDiscoveryProviders
        .mockResolvedValueOnce([roundOne])
        .mockResolvedValueOnce([roundTwo]);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );
      doForward.mockImplementation(async (attemptSession) => {
        const providerId = (attemptSession as ProxySession).provider?.id;
        if (providerId !== roundTwo.id) {
          return new Response(new ReadableStream<Uint8Array>(), {
            headers: { "content-type": "text/event-stream" },
          });
        }
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              setTimeout(() => {
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"type":"content_block_delta","delta":{"text":"round-two"}}\n\n'
                  )
                );
                controller.close();
              }, 5);
            },
          }),
          { headers: { "content-type": "text/event-stream" } }
        );
      });

      const responsePromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(20);
      await vi.advanceTimersByTimeAsync(5);

      const response = await responsePromise;
      expect(await response.text()).toContain('"round-two"');
      expect(session.provider?.id).toBe(roundTwo.id);
      expect(mocks.pickDiscoveryProviders).toHaveBeenCalledTimes(2);
      expect(doForward).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test("Sticky timeout still starts one normal wave when maxDiscoveryRounds is one", async () => {
    vi.useFakeTimers();
    try {
      const sticky = createProvider({ id: 1, name: "sticky", priority: 1 });
      const normal = createProvider({ id: 2, name: "normal", priority: 1 });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 21 },
        apiKey: null,
      } as typeof session.authState;
      session.request.message.messages = [
        { role: "user", content: "first" },
        { role: "user", content: "second" },
      ];
      session.setProvider(sticky);
      session.setSessionBindingSnapshot({
        sessionId: session.sessionId!,
        keyId: 21,
        providerId: sticky.id,
        generation: "g-sticky-one-round",
      });
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 1,
        discoverySlaMs: 20,
        stickySlaMs: 10,
        racingTotalTimeoutMs: 100,
        stickyTimeoutCooldownMs: 300_000,
      });
      mocks.pickDiscoveryProviders.mockResolvedValueOnce([normal]);

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );
      doForward.mockImplementation(async (attemptSession) => {
        if ((attemptSession as ProxySession).provider?.id === sticky.id) {
          return new Response(new ReadableStream<Uint8Array>(), {
            headers: { "content-type": "text/event-stream" },
          });
        }
        return new Response('data: {"type":"content_block_delta","delta":{"text":"normal"}}\n\n', {
          headers: { "content-type": "text/event-stream" },
        });
      });

      const responsePromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(10);
      const response = await responsePromise;

      expect(await response.text()).toContain('"normal"');
      expect(mocks.pickDiscoveryProviders).toHaveBeenCalledWith(
        expect.anything(),
        1,
        expect.arrayContaining([sticky.id])
      );
      expect(doForward).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("Sticky Discovery refills a slot immediately after candidate setup fails", async () => {
    vi.useFakeTimers();
    let endpointResolver: ReturnType<typeof vi.spyOn> | null = null;
    try {
      const sticky = createProvider({ id: 1, name: "sticky", priority: 1 });
      const setupFailure = createProvider({
        id: 2,
        name: "setup-failure",
        priority: 1,
      });
      const replacement = createProvider({
        id: 3,
        name: "replacement",
        priority: 1,
      });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 30 },
        apiKey: null,
      } as typeof session.authState;
      session.request.message.messages = [
        { role: "user", content: "first" },
        { role: "user", content: "second" },
      ];
      session.setProvider(sticky);
      session.setSessionBindingSnapshot({
        sessionId: session.sessionId!,
        keyId: 30,
        providerId: sticky.id,
        generation: "setup-refill-generation",
      });
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 1,
        discoverySlaMs: 50,
        stickySlaMs: 10,
        racingTotalTimeoutMs: 200,
        stickyTimeoutCooldownMs: 300_000,
      });
      mocks.pickDiscoveryProviders
        .mockResolvedValueOnce([setupFailure])
        .mockResolvedValueOnce([replacement]);

      endpointResolver = vi.spyOn(
        ProxyForwarder as unknown as {
          resolveStreamingHedgeEndpoint: (
            session: ProxySession,
            provider: Provider
          ) => Promise<{
            endpointId: number | null;
            baseUrl: string;
            endpointUrl: string;
          }>;
        },
        "resolveStreamingHedgeEndpoint"
      );
      endpointResolver.mockImplementation(async (_attemptSession, provider) => {
        if (provider.id === setupFailure.id) throw new Error("candidate endpoint setup failed");
        return {
          endpointId: null,
          baseUrl: provider.url,
          endpointUrl: provider.url,
        };
      });

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );
      doForward.mockImplementation(async (attemptSession) => {
        if ((attemptSession as ProxySession).provider?.id === sticky.id) {
          return new Response(new ReadableStream<Uint8Array>(), {
            headers: { "content-type": "text/event-stream" },
          });
        }
        return new Response(
          'data: {"type":"content_block_delta","delta":{"text":"replacement"}}\n\n',
          { headers: { "content-type": "text/event-stream" } }
        );
      });

      const responsePromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(0);
      const response = await responsePromise;

      expect(await response.text()).toContain('"replacement"');
      expect(mocks.pickDiscoveryProviders).toHaveBeenCalledTimes(2);
      expect(mocks.pickDiscoveryProviders).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        1,
        expect.arrayContaining([sticky.id, setupFailure.id])
      );
      expect(doForward).toHaveBeenCalledTimes(2);
      expect(session.provider?.id).toBe(replacement.id);
    } finally {
      endpointResolver?.mockRestore();
      vi.useRealTimers();
    }
  });

  test("Discovery keeps refilling the current round when an error replacement fails setup", async () => {
    const initialFailure = createProvider({
      id: 1,
      name: "initial-failure",
      priority: 1,
    });
    const pending = createProvider({ id: 2, name: "pending", priority: 1 });
    const setupFailure = createProvider({
      id: 3,
      name: "setup-failure",
      priority: 1,
    });
    const healthy = createProvider({ id: 4, name: "healthy", priority: 1 });
    const session = createSession();
    session.authState = {
      success: true,
      user: null,
      key: { id: 31 },
      apiKey: null,
    } as typeof session.authState;
    session.setProvider(initialFailure);
    mocks.getCachedSystemSettings.mockResolvedValue({
      discoveryEnabled: true,
      discoveryConcurrency: 2,
      maxDiscoveryRounds: 1,
      discoverySlaMs: 50,
      stickySlaMs: 50,
      racingTotalTimeoutMs: 200,
      stickyTimeoutCooldownMs: 300_000,
    });
    mocks.pickDiscoveryProviders
      .mockResolvedValueOnce([pending])
      .mockResolvedValueOnce([setupFailure])
      .mockResolvedValueOnce([healthy]);

    const endpointResolver = vi.spyOn(
      ProxyForwarder as unknown as {
        resolveStreamingHedgeEndpoint: (
          session: ProxySession,
          provider: Provider
        ) => Promise<{
          endpointId: number | null;
          baseUrl: string;
          endpointUrl: string;
        }>;
      },
      "resolveStreamingHedgeEndpoint"
    );
    endpointResolver.mockImplementation(async (_attemptSession, provider) => {
      if (provider.id === setupFailure.id) throw new Error("replacement setup failed");
      return {
        endpointId: null,
        baseUrl: provider.url,
        endpointUrl: provider.url,
      };
    });

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      },
      "doForward"
    );
    doForward.mockImplementation(async (attemptSession) => {
      const providerId = (attemptSession as ProxySession).provider?.id;
      if (providerId === initialFailure.id) throw new Error("initial Provider failed");
      if (providerId === healthy.id) {
        return new Response('data: {"type":"content_block_delta","delta":{"text":"healthy"}}\n\n', {
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response(new ReadableStream<Uint8Array>(), {
        headers: { "content-type": "text/event-stream" },
      });
    });

    try {
      const response = await ProxyForwarder.send(session);

      expect(await response.text()).toContain('"healthy"');
      expect(mocks.pickDiscoveryProviders).toHaveBeenCalledTimes(3);
      expect(mocks.pickDiscoveryProviders).toHaveBeenNthCalledWith(
        3,
        expect.anything(),
        1,
        expect.arrayContaining([initialFailure.id, pending.id, setupFailure.id])
      );
      expect(doForward).toHaveBeenCalledTimes(3);
      expect(session.provider?.id).toBe(healthy.id);
    } finally {
      endpointResolver.mockRestore();
    }
  });

  test("an explicit Sticky failure starts Discovery round one at full concurrency", async () => {
    const sticky = createProvider({ id: 1, name: "sticky", priority: 1 });
    const normal = createProvider({ id: 2, name: "normal", priority: 1 });
    const session = createSession();
    session.authState = {
      success: true,
      user: null,
      key: { id: 22 },
      apiKey: null,
    } as typeof session.authState;
    session.request.message.messages = [
      { role: "user", content: "first" },
      { role: "user", content: "second" },
    ];
    session.setProvider(sticky);
    session.setSessionBindingSnapshot({
      sessionId: session.sessionId!,
      keyId: 22,
      providerId: sticky.id,
      generation: "g-sticky-failure",
    });
    mocks.getCachedSystemSettings.mockResolvedValue({
      discoveryEnabled: true,
      discoveryConcurrency: 2,
      maxDiscoveryRounds: 1,
      discoverySlaMs: 50,
      stickySlaMs: 50,
      racingTotalTimeoutMs: 200,
      stickyTimeoutCooldownMs: 300_000,
    });
    mocks.pickDiscoveryProviders.mockResolvedValueOnce([normal]);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      },
      "doForward"
    );
    doForward.mockRejectedValueOnce(new Error("Sticky upstream failed")).mockResolvedValueOnce(
      new Response('data: {"type":"content_block_delta","delta":{"text":"normal"}}\n\n', {
        headers: { "content-type": "text/event-stream" },
      })
    );

    const response = await ProxyForwarder.send(session);
    expect(await response.text()).toContain('"normal"');
    expect(mocks.pickDiscoveryProviders).toHaveBeenCalledWith(
      expect.anything(),
      2,
      expect.arrayContaining([sticky.id])
    );
    expect(doForward).toHaveBeenCalledTimes(2);
    expect(mocks.clearVersionedSessionProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: sticky.id,
        generation: "g-sticky-failure",
      }),
      sticky.id,
      0
    );
  });

  test("Discovery eligibility excludes WebSocket-tunneled requests", async () => {
    const provider = createProvider({ id: 1, firstByteTimeoutStreamingMs: 0 });
    const session = createSession();
    session.authState = {
      success: true,
      user: null,
      key: { id: 23 },
      apiKey: null,
    } as typeof session.authState;
    session.setProvider(provider);
    mocks.getCachedSystemSettings.mockResolvedValue({ discoveryEnabled: true });
    mocks.isWebsocketClientRequest.mockReturnValueOnce(true);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      },
      "doForward"
    );
    doForward.mockResolvedValueOnce(
      new Response('data: {"type":"message_stop"}\n\n', {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })
    );

    await ProxyForwarder.send(session);
    expect(doForward).toHaveBeenCalledTimes(1);
    expect(mocks.acquireSessionDiscoveryLease).not.toHaveBeenCalled();
    expect(mocks.pickDiscoveryProviders).not.toHaveBeenCalled();
  });

  test("Discovery stops immediately on local database admission overload", async () => {
    const provider = createProvider({ id: 1 });
    const alternative = createProvider({ id: 2 });
    const session = createSession();
    session.authState = {
      success: true,
      user: null,
      key: { id: 24 },
      apiKey: null,
    } as typeof session.authState;
    session.setProvider(provider);
    mocks.getCachedSystemSettings.mockResolvedValue({
      discoveryEnabled: true,
      discoveryConcurrency: 2,
      maxDiscoveryRounds: 1,
      discoverySlaMs: 50,
      stickySlaMs: 50,
      racingTotalTimeoutMs: 200,
    });
    mocks.pickDiscoveryProviders.mockResolvedValueOnce([alternative]);
    mocks.categorizeErrorAsync.mockResolvedValueOnce(ProxyErrorCategory.LOCAL_OVERLOAD);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      },
      "doForward"
    );
    const overload = new DbPoolAdmissionError("data", 32);
    doForward.mockRejectedValueOnce(overload);

    await expect(ProxyForwarder.send(session)).rejects.toBe(overload);
    expect(doForward).toHaveBeenCalledTimes(1);
    expect(mocks.recordFailure).not.toHaveBeenCalled();
    expect(mocks.releaseSessionDiscoveryLease).toHaveBeenCalledTimes(1);
  });

  test("Discovery clears terminal binding state before releasing its lease", async () => {
    const provider = createProvider({ id: 1 });
    const session = createSession();
    session.authState = {
      success: true,
      user: null,
      key: { id: 29 },
      apiKey: null,
    } as typeof session.authState;
    session.setProvider(provider);
    session.setSessionBindingSnapshot({
      sessionId: session.sessionId!,
      keyId: 29,
      providerId: provider.id,
      generation: "terminal-clear-generation",
    });
    mocks.getCachedSystemSettings.mockResolvedValue({
      discoveryEnabled: true,
      discoveryConcurrency: 2,
      maxDiscoveryRounds: 1,
      discoverySlaMs: 100,
      stickySlaMs: 100,
      racingTotalTimeoutMs: 500,
    });
    const order: string[] = [];
    const clear = Promise.withResolvers<{
      status: "ok";
      legacyFallbackAllowed: false;
      source: "cleared";
      snapshot: {
        sessionId: string;
        keyId: number;
        providerId: null;
        generation: string;
      };
    }>();
    mocks.clearVersionedSessionProvider.mockImplementationOnce(async () => {
      order.push("clear-start");
      const result = await clear.promise;
      order.push("clear-end");
      return result;
    });
    mocks.releaseSessionDiscoveryLease.mockImplementationOnce(async () => {
      order.push("lease-release");
      return { status: "released", legacyFallbackAllowed: false };
    });
    vi.spyOn(
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      },
      "doForward"
    ).mockRejectedValueOnce(new Error("terminal upstream failure"));

    const observed = ProxyForwarder.send(session).catch((error) => error);
    for (let index = 0; index < 10 && order.length === 0; index++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(order).toEqual(["clear-start"]);
    expect(mocks.releaseSessionDiscoveryLease).not.toHaveBeenCalled();

    clear.resolve({
      status: "ok",
      legacyFallbackAllowed: false,
      source: "cleared",
      snapshot: {
        sessionId: session.sessionId!,
        keyId: 29,
        providerId: null,
        generation: "terminal-cleared-generation",
      },
    });
    expect(await observed).toBeInstanceOf(Error);
    expect(mocks.clearVersionedSessionProvider).toHaveBeenCalledOnce();
    expect(mocks.releaseSessionDiscoveryLease).toHaveBeenCalledOnce();
    expect(order).toEqual(["clear-start", "clear-end", "lease-release"]);
  });

  test("Discovery total deadline is not blocked by a stalled candidate selector", async () => {
    vi.useFakeTimers();
    try {
      const provider = createProvider({ id: 1 });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 25 },
        apiKey: null,
      } as typeof session.authState;
      session.setProvider(provider);
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 1,
        discoverySlaMs: 20,
        stickySlaMs: 20,
        racingTotalTimeoutMs: 50,
      });
      mocks.pickDiscoveryProviders.mockReturnValueOnce(new Promise(() => {}));

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );
      doForward.mockResolvedValueOnce(
        new Response(new ReadableStream<Uint8Array>(), {
          headers: { "content-type": "text/event-stream" },
        })
      );

      const responsePromise = ProxyForwarder.send(session);
      const observedError = responsePromise.catch((error) => error);
      await vi.advanceTimersByTimeAsync(50);
      expect(await observedError).toBeInstanceOf(UpstreamProxyError);
      expect(mocks.releaseSessionDiscoveryLease).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("Discovery round SLA advances while the initial candidate selector is stalled", async () => {
    vi.useFakeTimers();
    try {
      const initial = createProvider({ id: 1, name: "initial", priority: 1 });
      const winner = createProvider({ id: 2, name: "next-round", priority: 1 });
      const stale = createProvider({ id: 3, name: "stale", priority: 1 });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 39 },
        apiKey: null,
      } as typeof session.authState;
      session.setProvider(initial);
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 2,
        discoverySlaMs: 10,
        stickySlaMs: 10,
        racingTotalTimeoutMs: 100,
        stickyTimeoutCooldownMs: 300_000,
      });

      const stalledSelector = Promise.withResolvers<Provider[]>();
      const selectorStarted = Promise.withResolvers<void>();
      mocks.pickDiscoveryProviders
        .mockImplementationOnce(() => {
          selectorStarted.resolve();
          return stalledSelector.promise;
        })
        .mockResolvedValueOnce([winner]);

      const launchedProviderIds: number[] = [];
      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );
      doForward.mockImplementation(async (attemptSession) => {
        const providerId = (attemptSession as ProxySession).provider!.id;
        launchedProviderIds.push(providerId);
        if (providerId === winner.id) {
          return new Response('data: {"type":"content_block_delta","delta":{"text":"next"}}\n\n', {
            headers: { "content-type": "text/event-stream" },
          });
        }
        return new Response(new ReadableStream<Uint8Array>(), {
          headers: { "content-type": "text/event-stream" },
        });
      });

      const responsePromise = ProxyForwarder.send(session);
      await selectorStarted.promise;
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(0);

      expect(mocks.pickDiscoveryProviders).toHaveBeenCalledTimes(2);
      const response = await responsePromise;
      expect(await response.text()).toContain('"next"');

      stalledSelector.resolve([stale]);
      await vi.advanceTimersByTimeAsync(0);
      expect(launchedProviderIds).toEqual([initial.id, winner.id]);
      expect(doForward).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a ready fallback stays held until the queued next wave registers", async () => {
    vi.useFakeTimers();
    let endpointResolver: ReturnType<typeof vi.spyOn> | null = null;
    try {
      const fallback = createProvider({ id: 1, name: "fallback", priority: 1 });
      const setup = createProvider({
        id: 2,
        name: "cancelled-setup",
        priority: 1,
        limitConcurrentSessions: 1,
      });
      const winner = createProvider({
        id: 3,
        name: "next-round-winner",
        priority: 1,
      });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 40 },
        apiKey: null,
      } as typeof session.authState;
      session.setProvider(fallback);
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 2,
        discoverySlaMs: 10,
        stickySlaMs: 10,
        racingTotalTimeoutMs: 100,
        stickyTimeoutCooldownMs: 300_000,
      });
      mocks.pickDiscoveryProviders.mockResolvedValueOnce([setup]).mockResolvedValueOnce([winner]);

      endpointResolver = vi.spyOn(
        ProxyForwarder as unknown as {
          resolveStreamingHedgeEndpoint: (
            session: ProxySession,
            provider: Provider
          ) => Promise<{
            endpointId: number | null;
            baseUrl: string;
            endpointUrl: string;
          }>;
        },
        "resolveStreamingHedgeEndpoint"
      );
      endpointResolver.mockImplementation(async (_attemptSession, provider) => {
        if (provider.id === setup.id) return new Promise(() => {});
        return {
          endpointId: null,
          baseUrl: provider.url,
          endpointUrl: provider.url,
        };
      });

      let fallbackController: ReadableStreamDefaultController<Uint8Array> | null = null;
      const launchedProviderIds: number[] = [];
      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );
      doForward.mockImplementation(async (attemptSession) => {
        const providerId = (attemptSession as ProxySession).provider!.id;
        launchedProviderIds.push(providerId);
        if (providerId === winner.id) {
          return new Response(
            'data: {"type":"content_block_delta","delta":{"text":"winner"}}\n\n',
            { headers: { "content-type": "text/event-stream" } }
          );
        }
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              fallbackController = controller;
            },
          }),
          { headers: { "content-type": "text/event-stream" } }
        );
      });
      mocks.releaseProviderSession.mockImplementation(async (providerId) => {
        if (providerId !== setup.id || !fallbackController) return;
        fallbackController.enqueue(
          new TextEncoder().encode(
            'data: {"type":"content_block_delta","delta":{"text":"fallback"}}\n\n'
          )
        );
        fallbackController.close();
      });

      const responsePromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(0);

      const response = await responsePromise;
      expect(await response.text()).toContain('"winner"');
      expect(launchedProviderIds).toEqual([fallback.id, winner.id]);
      expect(mocks.pickDiscoveryProviders).toHaveBeenCalledTimes(2);
      expect(mocks.releaseProviderSession).toHaveBeenCalledWith(setup.id, session.sessionId);
    } finally {
      endpointResolver?.mockRestore();
      mocks.releaseProviderSession.mockImplementation(async () => {});
      vi.useRealTimers();
    }
  });

  test("a failing fallback waits for the queued next wave handoff", async () => {
    vi.useFakeTimers();
    let endpointResolver: ReturnType<typeof vi.spyOn> | null = null;
    try {
      const fallback = createProvider({ id: 1, name: "fallback", priority: 1 });
      const setup = createProvider({
        id: 2,
        name: "cancelled-setup",
        priority: 1,
      });
      const stalled = createProvider({
        id: 3,
        name: "stalled-next-wave",
        priority: 1,
      });
      const winner = createProvider({
        id: 4,
        name: "error-refill-winner",
        priority: 1,
      });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 41 },
        apiKey: null,
      } as typeof session.authState;
      session.setProvider(fallback);
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 2,
        discoverySlaMs: 10,
        stickySlaMs: 10,
        racingTotalTimeoutMs: 100,
        stickyTimeoutCooldownMs: 300_000,
      });
      const stalledNextWave = Promise.withResolvers<Provider[]>();
      const stalledNextWaveStarted = Promise.withResolvers<void>();
      mocks.pickDiscoveryProviders
        .mockResolvedValueOnce([setup])
        .mockImplementationOnce(() => {
          stalledNextWaveStarted.resolve();
          return stalledNextWave.promise;
        })
        .mockResolvedValueOnce([winner]);

      endpointResolver = vi.spyOn(
        ProxyForwarder as unknown as {
          resolveStreamingHedgeEndpoint: (
            session: ProxySession,
            provider: Provider
          ) => Promise<{
            endpointId: number | null;
            baseUrl: string;
            endpointUrl: string;
          }>;
        },
        "resolveStreamingHedgeEndpoint"
      );
      endpointResolver.mockImplementation(async (_attemptSession, provider) => {
        if (provider.id === setup.id) return new Promise(() => {});
        return {
          endpointId: null,
          baseUrl: provider.url,
          endpointUrl: provider.url,
        };
      });

      const fallbackFailure = Promise.withResolvers<Response>();
      const launchedProviderIds: number[] = [];
      vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      ).mockImplementation(async (attemptSession) => {
        const providerId = (attemptSession as ProxySession).provider!.id;
        launchedProviderIds.push(providerId);
        if (providerId === fallback.id) return fallbackFailure.promise;
        return new Response('data: {"type":"content_block_delta","delta":{"text":"winner"}}\n\n', {
          headers: { "content-type": "text/event-stream" },
        });
      });
      const responsePromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(10);
      await stalledNextWaveStarted.promise;
      fallbackFailure.reject(new Error("fallback failed after queued-wave handoff"));
      await vi.advanceTimersByTimeAsync(0);

      const response = await responsePromise;
      expect(await response.text()).toContain('"winner"');
      expect(launchedProviderIds).toEqual([fallback.id, winner.id]);
      expect(mocks.pickDiscoveryProviders).toHaveBeenCalledTimes(3);

      stalledNextWave.resolve([stalled]);
      await vi.advanceTimersByTimeAsync(0);
      expect(launchedProviderIds).toEqual([fallback.id, winner.id]);
    } finally {
      endpointResolver?.mockRestore();
      vi.useRealTimers();
    }
  });

  test("a stale candidate selector cannot launch after its Discovery round closes", async () => {
    vi.useFakeTimers();
    try {
      const initial = createProvider({ id: 1, name: "initial", priority: 1 });
      const peer = createProvider({ id: 2, name: "peer", priority: 1 });
      const nextRound = createProvider({
        id: 3,
        name: "next-round",
        priority: 1,
      });
      const stale = createProvider({ id: 4, name: "stale", priority: 1 });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 37 },
        apiKey: null,
      } as typeof session.authState;
      session.setProvider(initial);
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 2,
        discoverySlaMs: 10,
        stickySlaMs: 10,
        racingTotalTimeoutMs: 100,
        stickyTimeoutCooldownMs: 300_000,
      });
      const staleSelector = Promise.withResolvers<Provider[]>();
      const refillStarted = Promise.withResolvers<void>();
      mocks.pickDiscoveryProviders
        .mockResolvedValueOnce([peer])
        .mockImplementationOnce(() => {
          refillStarted.resolve();
          return staleSelector.promise;
        })
        .mockResolvedValueOnce([nextRound]);

      const launchedProviderIds: number[] = [];
      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );
      doForward.mockImplementation(async (attemptSession) => {
        const providerId = (attemptSession as ProxySession).provider!.id;
        launchedProviderIds.push(providerId);
        if (providerId === initial.id) throw new Error("initial failed");
        if (providerId === nextRound.id) {
          return new Response('data: {"type":"content_block_delta","delta":{"text":"next"}}\n\n', {
            headers: { "content-type": "text/event-stream" },
          });
        }
        return new Response(new ReadableStream<Uint8Array>(), {
          headers: { "content-type": "text/event-stream" },
        });
      });

      const responsePromise = ProxyForwarder.send(session);
      await refillStarted.promise;
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.pickDiscoveryProviders).toHaveBeenCalledTimes(3);

      staleSelector.resolve([stale]);
      await vi.advanceTimersByTimeAsync(0);

      const response = await responsePromise;
      expect(await response.text()).toContain('"next"');
      expect(launchedProviderIds).toEqual([initial.id, peer.id, nextRound.id]);
      expect(doForward).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a round-cancelled attempt cannot win when its upstream ignores abort and resolves late", async () => {
    vi.useFakeTimers();
    try {
      const fallback = createProvider({ id: 1, name: "fallback", priority: 1 });
      const cancelled = createProvider({
        id: 2,
        name: "cancelled",
        priority: 10,
      });
      const winner = createProvider({
        id: 3,
        name: "next-round-winner",
        priority: 1,
      });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 42 },
        apiKey: null,
      } as typeof session.authState;
      session.setProvider(fallback);
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 2,
        discoverySlaMs: 10,
        stickySlaMs: 10,
        racingTotalTimeoutMs: 100,
        stickyTimeoutCooldownMs: 300_000,
      });
      mocks.pickDiscoveryProviders
        .mockResolvedValueOnce([cancelled])
        .mockResolvedValueOnce([winner]);

      const cancelledResponse = Promise.withResolvers<Response>();
      const winnerResponse = Promise.withResolvers<Response>();
      const cancelledReader = vi.fn();
      const cancelledAgentRelease = vi.fn();
      let cancelledSignal: AbortSignal | undefined;
      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );
      doForward.mockImplementation(async (attemptSession, ...args) => {
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        const providerId = runtime.provider!.id;
        if (providerId === cancelled.id) {
          cancelledSignal = args.at(-1) as AbortSignal;
          runtime.releaseAgent = cancelledAgentRelease;
          return cancelledResponse.promise;
        }
        if (providerId === winner.id) return winnerResponse.promise;
        return new Response(new ReadableStream<Uint8Array>(), {
          headers: { "content-type": "text/event-stream" },
        });
      });

      let responseSettled = false;
      const responsePromise = ProxyForwarder.send(session).then((response) => {
        responseSettled = true;
        return response;
      });
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(0);

      expect(cancelledSignal?.aborted).toBe(true);
      expect(doForward).toHaveBeenCalledTimes(3);

      cancelledResponse.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"type":"content_block_delta","delta":{"text":"too-late"}}\n\n'
                )
              );
            },
            cancel: cancelledReader,
          }),
          { headers: { "content-type": "text/event-stream" } }
        )
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(responseSettled).toBe(false);
      expect(session.provider?.id).not.toBe(cancelled.id);
      expect(cancelledReader).toHaveBeenCalledOnce();
      expect(cancelledAgentRelease).toHaveBeenCalledOnce();
      expect(
        mocks.releaseProviderSession.mock.calls.filter(
          ([providerId]) => providerId === cancelled.id
        )
      ).toHaveLength(1);

      winnerResponse.resolve(
        new Response('data: {"type":"content_block_delta","delta":{"text":"winner"}}\n\n', {
          headers: { "content-type": "text/event-stream" },
        })
      );
      await vi.advanceTimersByTimeAsync(0);

      const response = await responsePromise;
      expect(await response.text()).toContain('"winner"');
      expect(session.provider?.id).toBe(winner.id);
      expect(cancelledReader).toHaveBeenCalledOnce();
      expect(cancelledAgentRelease).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  test("a fallback failure refills the reserved round without waiting for its stalled selector", async () => {
    vi.useFakeTimers();
    try {
      const fallback = createProvider({ id: 1, name: "fallback", priority: 1 });
      const firstRoundLoser = createProvider({
        id: 2,
        name: "first-round-loser",
        priority: 1,
      });
      const nextRoundWinner = createProvider({
        id: 3,
        name: "next-round-winner",
        priority: 1,
      });
      const staleReservedCandidate = createProvider({
        id: 4,
        name: "stale-reserved-candidate",
        priority: 1,
      });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 26 },
        apiKey: null,
      } as typeof session.authState;
      session.setProvider(fallback);
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 3,
        discoverySlaMs: 10,
        stickySlaMs: 10,
        racingTotalTimeoutMs: 100,
      });

      const reservedWave = Promise.withResolvers<Provider[]>();
      mocks.pickDiscoveryProviders
        .mockResolvedValueOnce([firstRoundLoser])
        .mockReturnValueOnce(reservedWave.promise)
        .mockResolvedValueOnce([nextRoundWinner]);

      const fallbackFailure = Promise.withResolvers<Response>();
      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );
      doForward.mockImplementation(async (attemptSession) => {
        const providerId = (attemptSession as ProxySession).provider?.id;
        if (providerId === fallback.id) return fallbackFailure.promise;
        if (providerId === nextRoundWinner.id) {
          return new Response(
            'data: {"type":"content_block_delta","delta":{"text":"winner"}}\n\n',
            { headers: { "content-type": "text/event-stream" } }
          );
        }
        return new Response(new ReadableStream<Uint8Array>(), {
          headers: { "content-type": "text/event-stream" },
        });
      });

      const responsePromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(10);
      expect(mocks.pickDiscoveryProviders).toHaveBeenCalledTimes(2);

      fallbackFailure.reject(new Error("fallback failed during reserved wave"));
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.pickDiscoveryProviders).toHaveBeenCalledTimes(3);

      const response = await responsePromise;
      expect(await response.text()).toContain('"winner"');

      reservedWave.resolve([staleReservedCandidate]);
      await vi.advanceTimersByTimeAsync(0);
      expect(doForward).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test("Discovery does not immediately reselect a Provider whose launch setup failed", async () => {
    const initial = createProvider({ id: 1, name: "initial" });
    const alternative = createProvider({ id: 2, name: "alternative" });
    const session = createSession();
    session.authState = {
      success: true,
      user: null,
      key: { id: 20 },
      apiKey: null,
    } as typeof session.authState;
    session.setProvider(initial);
    mocks.getCachedSystemSettings.mockResolvedValue({
      discoveryEnabled: true,
      discoveryConcurrency: 2,
      maxDiscoveryRounds: 1,
      discoverySlaMs: 50,
      stickySlaMs: 50,
      racingTotalTimeoutMs: 200,
      stickyTimeoutCooldownMs: 300_000,
    });
    mocks.pickDiscoveryProviders.mockImplementationOnce(
      async (_session: ProxySession, _count: number, excludedIds: number[]) => {
        expect(excludedIds).toContain(initial.id);
        return [alternative];
      }
    );

    const endpointResolver = vi.spyOn(
      ProxyForwarder as unknown as {
        resolveStreamingHedgeEndpoint: (
          session: ProxySession,
          provider: Provider
        ) => Promise<{
          endpointId: number | null;
          baseUrl: string;
          endpointUrl: string;
        }>;
      },
      "resolveStreamingHedgeEndpoint"
    );
    endpointResolver
      .mockRejectedValueOnce(new Error("initial endpoint setup failed"))
      .mockResolvedValue({
        endpointId: null,
        baseUrl: alternative.url,
        endpointUrl: alternative.url,
      });

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      },
      "doForward"
    );
    doForward.mockResolvedValueOnce(
      new Response('data: {"type":"content_block_delta","delta":{"text":"alternative"}}\n\n', {
        headers: { "content-type": "text/event-stream" },
      })
    );

    try {
      const response = await ProxyForwarder.send(session);
      expect(await response.text()).toContain('"alternative"');
      expect(doForward).toHaveBeenCalledTimes(1);
      expect(session.provider?.id).toBe(alternative.id);
    } finally {
      endpointResolver.mockRestore();
    }
  });

  test("Discovery transfers the Provider session ref when a rectifier retries the same Provider", async () => {
    const initial = createProvider({
      id: 1,
      name: "initial",
      limitConcurrentSessions: 1,
    });
    const alternative = createProvider({
      id: 2,
      name: "alternative",
      limitConcurrentSessions: 1,
    });
    const session = createSession();
    session.authState = {
      success: true,
      user: null,
      key: { id: 22 },
      apiKey: null,
    } as typeof session.authState;
    setProviderWithSessionRef(session, initial);
    withThinkingBlocks(session);
    mocks.getCachedSystemSettings.mockResolvedValue({
      discoveryEnabled: true,
      discoveryConcurrency: 2,
      maxDiscoveryRounds: 1,
      discoverySlaMs: 100,
      stickySlaMs: 100,
      racingTotalTimeoutMs: 500,
      stickyTimeoutCooldownMs: 300_000,
      enableThinkingSignatureRectifier: true,
    });
    mocks.pickDiscoveryProviders.mockResolvedValueOnce([alternative]);

    const signatureError = new UpstreamProxyError("Invalid `signature` in `thinking` block", 400, {
      body: '{"error":"invalid_signature"}',
      providerId: initial.id,
      providerName: initial.name,
    });
    let initialAttempts = 0;
    const doForward = vi.spyOn(
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      },
      "doForward"
    );
    doForward.mockImplementation(async (attemptSession) => {
      const runtime = attemptSession as ProxySession & AttemptRuntime;
      if (runtime.provider?.id === initial.id) {
        initialAttempts += 1;
        if (initialAttempts === 1) throw signatureError;

        const body = runtime.request.message as {
          messages: Array<{ content: Array<Record<string, unknown>> }>;
        };
        expect(body.messages[0].content.some((block) => "signature" in block)).toBe(false);
        return new Response(
          'data: {"type":"content_block_delta","delta":{"text":"rectified"}}\n\n',
          { headers: { "content-type": "text/event-stream" } }
        );
      }

      return new Response(new ReadableStream<Uint8Array>(), {
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await ProxyForwarder.send(session);
    expect(await response.text()).toContain('"rectified"');

    const initialAdmissionCalls = mocks.checkAndTrackProviderSession.mock.calls.filter(
      ([providerId]) => providerId === initial.id
    );
    const initialReleaseCalls = mocks.releaseProviderSession.mock.calls.filter(
      ([providerId]) => providerId === initial.id
    );
    expect(initialAttempts).toBe(2);
    expect(initialAdmissionCalls).toHaveLength(0);
    expect(initialReleaseCalls).toHaveLength(0);
    expect(session.hasProviderSessionRef(initial.id)).toBe(true);
  });

  test("Discovery keeps a healthy peer when rectifier retry setup fails", async () => {
    const initial = createProvider({
      id: 1,
      name: "initial",
      limitConcurrentSessions: 1,
    });
    const alternative = createProvider({ id: 2, name: "alternative" });
    const session = createSession();
    session.authState = {
      success: true,
      user: null,
      key: { id: 24 },
      apiKey: null,
    } as typeof session.authState;
    setProviderWithSessionRef(session, initial);
    withThinkingBlocks(session);
    mocks.getCachedSystemSettings.mockResolvedValue({
      discoveryEnabled: true,
      discoveryConcurrency: 2,
      maxDiscoveryRounds: 1,
      discoverySlaMs: 100,
      stickySlaMs: 100,
      racingTotalTimeoutMs: 500,
      stickyTimeoutCooldownMs: 300_000,
      enableThinkingSignatureRectifier: true,
    });
    mocks.pickDiscoveryProviders.mockResolvedValueOnce([alternative]);

    let initialEndpointAttempts = 0;
    let allowAlternativeResponse!: () => void;
    const rectifierRetrySetupAttempted = new Promise<void>((resolve) => {
      allowAlternativeResponse = resolve;
    });
    const endpointResolver = vi.spyOn(
      ProxyForwarder as unknown as {
        resolveStreamingHedgeEndpoint: (
          session: ProxySession,
          provider: Provider
        ) => Promise<{
          endpointId: number | null;
          baseUrl: string;
          endpointUrl: string;
        }>;
      },
      "resolveStreamingHedgeEndpoint"
    );
    endpointResolver.mockImplementation(async (_attemptSession, provider) => {
      if (provider.id === initial.id) {
        initialEndpointAttempts += 1;
        if (initialEndpointAttempts > 1) {
          allowAlternativeResponse();
          throw new Error("rectifier retry endpoint setup failed");
        }
      }
      return {
        endpointId: null,
        baseUrl: provider.url,
        endpointUrl: provider.url,
      };
    });

    const signatureError = new UpstreamProxyError("Invalid `signature` in `thinking` block", 400, {
      body: '{"error":"invalid_signature"}',
      providerId: initial.id,
      providerName: initial.name,
    });
    const doForward = vi.spyOn(
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      },
      "doForward"
    );
    doForward.mockImplementation(async (attemptSession) => {
      const provider = (attemptSession as ProxySession).provider;
      if (provider?.id === initial.id) throw signatureError;
      await rectifierRetrySetupAttempted;
      return new Response(
        'data: {"type":"content_block_delta","delta":{"text":"alternative"}}\n\n',
        { headers: { "content-type": "text/event-stream" } }
      );
    });

    try {
      const response = await ProxyForwarder.send(session);
      expect(await response.text()).toContain('"alternative"');
      expect(initialEndpointAttempts).toBe(2);
      expect(session.provider?.id).toBe(alternative.id);
    } finally {
      endpointResolver.mockRestore();
    }
  });

  test("a rectifier retry setup reservation cannot overfill the next Discovery round", async () => {
    vi.useFakeTimers();
    try {
      const retrying = createProvider({
        id: 1,
        name: "retrying",
        priority: 10,
        limitConcurrentSessions: 1,
      });
      const fallback = createProvider({ id: 2, name: "fallback", priority: 1 });
      const nextRound = createProvider({
        id: 3,
        name: "next-round",
        priority: 1,
      });
      const unexpected = createProvider({
        id: 4,
        name: "unexpected",
        priority: 1,
      });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 31 },
        apiKey: null,
      } as typeof session.authState;
      setProviderWithSessionRef(session, retrying);
      withThinkingBlocks(session);
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 2,
        discoverySlaMs: 10,
        stickySlaMs: 10,
        racingTotalTimeoutMs: 100,
        stickyTimeoutCooldownMs: 300_000,
        enableThinkingSignatureRectifier: true,
      });
      mocks.pickDiscoveryProviders
        .mockResolvedValueOnce([fallback])
        .mockResolvedValueOnce([nextRound])
        .mockResolvedValueOnce([unexpected]);

      const retrySetup = Promise.withResolvers<{
        endpointId: number | null;
        baseUrl: string;
        endpointUrl: string;
      }>();
      const retrySetupStarted = Promise.withResolvers<void>();
      let retryingEndpointCalls = 0;
      const endpointResolver = vi.spyOn(
        ProxyForwarder as unknown as {
          resolveStreamingHedgeEndpoint: (
            session: ProxySession,
            provider: Provider
          ) => Promise<{
            endpointId: number | null;
            baseUrl: string;
            endpointUrl: string;
          }>;
        },
        "resolveStreamingHedgeEndpoint"
      );
      endpointResolver.mockImplementation(async (_attemptSession, provider) => {
        if (provider.id === retrying.id) {
          retryingEndpointCalls += 1;
          if (retryingEndpointCalls > 1) {
            retrySetupStarted.resolve();
            return retrySetup.promise;
          }
        }
        return {
          endpointId: null,
          baseUrl: provider.url,
          endpointUrl: provider.url,
        };
      });

      const signatureError = new UpstreamProxyError(
        "Invalid `signature` in `thinking` block",
        400,
        {
          body: '{"error":"invalid_signature"}',
          providerId: retrying.id,
          providerName: retrying.name,
        }
      );
      const nextRoundResponse = Promise.withResolvers<Response>();
      const activeProviders = new Set<number>();
      let maxActive = 0;
      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );
      doForward.mockImplementation(async (attemptSession, ...args) => {
        const providerId = (attemptSession as ProxySession).provider!.id;
        const signal = args.at(-1) as AbortSignal;
        activeProviders.add(providerId);
        maxActive = Math.max(maxActive, activeProviders.size);
        signal.addEventListener("abort", () => activeProviders.delete(providerId), { once: true });
        if (providerId === retrying.id) {
          activeProviders.delete(providerId);
          throw signatureError;
        }
        if (providerId === nextRound.id) return nextRoundResponse.promise;
        return new Response(new ReadableStream<Uint8Array>(), {
          headers: { "content-type": "text/event-stream" },
        });
      });

      const responsePromise = ProxyForwarder.send(session);
      await retrySetupStarted.promise;
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(0);

      expect(mocks.pickDiscoveryProviders).toHaveBeenCalledTimes(2);
      expect(maxActive).toBeLessThanOrEqual(2);

      retrySetup.resolve({
        endpointId: null,
        baseUrl: retrying.url,
        endpointUrl: retrying.url,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.pickDiscoveryProviders).toHaveBeenCalledTimes(2);
      expect(doForward).toHaveBeenCalledTimes(3);

      nextRoundResponse.resolve(
        new Response('data: {"type":"content_block_delta","delta":{"text":"next"}}\n\n', {
          headers: { "content-type": "text/event-stream" },
        })
      );
      await vi.advanceTimersByTimeAsync(0);
      const response = await responsePromise;
      expect(await response.text()).toContain('"next"');
      expect(maxActive).toBeLessThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("the final Discovery boundary cancels a stalled rectifier retry without refilling", async () => {
    vi.useFakeTimers();
    try {
      const retrying = createProvider({
        id: 1,
        name: "retrying",
        priority: 10,
        limitConcurrentSessions: 1,
      });
      const fallback = createProvider({ id: 2, name: "fallback", priority: 1 });
      const unexpected = createProvider({
        id: 3,
        name: "unexpected",
        priority: 1,
      });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 32 },
        apiKey: null,
      } as typeof session.authState;
      setProviderWithSessionRef(session, retrying);
      withThinkingBlocks(session);
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 1,
        discoverySlaMs: 10,
        stickySlaMs: 10,
        racingTotalTimeoutMs: 100,
        stickyTimeoutCooldownMs: 300_000,
        enableThinkingSignatureRectifier: true,
      });
      mocks.pickDiscoveryProviders
        .mockResolvedValueOnce([fallback])
        .mockResolvedValueOnce([unexpected]);

      const retrySetup = Promise.withResolvers<{
        endpointId: number | null;
        baseUrl: string;
        endpointUrl: string;
      }>();
      const retrySetupStarted = Promise.withResolvers<void>();
      let retryingEndpointCalls = 0;
      const endpointResolver = vi.spyOn(
        ProxyForwarder as unknown as {
          resolveStreamingHedgeEndpoint: (
            session: ProxySession,
            provider: Provider
          ) => Promise<{
            endpointId: number | null;
            baseUrl: string;
            endpointUrl: string;
          }>;
        },
        "resolveStreamingHedgeEndpoint"
      );
      endpointResolver.mockImplementation(async (_attemptSession, provider) => {
        if (provider.id === retrying.id) {
          retryingEndpointCalls += 1;
          if (retryingEndpointCalls > 1) {
            retrySetupStarted.resolve();
            return retrySetup.promise;
          }
        }
        return {
          endpointId: null,
          baseUrl: provider.url,
          endpointUrl: provider.url,
        };
      });

      const signatureError = new UpstreamProxyError(
        "Invalid `signature` in `thinking` block",
        400,
        {
          body: '{"error":"invalid_signature"}',
          providerId: retrying.id,
          providerName: retrying.name,
        }
      );
      let fallbackController: ReadableStreamDefaultController<Uint8Array> | null = null;
      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );
      doForward.mockImplementation(async (attemptSession) => {
        const providerId = (attemptSession as ProxySession).provider!.id;
        if (providerId === retrying.id) throw signatureError;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              fallbackController = controller;
            },
          }),
          { headers: { "content-type": "text/event-stream" } }
        );
      });

      const responsePromise = ProxyForwarder.send(session);
      await retrySetupStarted.promise;
      await vi.advanceTimersByTimeAsync(10);
      retrySetup.resolve({
        endpointId: null,
        baseUrl: retrying.url,
        endpointUrl: retrying.url,
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(mocks.pickDiscoveryProviders).toHaveBeenCalledTimes(1);
      expect(doForward).toHaveBeenCalledTimes(2);

      fallbackController!.enqueue(
        new TextEncoder().encode(
          'data: {"type":"content_block_delta","delta":{"text":"fallback"}}\n\n'
        )
      );
      fallbackController!.close();
      await vi.advanceTimersByTimeAsync(0);
      const response = await responsePromise;
      expect(peekDeferredStreamingFinalization(session)).toEqual(
        expect.objectContaining({
          bindingIntent: "none",
          requiresCompletionMarkerForBinding: false,
        })
      );
      expect(await response.text()).toContain('"fallback"');
      expect(mocks.pickDiscoveryProviders).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("the Discovery deadline releases a stalled rectifier retry reservation exactly once", async () => {
    vi.useFakeTimers();
    try {
      const provider = createProvider({
        id: 1,
        name: "retrying",
        limitConcurrentSessions: 1,
      });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 33 },
        apiKey: null,
      } as typeof session.authState;
      setProviderWithSessionRef(session, provider);
      withThinkingBlocks(session);
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 1,
        discoverySlaMs: 100,
        stickySlaMs: 100,
        racingTotalTimeoutMs: 50,
        stickyTimeoutCooldownMs: 300_000,
        enableThinkingSignatureRectifier: true,
      });
      mocks.pickDiscoveryProviders.mockResolvedValueOnce([]);

      const retrySetup = Promise.withResolvers<{
        endpointId: number | null;
        baseUrl: string;
        endpointUrl: string;
      }>();
      const retrySetupStarted = Promise.withResolvers<void>();
      let endpointCalls = 0;
      const endpointResolver = vi.spyOn(
        ProxyForwarder as unknown as {
          resolveStreamingHedgeEndpoint: (
            session: ProxySession,
            provider: Provider
          ) => Promise<{
            endpointId: number | null;
            baseUrl: string;
            endpointUrl: string;
          }>;
        },
        "resolveStreamingHedgeEndpoint"
      );
      endpointResolver.mockImplementation(async () => {
        endpointCalls += 1;
        if (endpointCalls > 1) {
          retrySetupStarted.resolve();
          return retrySetup.promise;
        }
        return {
          endpointId: null,
          baseUrl: provider.url,
          endpointUrl: provider.url,
        };
      });

      const signatureError = new UpstreamProxyError(
        "Invalid `signature` in `thinking` block",
        400,
        {
          body: '{"error":"invalid_signature"}',
          providerId: provider.id,
          providerName: provider.name,
        }
      );
      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );
      doForward.mockRejectedValueOnce(signatureError);

      const observedError = ProxyForwarder.send(session).catch((error) => error);
      await retrySetupStarted.promise;
      await vi.advanceTimersByTimeAsync(50);

      expect(await observedError).toBeInstanceOf(UpstreamProxyError);
      expect(mocks.releaseProviderSession).toHaveBeenCalledTimes(1);
      expect(session.hasProviderSessionRef(provider.id)).toBe(false);

      retrySetup.resolve({
        endpointId: null,
        baseUrl: provider.url,
        endpointUrl: provider.url,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(doForward).toHaveBeenCalledTimes(1);
      expect(mocks.releaseProviderSession).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("client abort cancels a stalled rectifier retry setup and releases its ref", async () => {
    vi.useFakeTimers();
    try {
      const clientAbort = new AbortController();
      const provider = createProvider({
        id: 1,
        name: "retrying",
        limitConcurrentSessions: 1,
      });
      const session = createSession(clientAbort.signal);
      session.authState = {
        success: true,
        user: null,
        key: { id: 35 },
        apiKey: null,
      } as typeof session.authState;
      setProviderWithSessionRef(session, provider);
      withThinkingBlocks(session);
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 1,
        discoverySlaMs: 100,
        stickySlaMs: 100,
        racingTotalTimeoutMs: 500,
        stickyTimeoutCooldownMs: 300_000,
        enableThinkingSignatureRectifier: true,
      });
      mocks.pickDiscoveryProviders.mockResolvedValueOnce([]);

      const retrySetup = Promise.withResolvers<{
        endpointId: number | null;
        baseUrl: string;
        endpointUrl: string;
      }>();
      const retrySetupStarted = Promise.withResolvers<void>();
      let endpointCalls = 0;
      const endpointResolver = vi.spyOn(
        ProxyForwarder as unknown as {
          resolveStreamingHedgeEndpoint: (
            session: ProxySession,
            provider: Provider
          ) => Promise<{
            endpointId: number | null;
            baseUrl: string;
            endpointUrl: string;
          }>;
        },
        "resolveStreamingHedgeEndpoint"
      );
      endpointResolver.mockImplementation(async () => {
        endpointCalls += 1;
        if (endpointCalls > 1) {
          retrySetupStarted.resolve();
          return retrySetup.promise;
        }
        return {
          endpointId: null,
          baseUrl: provider.url,
          endpointUrl: provider.url,
        };
      });

      const signatureError = new UpstreamProxyError(
        "Invalid `signature` in `thinking` block",
        400,
        {
          body: '{"error":"invalid_signature"}',
          providerId: provider.id,
          providerName: provider.name,
        }
      );
      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );
      doForward.mockRejectedValueOnce(signatureError);

      const observedError = ProxyForwarder.send(session).catch((error) => error);
      await retrySetupStarted.promise;
      clientAbort.abort();
      await vi.advanceTimersByTimeAsync(0);

      expect(await observedError).toBeInstanceOf(UpstreamProxyError);
      expect(mocks.releaseProviderSession).toHaveBeenCalledTimes(1);
      expect(session.hasProviderSessionRef(provider.id)).toBe(false);

      retrySetup.resolve({
        endpointId: null,
        baseUrl: provider.url,
        endpointUrl: provider.url,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(doForward).toHaveBeenCalledTimes(1);
      expect(mocks.releaseProviderSession).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test.each([
    {
      label: "client abort",
      category: ProxyErrorCategory.CLIENT_ABORT,
      setupError: new Error("retry setup observed client abort"),
      expectedStatus: 499,
    },
    {
      label: "local overload",
      category: ProxyErrorCategory.LOCAL_OVERLOAD,
      setupError: new DbPoolAdmissionError("data", 32),
      expectedStatus: null,
    },
  ])("rectifier retry setup preserves $label fail-fast semantics", async (scenario) => {
    const retrying = createProvider({
      id: 1,
      name: "retrying",
      limitConcurrentSessions: 1,
    });
    const peer = createProvider({ id: 2, name: "peer" });
    const unexpected = createProvider({ id: 3, name: "unexpected" });
    const session = createSession();
    session.authState = {
      success: true,
      user: null,
      key: { id: 34 },
      apiKey: null,
    } as typeof session.authState;
    setProviderWithSessionRef(session, retrying);
    withThinkingBlocks(session);
    mocks.getCachedSystemSettings.mockResolvedValue({
      discoveryEnabled: true,
      discoveryConcurrency: 2,
      maxDiscoveryRounds: 2,
      discoverySlaMs: 100,
      stickySlaMs: 100,
      racingTotalTimeoutMs: 500,
      stickyTimeoutCooldownMs: 300_000,
      enableThinkingSignatureRectifier: true,
    });
    mocks.pickDiscoveryProviders.mockResolvedValueOnce([peer]).mockResolvedValueOnce([unexpected]);
    mocks.categorizeErrorAsync
      .mockResolvedValueOnce(ProxyErrorCategory.PROVIDER_ERROR)
      .mockResolvedValueOnce(scenario.category);

    let retryingEndpointCalls = 0;
    const endpointResolver = vi.spyOn(
      ProxyForwarder as unknown as {
        resolveStreamingHedgeEndpoint: (
          session: ProxySession,
          provider: Provider
        ) => Promise<{
          endpointId: number | null;
          baseUrl: string;
          endpointUrl: string;
        }>;
      },
      "resolveStreamingHedgeEndpoint"
    );
    endpointResolver.mockImplementation(async (_attemptSession, provider) => {
      if (provider.id === retrying.id) {
        retryingEndpointCalls += 1;
        if (retryingEndpointCalls > 1) throw scenario.setupError;
      }
      return {
        endpointId: null,
        baseUrl: provider.url,
        endpointUrl: provider.url,
      };
    });

    const signatureError = new UpstreamProxyError("Invalid `signature` in `thinking` block", 400, {
      body: '{"error":"invalid_signature"}',
      providerId: retrying.id,
      providerName: retrying.name,
    });
    const doForward = vi.spyOn(
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      },
      "doForward"
    );
    doForward.mockImplementation(async (attemptSession) => {
      if ((attemptSession as ProxySession).provider?.id === retrying.id) throw signatureError;
      return new Response(new ReadableStream<Uint8Array>(), {
        headers: { "content-type": "text/event-stream" },
      });
    });

    const observed = await ProxyForwarder.send(session).catch((error) => error);
    if (scenario.expectedStatus == null) {
      expect(observed).toBe(scenario.setupError);
    } else {
      expect(observed).toBeInstanceOf(UpstreamProxyError);
      expect((observed as UpstreamProxyError).statusCode).toBe(scenario.expectedStatus);
    }
    expect(mocks.pickDiscoveryProviders).toHaveBeenCalledTimes(1);
    expect(doForward).toHaveBeenCalledTimes(2);
    expect(mocks.recordFailure).not.toHaveBeenCalled();
    expect(
      mocks.releaseProviderSession.mock.calls.filter(([providerId]) => providerId === retrying.id)
    ).toHaveLength(1);
  });

  test("Discovery releases a transferred Provider session ref exactly once when rectifier retry setup fails", async () => {
    const provider = createProvider({
      id: 1,
      name: "initial",
      limitConcurrentSessions: 1,
    });
    const session = createSession();
    session.authState = {
      success: true,
      user: null,
      key: { id: 23 },
      apiKey: null,
    } as typeof session.authState;
    setProviderWithSessionRef(session, provider);
    withThinkingBlocks(session);
    mocks.getCachedSystemSettings.mockResolvedValue({
      discoveryEnabled: true,
      discoveryConcurrency: 2,
      maxDiscoveryRounds: 1,
      discoverySlaMs: 100,
      stickySlaMs: 100,
      racingTotalTimeoutMs: 500,
      stickyTimeoutCooldownMs: 300_000,
      enableThinkingSignatureRectifier: true,
    });
    mocks.pickDiscoveryProviders.mockResolvedValueOnce([]);

    const endpointResolver = vi.spyOn(
      ProxyForwarder as unknown as {
        resolveStreamingHedgeEndpoint: (
          session: ProxySession,
          provider: Provider
        ) => Promise<{
          endpointId: number | null;
          baseUrl: string;
          endpointUrl: string;
        }>;
      },
      "resolveStreamingHedgeEndpoint"
    );
    endpointResolver
      .mockResolvedValueOnce({
        endpointId: null,
        baseUrl: provider.url,
        endpointUrl: provider.url,
      })
      .mockRejectedValueOnce(new Error("rectifier retry endpoint setup failed"));

    const signatureError = new UpstreamProxyError("Invalid `signature` in `thinking` block", 400, {
      body: '{"error":"invalid_signature"}',
      providerId: provider.id,
      providerName: provider.name,
    });
    vi.spyOn(
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      },
      "doForward"
    ).mockRejectedValueOnce(signatureError);

    try {
      await expect(ProxyForwarder.send(session)).rejects.toBeInstanceOf(Error);
      const providerAdmissionCalls = mocks.checkAndTrackProviderSession.mock.calls.filter(
        ([providerId]) => providerId === provider.id
      );
      const providerReleaseCalls = mocks.releaseProviderSession.mock.calls.filter(
        ([providerId]) => providerId === provider.id
      );
      expect(providerAdmissionCalls).toHaveLength(0);
      expect(providerReleaseCalls).toHaveLength(1);
      expect(session.hasProviderSessionRef(provider.id)).toBe(false);
    } finally {
      endpointResolver.mockRestore();
    }
  });

  test("a candidate delayed in launch setup is rolled back after another attempt wins", async () => {
    vi.useFakeTimers();
    try {
      const initial = createProvider({ id: 1, name: "initial" });
      const delayed = createProvider({
        id: 2,
        name: "delayed",
        limitConcurrentSessions: 1,
      });
      const session = createSession();
      session.authState = {
        success: true,
        user: null,
        key: { id: 10 },
        apiKey: null,
      } as typeof session.authState;
      setProviderWithSessionRef(session, initial);
      mocks.getCachedSystemSettings.mockResolvedValue({
        discoveryEnabled: true,
        discoveryConcurrency: 2,
        maxDiscoveryRounds: 1,
        discoverySlaMs: 50,
        stickySlaMs: 50,
        racingTotalTimeoutMs: 200,
      });
      mocks.pickDiscoveryProviders.mockResolvedValueOnce([delayed]);

      let resolveAdmission!: (value: unknown) => void;
      mocks.checkAndTrackProviderSession.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveAdmission = resolve;
        })
      );

      const doForward = vi.spyOn(
        ProxyForwarder as unknown as {
          doForward: (...args: unknown[]) => Promise<Response>;
        },
        "doForward"
      );
      doForward.mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              setTimeout(() => {
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"type":"content_block_delta","delta":{"text":"winner"}}\n\n'
                  )
                );
                controller.close();
              }, 5);
            },
          }),
          { headers: { "content-type": "text/event-stream" } }
        )
      );

      const responsePromise = ProxyForwarder.send(session);
      await vi.advanceTimersByTimeAsync(10);
      resolveAdmission({
        allowed: true,
        count: 1,
        tracked: true,
        referenced: true,
      });
      await vi.advanceTimersByTimeAsync(1);
      const response = await responsePromise;
      expect(await response.text()).toContain('"winner"');
      expect(doForward).toHaveBeenCalledTimes(1);
      expect(mocks.releaseProviderSession).toHaveBeenCalledWith(delayed.id, session.sessionId);
    } finally {
      vi.useRealTimers();
    }
  });

  test("Discovery client abort preserves the captured binding and releases its lease", async () => {
    const clientAbort = new AbortController();
    const provider = createProvider({ id: 1 });
    const session = createSession(clientAbort.signal);
    session.authState = {
      success: true,
      user: null,
      key: { id: 11 },
      apiKey: null,
    } as typeof session.authState;
    setProviderWithSessionRef(session, provider);
    mocks.getCachedSystemSettings.mockResolvedValue({
      discoveryEnabled: true,
      discoveryConcurrency: 2,
      maxDiscoveryRounds: 1,
      discoverySlaMs: 100,
      stickySlaMs: 100,
      racingTotalTimeoutMs: 500,
    });
    mocks.pickDiscoveryProviders.mockResolvedValueOnce([]);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      },
      "doForward"
    );
    doForward.mockImplementationOnce(
      async (_attemptSession, _provider, _baseUrl, _audit, _count, _stream, signal) =>
        await new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        })
    );

    const responsePromise = ProxyForwarder.send(session);
    clientAbort.abort(new Error("client disconnected"));
    await expect(responsePromise).rejects.toMatchObject({ statusCode: 499 });
    expect(mocks.clearVersionedSessionProvider).not.toHaveBeenCalled();
    expect(mocks.clearSessionProviders).not.toHaveBeenCalled();
    expect(mocks.releaseSessionDiscoveryLease).toHaveBeenCalledWith(
      session.sessionId,
      11,
      "lease-test"
    );
  });

  test("Discovery preserves binding state for a non-retryable client error", async () => {
    const provider = createProvider({ id: 1 });
    const session = createSession();
    session.authState = {
      success: true,
      user: null,
      key: { id: 12 },
      apiKey: null,
    } as typeof session.authState;
    setProviderWithSessionRef(session, provider);
    mocks.getCachedSystemSettings.mockResolvedValue({
      discoveryEnabled: true,
      discoveryConcurrency: 2,
      maxDiscoveryRounds: 1,
      discoverySlaMs: 100,
      stickySlaMs: 100,
      racingTotalTimeoutMs: 500,
    });
    mocks.pickDiscoveryProviders.mockResolvedValueOnce([]);
    mocks.categorizeErrorAsync.mockResolvedValueOnce(ProxyErrorCategory.NON_RETRYABLE_CLIENT_ERROR);
    const clientError = new UpstreamProxyError("invalid request", 400);
    vi.spyOn(
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      },
      "doForward"
    ).mockRejectedValueOnce(clientError);

    await expect(ProxyForwarder.send(session)).rejects.toBe(clientError);
    expect(mocks.clearVersionedSessionProvider).not.toHaveBeenCalled();
    expect(mocks.clearSessionProviders).not.toHaveBeenCalled();
    expect(mocks.releaseSessionDiscoveryLease).toHaveBeenCalled();
  });

  test("removes streaming hedge client abort listener after winner response is returned", async () => {
    const clientAbortController = new AbortController();
    const addSpy = vi.spyOn(clientAbortController.signal, "addEventListener");
    const removeSpy = vi.spyOn(clientAbortController.signal, "removeEventListener");
    const provider = createProvider({
      id: 1,
      name: "p1",
      firstByteTimeoutStreamingMs: 100,
    });
    const session = createSession(clientAbortController.signal);
    setProviderWithSessionRef(session, provider);
    session.forwardedRequestBody = "x".repeat(512 * 1024);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      },
      "doForward"
    );
    const upstreamController = new AbortController();
    doForward.mockImplementationOnce(async (attemptSession) => {
      const runtime = attemptSession as ProxySession & AttemptRuntime;
      runtime.responseController = upstreamController;
      runtime.clearResponseTimeout = vi.fn();
      return createStreamingResponse({
        label: "p1",
        firstChunkDelayMs: 0,
        controller: upstreamController,
      });
    });

    const response = await ProxyForwarder.send(session);
    expect(await response.text()).toContain('"provider":"p1"');

    const abortAddCalls = addSpy.mock.calls.filter(([type]) => type === "abort");
    expect(abortAddCalls).toHaveLength(1);
    expect(removeSpy).toHaveBeenCalledWith("abort", abortAddCalls[0][1]);
  });

  test("pre-aborted client signal should settle hedge without launching upstream attempt", async () => {
    const clientAbortController = new AbortController();
    clientAbortController.abort(new Error("client_cancelled"));
    const addSpy = vi.spyOn(clientAbortController.signal, "addEventListener");
    const provider = createProvider({
      id: 1,
      name: "p1",
      firstByteTimeoutStreamingMs: 100,
    });
    const session = createSession(clientAbortController.signal);
    setProviderWithSessionRef(session, provider);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      },
      "doForward"
    );

    await expect(ProxyForwarder.send(session)).rejects.toMatchObject({
      statusCode: 499,
    });
    expect(doForward).not.toHaveBeenCalled();
    expect(addSpy.mock.calls.filter(([type]) => type === "abort")).toHaveLength(0);
  });
});
