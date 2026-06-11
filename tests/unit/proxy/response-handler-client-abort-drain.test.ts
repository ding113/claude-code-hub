import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import { ProxyResponseHandler } from "@/app/v1/_lib/proxy/response-handler";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import { setDeferredStreamingFinalization } from "@/app/v1/_lib/proxy/stream-finalization";
import { AsyncTaskManager } from "@/lib/async-task-manager";
import { updateMessageRequestDetails, updateMessageRequestDuration } from "@/repository/message";
import type { Provider } from "@/types/provider";

const asyncTasks: Promise<void>[] = [];

vi.mock("@/app/v1/_lib/proxy/response-fixer", () => ({
  ResponseFixer: {
    process: async (_session: unknown, response: Response) => response,
  },
}));

vi.mock("@/lib/async-task-manager", () => ({
  AsyncTaskManager: {
    register: vi.fn((_taskId: string, promise: Promise<void>) => {
      asyncTasks.push(promise);
      return new AbortController();
    }),
    cleanup: vi.fn(),
    cancel: vi.fn(),
  },
}));

vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: vi.fn(async () => ({ billNonSuccessfulRequests: false })),
}));

vi.mock("@/lib/langfuse/emit-proxy-trace", () => ({
  emitProxyLangfuseTrace: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  },
}));

vi.mock("@/lib/price-sync/cloud-price-updater", () => ({
  requestCloudPriceTableSync: vi.fn(),
}));

vi.mock("@/lib/proxy-status-tracker", () => ({
  ProxyStatusTracker: {
    getInstance: () => ({
      endRequest: vi.fn(),
    }),
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  RateLimitService: {
    trackCost: vi.fn(),
    trackUserDailyCost: vi.fn(),
    decrementLeaseBudget: vi.fn(),
  },
}));

vi.mock("@/lib/redis/live-chain-store", () => ({
  deleteLiveChain: vi.fn(),
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    clearSessionProvider: vi.fn(),
    extractCodexPromptCacheKey: vi.fn(),
    storeSessionResponse: vi.fn(),
    storeSessionRequestPhaseSnapshot: vi.fn(),
    storeSessionResponsePhaseSnapshot: vi.fn(),
    storeSessionRequestHeaders: vi.fn(),
    storeSessionResponseHeaders: vi.fn(),
    storeSessionSpecialSettings: vi.fn(),
    storeSessionUpstreamRequestMeta: vi.fn(),
    storeSessionUpstreamResponseMeta: vi.fn(),
    updateSessionProvider: vi.fn(),
    updateSessionUsage: vi.fn(),
    updateSessionWithCodexCacheKey: vi.fn(),
  },
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    refreshSession: vi.fn(),
  },
}));

vi.mock("@/lib/circuit-breaker", () => ({
  recordFailure: vi.fn(),
  recordSuccess: vi.fn(),
}));

vi.mock("@/lib/endpoint-circuit-breaker", () => ({
  recordEndpointFailure: vi.fn(),
  recordEndpointSuccess: vi.fn(),
  resetEndpointCircuit: vi.fn(),
}));

vi.mock("@/repository/message", () => ({
  updateMessageRequestCostWithBreakdown: vi.fn(),
  updateMessageRequestDetails: vi.fn(),
  updateMessageRequestDuration: vi.fn(),
}));

function createProvider(): Provider {
  return {
    id: 1,
    name: "avemujica-responses",
    url: "https://api.test.invalid/v1",
    key: "sk-test",
    providerVendorId: null,
    providerType: "codex",
    isEnabled: true,
    weight: 1,
    priority: 1,
    groupPriorities: null,
    costMultiplier: 1,
    groupTag: "OpenAI",
    modelRedirects: null,
    allowedModels: null,
    mcpPassthroughType: "none",
    mcpPassthroughUrl: null,
    preserveClientIp: false,
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
    firstByteTimeoutStreamingMs: 0,
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
    anthropicMaxTokensPreference: null,
    anthropicThinkingBudgetPreference: null,
    geminiGoogleSearchPreference: null,
    tpm: 0,
    rpm: 0,
    rpd: 0,
    cc: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as Provider;
}

function createSession(signal: AbortSignal): ProxySession {
  const provider = createProvider();
  const user = { id: 1, name: "admin" };
  const key = { id: 2, name: "Omni" };
  const session = Object.create(ProxySession.prototype) as ProxySession;

  Object.assign(session, {
    authState: { success: true, user, key, apiKey: "sk-test" },
    cacheTtlResolved: null,
    clientAbortSignal: signal,
    context: {},
    context1mApplied: false,
    forwardedRequestBody: "",
    headerLog: "",
    headers: new Headers(),
    method: "POST",
    messageContext: {
      id: 123,
      createdAt: new Date(),
      user,
      key,
      apiKey: "sk-test",
    },
    originalFormat: "response",
    originalModelName: "gpt-5.4-mini",
    originalUrlPathname: "/v1/responses",
    provider,
    providerChain: [],
    providerType: "codex",
    request: {
      log: "",
      message: { model: "gpt-5.4-mini", stream: true },
      model: "gpt-5.4-mini",
    },
    requestSequence: 1,
    requestUrl: new URL("http://localhost/v1/responses"),
    sessionId: null,
    specialSettings: [],
    startTime: Date.now(),
    ttfbMs: null,
    userAgent: "Go-http-client/1.1",
    userName: "admin",
    addProviderToChain(this: ProxySession & { providerChain: unknown[] }, prov: Provider, meta) {
      this.providerChain.push({ id: prov.id, name: prov.name, ...(meta ?? {}) });
    },
    clearResponseTimeout: vi.fn(),
    getContext1mApplied: () => false,
    getCurrentModel: () => "gpt-5.4-mini",
    getEndpoint: () => "/v1/responses",
    getEndpointPolicy: () => resolveEndpointPolicy("/v1/responses"),
    getGroupCostMultiplier: () => 1,
    getOriginalModel: () => "gpt-5.4-mini",
    getProviderChain: () => session.providerChain,
    getResolvedPricingByBillingSource: async () => null,
    getSpecialSettings: () => [],
    isHeaderModified: () => false,
    recordTtfb: vi.fn(),
    releaseAgent: vi.fn(),
    setContext1mApplied: vi.fn(),
    shouldPersistSessionDebugArtifacts: () => false,
    shouldTrackSessionObservability: () => false,
  });

  return session;
}

function createResponsesSse(): Response {
  const body = [
    `event: response.output_text.done\ndata: ${JSON.stringify({
      type: "response.output_text.done",
      text: "短标题",
    })}`,
    `event: response.completed\ndata: ${JSON.stringify({
      type: "response.completed",
      response: {
        id: "resp_test",
        model: "gpt-5.4-mini-2026-03-17",
        usage: {
          input_tokens: 463,
          output_tokens: 11,
        },
      },
    })}`,
    "",
  ].join("\n\n");

  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function createErroredResponsesSse(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `event: response.output_text.delta\ndata: ${JSON.stringify({
            type: "response.output_text.delta",
            delta: "短",
          })}\n\n`
        )
      );
      const error = new Error("Response transmission interrupted");
      error.name = "ResponseAborted";
      controller.error(error);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function createHangingResponsesSse(upstreamSignal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `event: response.output_text.delta\ndata: ${JSON.stringify({
            type: "response.output_text.delta",
            delta: "短",
          })}\n\n`
        )
      );
      upstreamSignal.addEventListener(
        "abort",
        () => {
          const error = new Error("client_abort_drain_timeout");
          error.name = "AbortError";
          controller.error(error);
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

function createCompletedThenErroredResponsesSse(): Response {
  const encoder = new TextEncoder();
  const chunks = [
    `event: response.output_text.done\ndata: ${JSON.stringify({
      type: "response.output_text.done",
      text: "短标题",
    })}\n\n`,
    `event: response.completed\ndata: ${JSON.stringify({
      type: "response.completed",
      response: {
        id: "resp_test",
        model: "gpt-5.4-mini-2026-03-17",
        usage: {
          input_tokens: 463,
          output_tokens: 11,
        },
      },
    })}\n\n`,
  ];
  let index = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
        return;
      }

      const error = new Error("Response transmission interrupted after final usage");
      error.name = "ResponseAborted";
      controller.error(error);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

async function drainAsyncTasks(): Promise<void> {
  while (asyncTasks.length > 0) {
    const tasks = asyncTasks.splice(0, asyncTasks.length);
    await Promise.allSettled(tasks);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("ProxyResponseHandler stream client abort finalization", () => {
  beforeEach(() => {
    asyncTasks.splice(0, asyncTasks.length);
    vi.clearAllMocks();
  });

  it("finalizes a complete upstream responses stream as success when the downstream client already closed", async () => {
    const controller = new AbortController();
    controller.abort();
    const session = createSession(controller.signal);
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });

    await ProxyResponseHandler.dispatch(session, createResponsesSse());
    await drainAsyncTasks();

    expect(AsyncTaskManager.cancel).not.toHaveBeenCalled();
    expect(updateMessageRequestDuration).toHaveBeenCalledWith(123, expect.any(Number));
    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 200,
        inputTokens: 463,
        outputTokens: 11,
      })
    );
  });

  it("reclassifies a client-aborted stream as success when final usage was already received", async () => {
    const controller = new AbortController();
    controller.abort();
    const session = createSession(controller.signal);
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });

    await ProxyResponseHandler.dispatch(session, createCompletedThenErroredResponsesSse());
    await drainAsyncTasks();

    expect(AsyncTaskManager.cancel).not.toHaveBeenCalled();
    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 200,
        inputTokens: 463,
        outputTokens: 11,
        providerChain: [
          expect.objectContaining({
            reason: "request_success",
            statusCode: 200,
          }),
        ],
      })
    );
  });

  it("keeps a genuinely aborted upstream responses stream as 499", async () => {
    const controller = new AbortController();
    controller.abort();
    const session = createSession(controller.signal);
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "avemujica-responses",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
    });

    await ProxyResponseHandler.dispatch(session, createErroredResponsesSse());
    await drainAsyncTasks();

    expect(AsyncTaskManager.cancel).not.toHaveBeenCalled();
    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 499,
        errorMessage: "CLIENT_ABORTED",
      })
    );
  });

  it("bounds client-abort drain when the upstream stream hangs", async () => {
    vi.useFakeTimers();
    try {
      const clientController = new AbortController();
      const upstreamController = new AbortController();
      const session = createSession(clientController.signal);
      Object.assign(session, { responseController: upstreamController });
      setDeferredStreamingFinalization(session, {
        providerId: 1,
        providerName: "avemujica-responses",
        providerPriority: 1,
        attemptNumber: 1,
        totalProvidersAttempted: 1,
        isFirstAttempt: true,
        isFailoverSuccess: false,
        endpointId: 42,
        endpointUrl: "https://api.test.invalid/v1",
        upstreamStatusCode: 200,
      });

      await ProxyResponseHandler.dispatch(
        session,
        createHangingResponsesSse(upstreamController.signal)
      );
      clientController.abort();

      await vi.advanceTimersByTimeAsync(60_000);
      const tasks = asyncTasks.splice(0, asyncTasks.length);
      await Promise.allSettled(tasks);

      expect(upstreamController.signal.aborted).toBe(true);
      expect(AsyncTaskManager.cancel).not.toHaveBeenCalled();
      expect(updateMessageRequestDetails).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          statusCode: 499,
          errorMessage: "CLIENT_ABORTED",
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
