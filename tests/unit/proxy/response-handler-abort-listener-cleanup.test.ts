import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import {
  __codexResponsesTerminalStateTrackerForTests,
  ProxyResponseHandler,
} from "@/app/v1/_lib/proxy/response-handler";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import { setDeferredStreamingFinalization } from "@/app/v1/_lib/proxy/stream-finalization";
import { recordFailure } from "@/lib/circuit-breaker";
import { recordEndpointSuccess } from "@/lib/endpoint-circuit-breaker";
import { SessionManager } from "@/lib/session-manager";
import { updateMessageRequestDetails } from "@/repository/message";
import type { Provider } from "@/types/provider";

const testState = vi.hoisted(() => ({
  asyncTasks: [] as Promise<void>[],
  cancelTask: vi.fn(),
  cleanupTask: vi.fn(),
}));

vi.mock("@/app/v1/_lib/proxy/response-fixer", () => ({
  ResponseFixer: {
    process: async (_session: unknown, response: Response) => response,
  },
}));

vi.mock("@/lib/async-task-manager", () => ({
  AsyncTaskManager: {
    register: (_taskId: string, promise: Promise<void>) => {
      testState.asyncTasks.push(promise);
      return new AbortController();
    },
    cleanup: testState.cleanupTask,
    cancel: testState.cancelTask,
  },
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
    storeSessionResponse: vi.fn(),
    updateSessionUsage: vi.fn(),
    storeSessionRequestPhaseSnapshot: vi.fn(),
    storeSessionResponsePhaseSnapshot: vi.fn(),
    storeSessionUpstreamRequestMeta: vi.fn(),
    storeSessionSpecialSettings: vi.fn(),
    storeSessionRequestHeaders: vi.fn(),
    storeSessionResponseHeaders: vi.fn(),
    storeSessionUpstreamResponseMeta: vi.fn(),
    extractCodexPromptCacheKey: vi.fn((responseData: Record<string, unknown>) => {
      const response = responseData.response as Record<string, unknown> | undefined;
      if (typeof response?.prompt_cache_key === "string" && response.prompt_cache_key.length > 0) {
        return response.prompt_cache_key;
      }
      return typeof responseData.prompt_cache_key === "string" &&
        responseData.prompt_cache_key.length > 0
        ? responseData.prompt_cache_key
        : null;
    }),
    updateSessionWithCodexCacheKey: vi.fn().mockResolvedValue({
      sessionId: "codex-cache-session",
      updated: true,
    }),
    updateSessionBindingSmart: vi.fn().mockResolvedValue({
      updated: false,
      reason: "test",
      details: {},
    }),
  },
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    refreshSession: vi.fn(),
  },
}));

vi.mock("@/lib/circuit-breaker", () => ({
  recordFailure: vi.fn(),
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

async function drainAsyncTasks(): Promise<void> {
  while (testState.asyncTasks.length > 0) {
    const tasks = testState.asyncTasks.splice(0);
    await Promise.allSettled(tasks);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 99,
    name: "test-provider",
    providerType: "openai",
    baseUrl: "https://api.test.invalid",
    priority: 1,
    weight: 1,
    costMultiplier: 1,
    groupTag: "default",
    isEnabled: true,
    models: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    streamingIdleTimeoutMs: 0,
    ...overrides,
  } as Provider;
}

function makeSession(
  clientAbortSignal: AbortSignal | null,
  stream: boolean,
  overrides: {
    provider?: Partial<Provider>;
    pathname?: string;
    originalFormat?: string;
    providerType?: string;
  } = {}
): ProxySession {
  const pathname = overrides.pathname ?? "/v1/chat/completions";
  const endpointPolicy = resolveEndpointPolicy(pathname);
  const provider = makeProvider(overrides.provider);
  const specialSettings: unknown[] = [];
  const session = {
    request: {
      model: "gpt-5.5",
      log: "",
      message: {
        model: "gpt-5.5",
        stream,
        messages: [{ role: "user", content: "hello" }],
      },
    },
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL(`http://localhost${pathname}`),
    headers: new Headers(),
    headerLog: "",
    userAgent: null,
    context: {},
    clientAbortSignal,
    forwardedRequestBody: "",
    userName: "test-user",
    authState: {
      success: true,
      user: { id: 1, name: "test-user" },
      key: { id: 2, name: "test-key" },
      apiKey: "test-key",
    },
    provider,
    messageContext: {
      id: 123,
      user: { id: 1, name: "test-user" },
      key: { id: 2, name: "test-key" },
      isSystemPrompt: false,
      requireAuth: true,
      createdAt: new Date(),
    },
    sessionId: null,
    requestSequence: 1,
    originalFormat: overrides.originalFormat ?? "openai",
    providerType: overrides.providerType ?? provider.providerType,
    originalModelName: "gpt-5.5",
    originalUrlPathname: pathname,
    providerChain: [],
    cacheTtlResolved: null,
    context1mApplied: false,
    specialSettings,
    cachedPriceData: undefined,
    cachedBillingModelSource: undefined,
    endpointPolicy,
    isHeaderModified: () => false,
    getEndpointPolicy: () => endpointPolicy,
    getEndpoint: () => pathname,
    getContext1mApplied: () => false,
    getGroupCostMultiplier: () => 1,
    getOriginalModel: () => "gpt-5.5",
    getCurrentModel: () => "gpt-5.5",
    getProviderChain: () => [],
    getSpecialSettings: () => specialSettings,
    addSpecialSetting: (setting: unknown) => {
      specialSettings.push(setting);
    },
    getCodexPriorityBillingSource: async () => "requested",
    shouldPersistSessionDebugArtifacts: () => false,
    shouldTrackSessionObservability: () => false,
    getResolvedPricingByBillingSource: async () => null,
    recordTtfb: vi.fn(),
    ttfbMs: null,
    addProviderToChain: vi.fn(),
    clearResponseTimeout: vi.fn(),
    releaseAgent: vi.fn(),
  };

  return session as unknown as ProxySession;
}

function setDeferredMeta(session: ProxySession, providerType?: Provider["providerType"]): void {
  const meta = {
    providerId: 99,
    providerName: "test-provider",
    providerPriority: 1,
    attemptNumber: 1,
    totalProvidersAttempted: 1,
    isFirstAttempt: true,
    isFailoverSuccess: false,
    endpointId: 42,
    endpointUrl: "https://api.test.invalid/v1/responses",
    upstreamStatusCode: 200,
  };
  setDeferredStreamingFinalization(session, providerType ? { ...meta, providerType } : meta);
}

function makeCodexResponsesSession(clientAbortSignal: AbortSignal | null = null): ProxySession {
  return makeSession(clientAbortSignal, true, {
    provider: { providerType: "codex" },
    pathname: "/v1/responses",
    originalFormat: "response",
    providerType: "codex",
  });
}

function createClosedStreamResponse(lines: string[]): Response {
  return new Response(lines.join("\n"), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function createHangingStream(firstChunk: string): {
  stream: ReadableStream<Uint8Array>;
  controller: AbortController;
  enqueue: (chunk: string) => void;
  error: (error: unknown) => void;
} {
  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const abortController = new AbortController();

  return {
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        controller.enqueue(encoder.encode(firstChunk));
        abortController.signal.addEventListener(
          "abort",
          () => {
            controller.error(Object.assign(new Error("aborted"), { name: "AbortError" }));
          },
          { once: true }
        );
      },
    }),
    controller: abortController,
    enqueue(chunk: string) {
      controllerRef?.enqueue(encoder.encode(chunk));
    },
    error(error: unknown) {
      controllerRef?.error(error);
    },
  };
}

async function readFirstClientChunk(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const { value } = await reader.read();
  reader.releaseLock();
  return value ? new TextDecoder().decode(value) : "";
}

describe("ProxyResponseHandler client abort listener cleanup", () => {
  beforeEach(() => {
    testState.asyncTasks = [];
    vi.clearAllMocks();
    testState.cancelTask.mockClear();
    testState.cleanupTask.mockClear();
    vi.restoreAllMocks();
    vi.mocked(SessionManager.updateSessionBindingSmart).mockResolvedValue({
      updated: false,
      reason: "test",
      details: {},
    });
  });

  it("removes non-stream client abort listener after response processing completes", async () => {
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, "addEventListener");
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");
    const session = makeSession(controller.signal, false);
    const upstreamResponse = new Response(
      JSON.stringify({
        choices: [{ message: { content: "ok" } }],
      }),
      {
        headers: { "content-type": "application/json" },
      }
    );

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await response.text();
    await drainAsyncTasks();

    const abortAddCalls = addSpy.mock.calls.filter(([type]) => type === "abort");
    expect(abortAddCalls).toHaveLength(1);
    expect(removeSpy).toHaveBeenCalledWith("abort", abortAddCalls[0][1]);
  });

  it("removes stream client abort listener after stream processing completes", async () => {
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, "addEventListener");
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");
    const session = makeSession(controller.signal, true);
    const upstreamResponse = new Response(
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
      {
        headers: { "content-type": "text/event-stream" },
      }
    );

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await response.text();
    await drainAsyncTasks();

    const abortAddCalls = addSpy.mock.calls.filter(([type]) => type === "abort");
    expect(abortAddCalls).toHaveLength(1);
    expect(removeSpy).toHaveBeenCalledWith("abort", abortAddCalls[0][1]);
  });

  it("uses no-op cleanup when client abort signal is null", async () => {
    const session = makeSession(null, false);
    const upstreamResponse = new Response(JSON.stringify({ choices: [] }), {
      headers: { "content-type": "application/json" },
    });

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await response.text();
    await drainAsyncTasks();

    expect(testState.cancelTask).not.toHaveBeenCalled();
  });

  it("invokes cancel synchronously when client signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const addSpy = vi.spyOn(controller.signal, "addEventListener");
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");
    const session = makeSession(controller.signal, false);
    const upstreamResponse = new Response(JSON.stringify({ choices: [] }), {
      headers: { "content-type": "application/json" },
    });

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await response.text();
    await drainAsyncTasks();

    expect(addSpy.mock.calls.filter(([type]) => type === "abort")).toHaveLength(0);
    expect(removeSpy.mock.calls.filter(([type]) => type === "abort")).toHaveLength(0);
    expect(testState.cancelTask).toHaveBeenCalled();
  });

  it("records normally closed Codex response.completed as successful", async () => {
    const session = makeCodexResponsesSession();
    setDeferredMeta(session);
    const upstreamResponse = createClosedStreamResponse([
      "event: response.completed",
      'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed"}}',
      "",
      "",
    ]);

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(response.text()).resolves.toContain("response.completed");
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 200,
      })
    );
    expect(recordFailure).not.toHaveBeenCalled();
    expect(recordEndpointSuccess).toHaveBeenCalledWith(42);
    expect(session.addProviderToChain).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: "request_success",
        statusCode: 200,
      })
    );
  });

  it("tracks Codex terminal usage with last-terminal-event semantics", () => {
    const tracker = __codexResponsesTerminalStateTrackerForTests.create();

    tracker.push(
      [
        "event: response.completed",
        'data: {"type":"response.completed","response":{"status":"completed","service_tier":"priority","usage":{"input_tokens":12,"output_tokens":4}}}',
        "",
        "",
      ].join("\n")
    );

    expect(tracker.getTerminalState()).toBe("completed");
    expect(tracker.getUsageMetrics()).toEqual({
      input_tokens: 12,
      output_tokens: 4,
    });
    expect(tracker.getServiceTier()).toBe("priority");

    tracker.push(
      [
        "event: response.failed",
        'data: {"type":"response.failed","response":{"status":"failed"}}',
        "",
        "",
      ].join("\n")
    );

    expect(tracker.getTerminalState()).toBe("failed");
    expect(tracker.getUsageMetrics()).toBeNull();
    expect(tracker.getServiceTier()).toBeNull();
  });

  it("records normally closed Codex response.failed as terminal failure", async () => {
    const session = makeCodexResponsesSession();
    (session as ProxySession & { sessionId: string }).sessionId = "codex-session";
    setDeferredMeta(session);
    const upstreamResponse = createClosedStreamResponse([
      "event: response.failed",
      'data: {"type":"response.failed","response":{"id":"resp_1","status":"failed"}}',
      "",
      "",
    ]);

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(response.text()).resolves.toContain("response.failed");
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 502,
        errorMessage: "CODEX_RESPONSE_FAILED",
      })
    );
    expect(SessionManager.clearSessionProvider).toHaveBeenCalledWith("codex-session");
    expect(recordFailure).toHaveBeenCalledWith(
      99,
      expect.objectContaining({ message: "CODEX_RESPONSE_FAILED" })
    );
    expect(recordEndpointSuccess).not.toHaveBeenCalled();
    expect(session.addProviderToChain).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: "retry_failed",
        statusCode: 502,
        errorMessage: "CODEX_RESPONSE_FAILED",
      })
    );
  });

  it("records normally closed Codex response.error as terminal failure", async () => {
    const session = makeCodexResponsesSession();
    setDeferredMeta(session);
    const upstreamResponse = createClosedStreamResponse([
      "event: response.error",
      'data: {"type":"response.error","error":{"message":"boom"}}',
      "",
      "",
    ]);

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(response.text()).resolves.toContain("response.error");
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 502,
        errorMessage: "CODEX_RESPONSE_ERROR",
      })
    );
    expect(recordFailure).toHaveBeenCalledWith(
      99,
      expect.objectContaining({ message: "CODEX_RESPONSE_ERROR" })
    );
    expect(recordEndpointSuccess).not.toHaveBeenCalled();
  });

  it("lets a normally closed plain-text error event override response.completed", async () => {
    const session = makeCodexResponsesSession();
    setDeferredMeta(session);
    const upstreamResponse = createClosedStreamResponse([
      "event: response.completed",
      'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed"}}',
      "",
      "event: error",
      "data: upstream connection closed",
      "",
      "",
    ]);

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(response.text()).resolves.toContain("response.completed");
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 502,
        errorMessage: "CODEX_RESPONSE_ERROR",
      })
    );
    expect(recordFailure).toHaveBeenCalledWith(
      99,
      expect.objectContaining({ message: "CODEX_RESPONSE_ERROR" })
    );
    expect(recordEndpointSuccess).not.toHaveBeenCalled();
  });

  it("records normally closed Codex response.incomplete as successful terminal result", async () => {
    const session = makeCodexResponsesSession();
    (session as ProxySession & { sessionId: string }).sessionId = "codex-session";
    setDeferredMeta(session);
    const upstreamResponse = createClosedStreamResponse([
      "event: response.incomplete",
      'data: {"type":"response.incomplete","response":{"id":"resp_1","status":"incomplete"}}',
      "",
      "",
    ]);

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(response.text()).resolves.toContain("response.incomplete");
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 200,
      })
    );
    expect(SessionManager.clearSessionProvider).not.toHaveBeenCalledWith("codex-session");
    expect(recordFailure).not.toHaveBeenCalled();
    expect(recordEndpointSuccess).toHaveBeenCalledWith(42);
    expect(session.addProviderToChain).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: "request_success",
        statusCode: 200,
      })
    );
  });

  it("keeps fake-200 detection after normally closed Codex response.completed", async () => {
    const session = makeCodexResponsesSession();
    setDeferredMeta(session);
    const upstreamResponse = createClosedStreamResponse([
      "event: response.completed",
      'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed"}}',
      "",
      'data: {"error":{"message":"invalid api key"}}',
      "",
      "",
    ]);

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(response.text()).resolves.toContain("response.completed");
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 401,
        errorMessage: expect.stringContaining("FAKE_200_JSON_ERROR_MESSAGE_NON_EMPTY"),
      })
    );
    expect(recordFailure).toHaveBeenCalledWith(
      99,
      expect.objectContaining({ message: "FAKE_200_JSON_ERROR_MESSAGE_NON_EMPTY" })
    );
    expect(recordEndpointSuccess).not.toHaveBeenCalled();
  });

  it("does not apply Codex terminal-state rules to normally closed non-Codex streams", async () => {
    const session = makeSession(null, true, {
      provider: { providerType: "openai-compatible" },
      pathname: "/v1/responses",
      originalFormat: "response",
      providerType: "openai",
    });
    setDeferredMeta(session);
    const upstreamResponse = createClosedStreamResponse([
      "event: response.failed",
      'data: {"type":"response.failed","response":{"id":"resp_1","status":"failed"}}',
      "",
      "",
    ]);

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(response.text()).resolves.toContain("response.failed");
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 200,
      })
    );
    expect(recordFailure).not.toHaveBeenCalled();
    expect(recordEndpointSuccess).toHaveBeenCalledWith(42);
  });

  it("records Codex Responses stream as successful when client aborts after response.completed", async () => {
    const controller = new AbortController();
    const session = makeSession(controller.signal, true, {
      provider: { providerType: "codex" },
      pathname: "/v1/responses",
      originalFormat: "response",
      providerType: "codex",
    });
    (
      session as ProxySession & {
        getCodexPriorityBillingSource: () => Promise<"actual">;
      }
    ).getCodexPriorityBillingSource = async () => "actual";
    setDeferredMeta(session);
    const upstream = createHangingStream(
      [
        "event: response.completed",
        'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","service_tier":"priority","usage":{"input_tokens":12,"output_tokens":4}}}',
        "",
        "",
      ].join("\n")
    );
    const upstreamResponse = new Response(upstream.stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(readFirstClientChunk(response)).resolves.toContain("response.completed");

    controller.abort(new Error("client_closed_after_completed"));
    upstream.enqueue(":\n\n");
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 200,
        inputTokens: 12,
        outputTokens: 4,
        specialSettings: expect.arrayContaining([
          expect.objectContaining({
            type: "codex_service_tier_result",
            actualServiceTier: "priority",
            resolvedFrom: "actual",
            effectivePriority: true,
          }),
        ]),
      })
    );
    expect(updateMessageRequestDetails).not.toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        errorMessage: "CLIENT_ABORTED",
      })
    );
    expect(session.addProviderToChain).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: "system_error",
        errorMessage: "CLIENT_ABORTED",
      })
    );
  });

  it("preserves Codex prompt_cache_key when client aborts after response.completed", async () => {
    const controller = new AbortController();
    const session = makeCodexResponsesSession(controller.signal);
    (session as ProxySession & { sessionId: string }).sessionId = "codex-session";
    setDeferredMeta(session);
    const upstream = createHangingStream(
      [
        "event: response.completed",
        'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","prompt_cache_key":"cache-key-1","usage":{"input_tokens":12,"output_tokens":4}}}',
        "",
        "",
      ].join("\n")
    );
    const upstreamResponse = new Response(upstream.stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(readFirstClientChunk(response)).resolves.toContain("response.completed");

    controller.abort(new Error("client_closed_after_completed"));
    upstream.enqueue(":\n\n");
    await drainAsyncTasks();

    expect(SessionManager.updateSessionWithCodexCacheKey).toHaveBeenCalledWith(
      "codex-session",
      "cache-key-1",
      99,
      2
    );
  });

  it("keeps terminal failure when Codex Responses stream aborts after response.failed", async () => {
    const controller = new AbortController();
    const session = makeSession(controller.signal, true, {
      provider: { providerType: "codex" },
      pathname: "/v1/responses",
      originalFormat: "response",
      providerType: "codex",
    });
    setDeferredMeta(session);
    const upstream = createHangingStream(
      [
        "event: response.failed",
        'data: {"type":"response.failed","response":{"id":"resp_1","status":"failed"}}',
        "",
        "",
      ].join("\n")
    );
    const upstreamResponse = new Response(upstream.stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(readFirstClientChunk(response)).resolves.toContain("response.failed");

    controller.abort(new Error("client_closed_after_failed"));
    upstream.enqueue(":\n\n");
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 502,
        errorMessage: "CODEX_RESPONSE_FAILED",
      })
    );
    expect(session.addProviderToChain).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: "retry_failed",
        statusCode: 502,
        errorMessage: "CODEX_RESPONSE_FAILED",
      })
    );
  });

  it("does not update Codex prompt_cache_key after terminal failure", async () => {
    const controller = new AbortController();
    const session = makeCodexResponsesSession(controller.signal);
    (session as ProxySession & { sessionId: string }).sessionId = "codex-session";
    setDeferredMeta(session);
    const upstream = createHangingStream(
      [
        "event: response.failed",
        'data: {"type":"response.failed","response":{"id":"resp_1","status":"failed","prompt_cache_key":"cache-key-1"}}',
        "",
        "",
      ].join("\n")
    );
    const upstreamResponse = new Response(upstream.stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(readFirstClientChunk(response)).resolves.toContain("response.failed");

    controller.abort(new Error("client_closed_after_failed"));
    upstream.enqueue(":\n\n");
    await drainAsyncTasks();

    expect(SessionManager.updateSessionWithCodexCacheKey).not.toHaveBeenCalled();
  });

  it("keeps 499 CLIENT_ABORTED when Codex Responses stream aborts before response.completed", async () => {
    const controller = new AbortController();
    const session = makeSession(controller.signal, true, {
      provider: { providerType: "codex" },
      pathname: "/v1/responses",
      originalFormat: "response",
      providerType: "codex",
    });
    setDeferredMeta(session);
    const upstream = createHangingStream(
      [
        "event: response.output_text.delta",
        'data: {"type":"response.output_text.delta","delta":"partial"}',
        "",
        "",
      ].join("\n")
    );
    const upstreamResponse = new Response(upstream.stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(readFirstClientChunk(response)).resolves.toContain("partial");

    controller.abort(new Error("client_closed_before_completed"));
    upstream.enqueue(":\n\n");
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 499,
        errorMessage: "CLIENT_ABORTED",
      })
    );
    expect(session.addProviderToChain).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: "system_error",
        statusCode: 499,
        errorMessage: "CLIENT_ABORTED",
      })
    );
  });

  it("records Codex terminal response.completed as successful on non-execution response paths", async () => {
    const controller = new AbortController();
    const session = makeSession(controller.signal, true, {
      provider: { providerType: "codex" },
      pathname: "/v1/responses/resp_123",
      originalFormat: "response",
      providerType: "codex",
    });
    setDeferredMeta(session);
    const upstream = createHangingStream(
      [
        "event: response.completed",
        'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed"}}',
        "",
        "",
      ].join("\n")
    );
    const upstreamResponse = new Response(upstream.stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(readFirstClientChunk(response)).resolves.toContain("response.completed");

    controller.abort(new Error("client_closed_after_completed_non_responses"));
    upstream.enqueue(":\n\n");
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 200,
      })
    );
    expect(updateMessageRequestDetails).not.toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        errorMessage: "CLIENT_ABORTED",
      })
    );
    expect(session.addProviderToChain).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: "system_error",
        errorMessage: "CLIENT_ABORTED",
      })
    );
  });

  it("records data-only Codex response.completed SSE as successful after client abort", async () => {
    const controller = new AbortController();
    const session = makeSession(controller.signal, true, {
      provider: { providerType: "codex" },
      pathname: "/v1/responses",
      originalFormat: "response",
      providerType: "codex",
    });
    setDeferredMeta(session);
    const upstream = createHangingStream(
      [
        'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed"}}',
        "",
        "",
      ].join("\n")
    );
    const upstreamResponse = new Response(upstream.stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(readFirstClientChunk(response)).resolves.toContain("response.completed");

    controller.abort(new Error("client_closed_after_completed_response_resource"));
    upstream.enqueue(":\n\n");
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 200,
      })
    );
    expect(updateMessageRequestDetails).not.toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        errorMessage: "CLIENT_ABORTED",
      })
    );
    expect(session.addProviderToChain).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: "system_error",
        errorMessage: "CLIENT_ABORTED",
      })
    );
  });

  it("uses deferred meta providerType when current session provider no longer looks like Codex", async () => {
    const controller = new AbortController();
    const session = makeSession(controller.signal, true, {
      provider: { providerType: "openai-compatible" },
      pathname: "/v1/responses",
      originalFormat: "response",
      providerType: "openai",
    });
    setDeferredMeta(session, "codex");
    const upstream = createHangingStream(
      [
        'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","usage":{"input_tokens":12,"output_tokens":4}}}',
        "",
        "",
      ].join("\n")
    );
    const upstreamResponse = new Response(upstream.stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(readFirstClientChunk(response)).resolves.toContain("response.completed");

    controller.abort(new Error("client_closed_after_completed_meta_codex"));
    upstream.enqueue(":\n\n");
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 200,
        inputTokens: 12,
        outputTokens: 4,
      })
    );
    expect(updateMessageRequestDetails).not.toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        errorMessage: "CLIENT_ABORTED",
      })
    );
    expect(session.addProviderToChain).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: "system_error",
        errorMessage: "CLIENT_ABORTED",
      })
    );
  });

  it("does not use current session providerType to mark non-Codex meta as completed", async () => {
    const controller = new AbortController();
    const session = makeSession(controller.signal, true, {
      provider: { providerType: "codex" },
      pathname: "/v1/responses",
      originalFormat: "response",
      providerType: "codex",
    });
    setDeferredMeta(session, "openai-compatible");
    const upstream = createHangingStream(
      [
        "event: response.completed",
        'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed"}}',
        "",
        "",
      ].join("\n")
    );
    const upstreamResponse = new Response(upstream.stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(readFirstClientChunk(response)).resolves.toContain("response.completed");

    controller.abort(new Error("client_closed_after_completed_meta_non_codex"));
    upstream.enqueue(":\n\n");
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 499,
        errorMessage: "CLIENT_ABORTED",
      })
    );
    expect(session.addProviderToChain).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: "system_error",
        statusCode: 499,
        errorMessage: "CLIENT_ABORTED",
      })
    );
  });

  it("keeps 499 CLIENT_ABORTED for non-Codex streams after response.completed", async () => {
    const controller = new AbortController();
    const session = makeSession(controller.signal, true, {
      provider: { providerType: "openai-compatible" },
      pathname: "/v1/responses",
      originalFormat: "response",
      providerType: "openai",
    });
    setDeferredMeta(session);
    const upstream = createHangingStream(
      [
        "event: response.completed",
        'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed"}}',
        "",
        "",
      ].join("\n")
    );
    const upstreamResponse = new Response(upstream.stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(readFirstClientChunk(response)).resolves.toContain("response.completed");

    controller.abort(new Error("client_closed_after_completed_non_codex"));
    upstream.enqueue(":\n\n");
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 499,
        errorMessage: "CLIENT_ABORTED",
      })
    );
    expect(session.addProviderToChain).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: "system_error",
        statusCode: 499,
        errorMessage: "CLIENT_ABORTED",
      })
    );
  });

  it("records Codex response.incomplete as successful when client aborts after terminal result", async () => {
    const controller = new AbortController();
    const session = makeSession(controller.signal, true, {
      provider: { providerType: "codex" },
      pathname: "/v1/responses",
      originalFormat: "response",
      providerType: "codex",
    });
    setDeferredMeta(session);
    const upstream = createHangingStream(
      [
        "event: response.incomplete",
        'data: {"type":"response.incomplete","response":{"id":"resp_1","status":"incomplete"}}',
        "",
        "",
      ].join("\n")
    );
    const upstreamResponse = new Response(upstream.stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(readFirstClientChunk(response)).resolves.toContain("response.incomplete");

    controller.abort(new Error("client_closed_after_incomplete"));
    upstream.enqueue(":\n\n");
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 200,
      })
    );
    expect(session.addProviderToChain).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: "request_success",
        statusCode: 200,
      })
    );
    expect(updateMessageRequestDetails).not.toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        errorMessage: "CLIENT_ABORTED",
      })
    );
  });

  it("keeps terminal failure when a failure follows response.completed", async () => {
    const controller = new AbortController();
    const session = makeSession(controller.signal, true, {
      provider: { providerType: "codex" },
      pathname: "/v1/responses",
      originalFormat: "response",
      providerType: "codex",
    });
    setDeferredMeta(session);
    const upstream = createHangingStream(
      [
        "event: response.completed",
        'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed"}}',
        "",
        "event: response.failed",
        'data: {"type":"response.failed","response":{"id":"resp_1","status":"failed"}}',
        "",
        "",
      ].join("\n")
    );
    const upstreamResponse = new Response(upstream.stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(readFirstClientChunk(response)).resolves.toContain("response.completed");

    controller.abort(new Error("client_closed_after_terminal_failure"));
    upstream.enqueue(":\n\n");
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 502,
        errorMessage: "CODEX_RESPONSE_FAILED",
      })
    );
    expect(session.addProviderToChain).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: "retry_failed",
        statusCode: 502,
        errorMessage: "CODEX_RESPONSE_FAILED",
      })
    );
  });

  it("keeps terminal error when Codex stream aborts after response.error", async () => {
    const controller = new AbortController();
    const session = makeSession(controller.signal, true, {
      provider: { providerType: "codex" },
      pathname: "/v1/responses",
      originalFormat: "response",
      providerType: "codex",
    });
    setDeferredMeta(session);
    const upstream = createHangingStream(
      [
        "event: response.error",
        'data: {"type":"response.error","error":{"message":"boom"}}',
        "",
        "",
      ].join("\n")
    );
    const upstreamResponse = new Response(upstream.stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(readFirstClientChunk(response)).resolves.toContain("response.error");

    controller.abort(new Error("client_closed_after_response_error"));
    upstream.enqueue(":\n\n");
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 502,
        errorMessage: "CODEX_RESPONSE_ERROR",
      })
    );
    expect(session.addProviderToChain).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: "retry_failed",
        statusCode: 502,
        errorMessage: "CODEX_RESPONSE_ERROR",
      })
    );
  });

  it("keeps terminal error when a plain-text error event follows response.completed", async () => {
    const controller = new AbortController();
    const session = makeSession(controller.signal, true, {
      provider: { providerType: "codex" },
      pathname: "/v1/responses",
      originalFormat: "response",
      providerType: "codex",
    });
    setDeferredMeta(session);
    const upstream = createHangingStream(
      [
        "event: response.completed",
        'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed"}}',
        "",
        "event: error",
        "data: upstream connection closed",
        "",
        "",
      ].join("\n")
    );
    const upstreamResponse = new Response(upstream.stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(readFirstClientChunk(response)).resolves.toContain("response.completed");

    controller.abort(new Error("client_closed_after_plain_text_error"));
    upstream.enqueue(":\n\n");
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 502,
        errorMessage: "CODEX_RESPONSE_ERROR",
      })
    );
    expect(session.addProviderToChain).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: "retry_failed",
        statusCode: 502,
        errorMessage: "CODEX_RESPONSE_ERROR",
      })
    );
  });

  it("records Codex response.completed as successful when upstream aborts after terminal success", async () => {
    const session = makeSession(null, true, {
      provider: { providerType: "codex" },
      pathname: "/v1/responses",
      originalFormat: "response",
      providerType: "codex",
    });
    setDeferredMeta(session);
    const upstream = createHangingStream(
      [
        "event: response.completed",
        'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed"}}',
        "",
        "",
      ].join("\n")
    );
    const upstreamResponse = new Response(upstream.stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(readFirstClientChunk(response)).resolves.toContain("response.completed");

    upstream.error(new Error("upstream_closed_after_completed"));
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 200,
      })
    );
    expect(updateMessageRequestDetails).not.toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        errorMessage: "STREAM_PROCESSING_ERROR",
      })
    );
    expect(session.addProviderToChain).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: "system_error",
        errorMessage: "STREAM_PROCESSING_ERROR",
      })
    );
  });

  it("records Codex Responses multiline completed event as successful after client abort", async () => {
    const controller = new AbortController();
    const session = makeSession(controller.signal, true, {
      provider: { providerType: "codex" },
      pathname: "/v1/responses",
      originalFormat: "response",
      providerType: "codex",
    });
    setDeferredMeta(session);
    const upstream = createHangingStream(
      [
        "event: response.completed",
        'data: {"type":"response.completed",',
        'data: "response":{"id":"resp_1","status":"completed"}}',
        "",
        "",
      ].join("\n")
    );
    const upstreamResponse = new Response(upstream.stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(readFirstClientChunk(response)).resolves.toContain("response.completed");

    controller.abort(new Error("client_closed_after_multiline_completed"));
    upstream.enqueue(":\n\n");
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 200,
      })
    );
    expect(updateMessageRequestDetails).not.toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        errorMessage: "CLIENT_ABORTED",
      })
    );
    expect(session.addProviderToChain).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: "system_error",
        errorMessage: "CLIENT_ABORTED",
      })
    );
  });

  it("client abort after response.error terminal event — recorded as 502", async () => {
    const controller = new AbortController();
    const session = makeSession(controller.signal, true, {
      provider: { providerType: "codex" },
      pathname: "/v1/responses",
      originalFormat: "response",
      providerType: "codex",
    });
    setDeferredMeta(session);
    const upstream = createHangingStream(
      [
        "event: response.error",
        'data: {"type":"response.error","error":{"message":"boom"}}',
        "",
        "",
      ].join("\n")
    );
    const upstreamResponse = new Response(upstream.stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(readFirstClientChunk(response)).resolves.toContain("response.error");

    controller.abort(new Error("client_closed_after_response_error"));
    upstream.enqueue(":\n\n");
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 502,
        errorMessage: "CODEX_RESPONSE_ERROR",
      })
    );
    expect(session.addProviderToChain).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: "retry_failed",
        statusCode: 502,
        errorMessage: "CODEX_RESPONSE_ERROR",
      })
    );
  });

  it("client abort after response.completed without trailing newline — recorded as 200", async () => {
    const controller = new AbortController();
    const session = makeSession(controller.signal, true, {
      provider: { providerType: "codex" },
      pathname: "/v1/responses",
      originalFormat: "response",
      providerType: "codex",
    });
    setDeferredMeta(session);
    const upstream = createHangingStream(
      'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_test"}}\n'
    );
    const upstreamResponse = new Response(upstream.stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const response = await ProxyResponseHandler.dispatch(session, upstreamResponse);
    await expect(readFirstClientChunk(response)).resolves.toContain("response.completed");

    controller.abort(new Error("client_closed_after_completed_without_trailing_newline"));
    upstream.controller.abort();
    await drainAsyncTasks();

    expect(updateMessageRequestDetails).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        statusCode: 200,
      })
    );
  });
});
