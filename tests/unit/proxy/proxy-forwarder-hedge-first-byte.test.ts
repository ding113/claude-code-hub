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
    updateSessionBindingSmart: mocks.updateSessionBindingSmart,
    updateSessionProvider: mocks.updateSessionProvider,
    clearSessionProvider: mocks.clearSessionProvider,
    storeSessionSpecialSettings: mocks.storeSessionSpecialSettings,
    storeSessionRequestPhaseSnapshot: mocks.storeSessionRequestPhaseSnapshot,
    storeSessionResponsePhaseSnapshot: mocks.storeSessionResponsePhaseSnapshot,
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
import { logger } from "@/lib/logger";
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

    params.controller.signal.addEventListener("abort", rejectWithError, { once: true });
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
    mocks.checkAndTrackProviderSession.mockResolvedValue({
      allowed: true,
      count: 1,
      tracked: true,
      referenced: true,
    });
  });

  test("shadow session redirect should not overwrite initial provider redirect and winner should keep its own redirect", () => {
    const requestedModel = "claude-haiku-4-5-20251001";
    const fireworksRedirect = "accounts/fireworks/routers/kimi-k2p5-turbo";
    const minimaxRedirect = "MiniMax-M2.7-highspeed";

    const fireworks = createProvider({
      id: 383,
      name: "fireworks",
      modelRedirects: [{ matchType: "exact", source: requestedModel, target: fireworksRedirect }],
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
      modelRedirects: [{ matchType: "exact", source: requestedModel, target: fireworksRedirect }],
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
      modelRedirects: [{ matchType: "exact", source: requestedModel, target: fireworksRedirect }],
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
        modelRedirects: [{ matchType: "exact", source: requestedModel, target: fireworksRedirect }],
      });
      const minimax = createProvider({
        id: 206,
        name: "Minimax Max",
        firstByteTimeoutStreamingMs: 100,
        modelRedirects: [{ matchType: "exact", source: requestedModel, target: minimaxRedirect }],
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
        const runtime = attemptSession as ProxySession & AttemptRuntime;
        runtime.responseController = controller2;
        runtime.clearResponseTimeout = vi.fn();
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
        modelRedirects: [{ matchType: "exact", source: requestedModel, target: fireworksRedirect }],
      });
      const minimax = createProvider({
        id: 206,
        name: "Minimax Max",
        firstByteTimeoutStreamingMs: 100,
        modelRedirects: [{ matchType: "exact", source: requestedModel, target: minimaxRedirect }],
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
      const provider1 = createProvider({ id: 1, name: "p1", firstByteTimeoutStreamingMs: 100 });
      const provider2 = createProvider({ id: 2, name: "p2", firstByteTimeoutStreamingMs: 100 });
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

      await vi.advanceTimersByTimeAsync(50);
      const response = await responsePromise;
      expect(await response.text()).toContain('"provider":"p2"');
      expect(controller1.signal.aborted).toBe(true);
      expect(controller2.signal.aborted).toBe(false);
      expect(mocks.recordFailure).not.toHaveBeenCalled();
      expect(mocks.recordSuccess).not.toHaveBeenCalled();
      expect(session.provider?.id).toBe(2);
      expect(mocks.updateSessionBindingSmart).toHaveBeenCalledWith(
        "sess-hedge",
        2,
        0,
        false,
        true,
        null
      );
      expect(mocks.releaseProviderSession).toHaveBeenCalledWith(1, "sess-hedge");
    } finally {
      vi.useRealTimers();
    }
  });

  test("hedge skips provider when concurrent session acquire is rejected", async () => {
    vi.useFakeTimers();

    try {
      const provider1 = createProvider({ id: 1, name: "p1", firstByteTimeoutStreamingMs: 100 });
      const provider2 = createProvider({
        id: 2,
        name: "p2",
        firstByteTimeoutStreamingMs: 100,
        limitConcurrentSessions: 1,
      });
      const provider3 = createProvider({ id: 3, name: "p3", firstByteTimeoutStreamingMs: 100 });
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
        .mockResolvedValueOnce({ allowed: true, count: 1, tracked: true, referenced: true });

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
      const provider1 = createProvider({ id: 1, name: "p1", firstByteTimeoutStreamingMs: 100 });
      const provider2 = createProvider({ id: 2, name: "p2", firstByteTimeoutStreamingMs: 100 });
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
      const provider1 = createProvider({ id: 1, name: "p1", firstByteTimeoutStreamingMs: 100 });
      const provider2 = createProvider({ id: 2, name: "p2", firstByteTimeoutStreamingMs: 100 });
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
      expect(mocks.releaseProviderSession).toHaveBeenCalledWith(2, "sess-hedge");
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
          { matchType: "exact", source: requestedModel, target: "MiniMax-M2.7-highspeed" },
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
      expect(mocks.clearSessionProvider).toHaveBeenCalledWith("sess-hedge");
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
      name: "resource not found",
      category: ProxyErrorCategory.RESOURCE_NOT_FOUND,
      errorFactory: (provider: Provider) =>
        new UpstreamProxyError("Provider returned 404: model not found", 404, {
          body: '{"error":"model_not_found"}',
          providerId: provider.id,
          providerName: provider.name,
        }),
    },
    {
      name: "system error",
      category: ProxyErrorCategory.SYSTEM_ERROR,
      errorFactory: () => new Error("fetch failed"),
    },
  ])("when a real hedge race ends with only $name, terminal error should be generic fallback", async ({
    category,
    errorFactory,
  }) => {
    vi.useFakeTimers();

    try {
      const provider1 = createProvider({ id: 1, name: "p1", firstByteTimeoutStreamingMs: 100 });
      const provider2 = createProvider({ id: 2, name: "p2", firstByteTimeoutStreamingMs: 100 });
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
      expect(mocks.clearSessionProvider).toHaveBeenCalledWith("sess-hedge");
    } finally {
      vi.useRealTimers();
    }
  });

  test("non-retryable client errors should stop hedge immediately and preserve original error", async () => {
    const provider1 = createProvider({ id: 1, name: "p1", firstByteTimeoutStreamingMs: 100 });
    const provider2 = createProvider({ id: 2, name: "p2", firstByteTimeoutStreamingMs: 100 });
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
    expect(mocks.clearSessionProvider).toHaveBeenCalledWith("sess-hedge");
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

  test("hedge 备选供应商命中 thinking signature 错误时，应整流后在同供应商重试并保留审计", async () => {
    vi.useFakeTimers();

    try {
      const provider1 = createProvider({ id: 1, name: "p1", firstByteTimeoutStreamingMs: 100 });
      const provider2 = createProvider({ id: 2, name: "p2", firstByteTimeoutStreamingMs: 100 });
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

  test("hedge 路径命中 thinking budget 错误时，应整流后在同供应商重试", async () => {
    vi.useFakeTimers();

    try {
      const provider1 = createProvider({ id: 1, name: "p1", firstByteTimeoutStreamingMs: 100 });
      const provider2 = createProvider({ id: 2, name: "p2", firstByteTimeoutStreamingMs: 100 });
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

  test("removes streaming hedge client abort listener after winner response is returned", async () => {
    const clientAbortController = new AbortController();
    const addSpy = vi.spyOn(clientAbortController.signal, "addEventListener");
    const removeSpy = vi.spyOn(clientAbortController.signal, "removeEventListener");
    const provider = createProvider({ id: 1, name: "p1", firstByteTimeoutStreamingMs: 100 });
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
    const provider = createProvider({ id: 1, name: "p1", firstByteTimeoutStreamingMs: 100 });
    const session = createSession(clientAbortController.signal);
    setProviderWithSessionRef(session, provider);

    const doForward = vi.spyOn(
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      },
      "doForward"
    );

    await expect(ProxyForwarder.send(session)).rejects.toMatchObject({ statusCode: 499 });
    expect(doForward).not.toHaveBeenCalled();
    expect(addSpy.mock.calls.filter(([type]) => type === "abort")).toHaveLength(0);
  });
});
