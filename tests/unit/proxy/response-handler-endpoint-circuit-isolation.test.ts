/**
 * Tests for endpoint circuit breaker isolation in response-handler.ts
 *
 * Verifies that key-level errors (fake 200, non-200 HTTP, stream abort) do NOT
 * call recordEndpointFailure. Only forwarder-level failures (timeout, network
 * error) and probe failures should penalize the endpoint circuit breaker.
 *
 * Streaming success DOES call recordEndpointSuccess (regression guard).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import type { ModelPriceData } from "@/types/model-price";

// Track async tasks for draining
const asyncTasks: Promise<void>[] = [];

vi.mock("@/lib/async-task-manager", () => ({
  AsyncTaskManager: {
    register: (
      _taskId: string,
      factory: (signal: AbortSignal) => Promise<void>,
      options?: string | { abortController?: AbortController }
    ) => {
      const controller =
        typeof options === "object" && options.abortController
          ? options.abortController
          : new AbortController();
      let promise: Promise<void>;
      try {
        promise = Promise.resolve(factory(controller.signal));
      } catch (error) {
        promise = Promise.reject(error);
      }
      asyncTasks.push(promise);
      return controller;
    },
    touch: () => true,
    cleanup: () => {},
    cancel: () => {},
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    trace: () => {},
  },
}));

vi.mock("@/lib/price-sync/cloud-price-updater", () => ({
  requestCloudPriceTableSync: () => {},
}));

vi.mock("@/repository/model-price", () => ({
  findLatestPriceByModel: vi.fn(),
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: vi.fn(),
}));

vi.mock("@/repository/message", () => ({
  updateMessageRequestCost: vi.fn(),
  updateMessageRequestCostWithBreakdown: vi.fn(),
  updateMessageRequestDetails: vi.fn(),
  updateMessageRequestDetailsDurably: vi.fn(),
  updateMessageRequestDetailsIfUnfinalized: vi.fn(),
  updateMessageRequestDuration: vi.fn(),
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    updateSessionUsage: vi.fn(),
    storeSessionResponse: vi.fn(),
    clearSessionProvider: vi.fn(),
    clearVersionedSessionProvider: vi.fn(),
    compareAndSetSessionProvider: vi.fn(),
    getSessionBindingSnapshot: vi.fn(),
    getVersionedSessionBindingRefreshIntervalMs: vi.fn(),
    renewSessionDiscoveryLease: vi.fn(),
    releaseSessionDiscoveryLease: vi.fn(),
    touchVersionedSessionBinding: vi.fn(),
    extractCodexPromptCacheKey: vi.fn(),
    updateSessionBindingSmart: vi.fn(),
    updateSessionProvider: vi.fn(),
    updateSessionWithCodexCacheKey: vi.fn(),
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  RateLimitService: {
    trackCost: vi.fn(),
    trackUserDailyCost: vi.fn(),
    decrementLeaseBudget: vi.fn(),
    settleLeaseBudgets: vi.fn(),
    releaseProviderSession: vi.fn(),
  },
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    refreshSession: vi.fn(),
  },
}));

vi.mock("@/lib/proxy-status-tracker", () => ({
  ProxyStatusTracker: {
    getInstance: () => ({
      endRequest: () => {},
    }),
  },
}));

// Mock circuit breakers with tracked spies (vi.hoisted to avoid TDZ with vi.mock hoisting)
const {
  mockRecordFailure,
  mockRecordSuccess,
  mockRecordEndpointFailure,
  mockRecordEndpointSuccess,
} = vi.hoisted(() => ({
  mockRecordFailure: vi.fn(),
  mockRecordSuccess: vi.fn(),
  mockRecordEndpointFailure: vi.fn(),
  mockRecordEndpointSuccess: vi.fn(),
}));

vi.mock("@/lib/circuit-breaker", () => ({
  recordFailure: mockRecordFailure,
  recordSuccess: mockRecordSuccess,
}));

vi.mock("@/lib/endpoint-circuit-breaker", () => ({
  recordEndpointFailure: mockRecordEndpointFailure,
  recordEndpointSuccess: mockRecordEndpointSuccess,
  resetEndpointCircuit: vi.fn(),
}));

import { ProxyResponseHandler } from "@/app/v1/_lib/proxy/response-handler";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import { setDeferredStreamingFinalization } from "@/app/v1/_lib/proxy/stream-finalization";
import { getSystemSettings } from "@/repository/system-config";
import { findLatestPriceByModel } from "@/repository/model-price";
import {
  updateMessageRequestDetails,
  updateMessageRequestDetailsDurably,
  updateMessageRequestDuration,
} from "@/repository/message";
import { SessionManager } from "@/lib/session-manager";
import { RateLimitService } from "@/lib/rate-limit";
import { SessionTracker } from "@/lib/session-tracker";

const testPriceData: ModelPriceData = {
  input_cost_per_token: 0.000003,
  output_cost_per_token: 0.000015,
};

function createSession(opts?: { sessionId?: string | null }): ProxySession {
  const session = Object.create(ProxySession.prototype) as ProxySession;
  const provider = {
    id: 1,
    name: "test-provider",
    providerType: "claude" as const,
    baseUrl: "https://api.test.com",
    priority: 10,
    weight: 1,
    costMultiplier: 1,
    groupTag: "default",
    isEnabled: true,
    models: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    streamingIdleTimeoutMs: 0,
    dailyResetTime: "00:00",
    dailyResetMode: "fixed",
  };

  const user = { id: 123, name: "test-user", dailyResetTime: "00:00", dailyResetMode: "fixed" };
  const key = { id: 456, name: "test-key", dailyResetTime: "00:00", dailyResetMode: "fixed" };

  Object.assign(session, {
    request: { message: {}, log: "(test)", model: "test-model" },
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("http://localhost/v1/messages"),
    headers: new Headers(),
    headerLog: "",
    userAgent: null,
    context: {},
    clientAbortSignal: null,
    userName: "test-user",
    authState: { user, key, apiKey: "sk-test", success: true },
    provider,
    messageContext: {
      id: 1,
      createdAt: new Date(),
      user,
      key,
      apiKey: "sk-test",
    },
    sessionId: opts?.sessionId ?? "fake-session",
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
    getContext1mApplied: () => false,
    getGroupCostMultiplier: () => 1,
    getOriginalModel: () => "test-model",
    getCurrentModel: () => "test-model",
    getProviderChain: () => session.providerChain,
    getCachedPriceDataByBillingSource: async () => testPriceData,
    recordTtfb: () => 100,
    ttfbMs: null,
    getRequestSequence: () => 1,
    addProviderToChain: function (
      this: ProxySession & { providerChain: Record<string, unknown>[] },
      prov: {
        id: number;
        name: string;
        providerType: string;
        priority: number;
        weight: number;
        costMultiplier: number;
        groupTag: string;
        providerVendorId?: string;
      },
      metadata?: Record<string, unknown>
    ) {
      this.providerChain.push({
        id: prov.id,
        name: prov.name,
        vendorId: prov.providerVendorId,
        providerType: prov.providerType,
        priority: prov.priority,
        weight: prov.weight,
        costMultiplier: prov.costMultiplier,
        groupTag: prov.groupTag,
        timestamp:
          typeof metadata?.timestamp === "number" && Number.isFinite(metadata.timestamp)
            ? metadata.timestamp
            : Date.now(),
        ...(metadata ?? {}),
      });
    },
  });

  // Helper setters
  (session as { setOriginalModel(m: string | null): void }).setOriginalModel = function (
    m: string | null
  ) {
    (this as { originalModelName: string | null }).originalModelName = m;
  };
  (session as { setSessionId(s: string): void }).setSessionId = function (s: string) {
    (this as { sessionId: string | null }).sessionId = s;
  };
  (session as { setProvider(p: unknown): void }).setProvider = function (p: unknown) {
    (this as { provider: unknown }).provider = p;
  };
  (session as { setAuthState(a: unknown): void }).setAuthState = function (a: unknown) {
    (this as { authState: unknown }).authState = a;
  };
  (session as { setMessageContext(c: unknown): void }).setMessageContext = function (c: unknown) {
    (this as { messageContext: unknown }).messageContext = c;
  };

  session.setOriginalModel("test-model");

  return session;
}

function setDeferredMeta(
  session: ProxySession,
  endpointId: number | null = 42,
  extra: Partial<Parameters<typeof setDeferredStreamingFinalization>[1]> = {}
) {
  setDeferredStreamingFinalization(session, {
    providerId: 1,
    providerName: "test-provider",
    providerPriority: 10,
    attemptNumber: 1,
    totalProvidersAttempted: 1,
    isFirstAttempt: true,
    isFailoverSuccess: false,
    endpointId,
    endpointUrl: "https://api.test.com",
    upstreamStatusCode: 200,
    ...extra,
  });
}

/** Create an SSE stream that emits a fake-200 error body (valid HTTP 200 but error in content). */
function createFake200StreamResponse(errorMessage: string = "invalid api key"): Response {
  const body = `data: ${JSON.stringify({ error: { message: errorMessage } })}\n\n`;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** Create an SSE stream that returns non-200 HTTP status with error body. */
function createNon200StreamResponse(statusCode: number): Response {
  const body = `data: ${JSON.stringify({ error: "rate limit exceeded" })}\n\n`;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status: statusCode,
    headers: { "content-type": "text/event-stream" },
  });
}

/** Create a successful SSE stream with usage data. */
function createSuccessStreamResponse(): Response {
  const sseText = `event: message_delta\ndata: ${JSON.stringify({ usage: { input_tokens: 100, output_tokens: 50 } })}\n\n`;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sseText));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function createSuccessStreamResponseWithCompletion(): Response {
  const sseText =
    `data: ${JSON.stringify({ type: "content_block_delta", delta: { text: "ok" } })}\n\n` +
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sseText));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function createMisleadingCompletionTextResponse(): Response {
  const sseText =
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      delta: { text: "the words message_stop and response.completed are ordinary content" },
    })}\n\n` +
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: null },
    })}\n\n`;
  return new Response(sseText, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}
function createControllableSuccessStreamResponse(): {
  response: Response;
  complete: () => void;
} {
  const encoder = new TextEncoder();
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "content_block_delta", delta: { text: "ok" } })}\n\n`
        )
      );
    },
  });
  return {
    response: new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    complete: () => {
      streamController.enqueue(
        encoder.encode(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`)
      );
      streamController.close();
    },
  };
}

async function drainAsyncTasks(): Promise<void> {
  while (asyncTasks.length > 0) {
    const tasks = asyncTasks.splice(0, asyncTasks.length);
    await Promise.all(tasks);
  }
}

function setupCommonMocks() {
  vi.mocked(getSystemSettings).mockResolvedValue({
    billingModelSource: "original",
    streamBufferEnabled: false,
    streamBufferMode: "none",
    streamBufferSize: 0,
  } as ReturnType<typeof getSystemSettings> extends Promise<infer T> ? T : never);
  vi.mocked(findLatestPriceByModel).mockResolvedValue({
    id: 1,
    modelName: "test-model",
    priceData: testPriceData,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  vi.mocked(updateMessageRequestDetails).mockResolvedValue(undefined);
  vi.mocked(updateMessageRequestDetailsDurably).mockImplementation(
    async (_messageId, _details, options) => {
      await options?.onCommitted?.();
      return true;
    }
  );
  vi.mocked(updateMessageRequestDuration).mockResolvedValue(undefined);
  vi.mocked(SessionManager.storeSessionResponse).mockResolvedValue(undefined);
  vi.mocked(SessionManager.clearSessionProvider).mockResolvedValue(undefined);
  vi.mocked(SessionManager.clearVersionedSessionProvider).mockResolvedValue({
    status: "ok",
    source: "cleared",
    snapshot: {
      sessionId: "fake-session",
      keyId: 456,
      providerId: null,
      generation: "cleared",
    },
    legacyFallbackAllowed: false,
  });
  vi.mocked(SessionManager.compareAndSetSessionProvider).mockResolvedValue({
    status: "ok",
    source: "updated",
    snapshot: {
      sessionId: "fake-session",
      keyId: 456,
      providerId: 1,
      generation: "updated",
    },
    legacyFallbackAllowed: false,
  });
  vi.mocked(SessionManager.getSessionBindingSnapshot).mockResolvedValue({
    status: "ok",
    source: "existing",
    snapshot: {
      sessionId: "fake-session",
      keyId: 456,
      providerId: null,
      generation: "fresh",
    },
    legacyFallbackAllowed: false,
  });
  vi.mocked(SessionManager.getVersionedSessionBindingRefreshIntervalMs).mockReturnValue(100_000);
  vi.mocked(SessionManager.renewSessionDiscoveryLease).mockResolvedValue({
    status: "renewed",
    legacyFallbackAllowed: false,
  });
  vi.mocked(SessionManager.touchVersionedSessionBinding).mockImplementation(async (binding) => ({
    status: "ok",
    source: "touched",
    snapshot: binding,
    legacyFallbackAllowed: false,
  }));
  vi.mocked(SessionManager.releaseSessionDiscoveryLease).mockResolvedValue({
    status: "released",
    legacyFallbackAllowed: false,
  });
  vi.mocked(SessionManager.updateSessionUsage).mockResolvedValue(undefined);
  vi.mocked(SessionManager.updateSessionBindingSmart).mockResolvedValue({
    updated: true,
    reason: "test",
  });
  vi.mocked(SessionManager.updateSessionProvider).mockResolvedValue(undefined);
  vi.mocked(RateLimitService.trackCost).mockResolvedValue(undefined);
  vi.mocked(RateLimitService.trackUserDailyCost).mockResolvedValue(undefined);
  vi.mocked(RateLimitService.decrementLeaseBudget).mockResolvedValue({
    success: true,
    newRemaining: 10,
  });
  vi.mocked(RateLimitService.settleLeaseBudgets).mockResolvedValue({
    requestId: "test",
    status: "settled",
    settlements: [],
  });
  vi.mocked(RateLimitService.releaseProviderSession).mockResolvedValue(undefined);
  vi.mocked(SessionTracker.refreshSession).mockResolvedValue(undefined);
  mockRecordFailure.mockResolvedValue(undefined);
  mockRecordSuccess.mockResolvedValue(undefined);
  mockRecordEndpointFailure.mockResolvedValue(undefined);
  mockRecordEndpointSuccess.mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  asyncTasks.splice(0, asyncTasks.length);
});

describe("Endpoint circuit breaker isolation", () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  it("fake-200 error should call recordFailure but NOT recordEndpointFailure", async () => {
    const session = createSession();
    setDeferredMeta(session, 42);

    const response = createFake200StreamResponse();
    const clientResponse = await ProxyResponseHandler.dispatch(session, response);
    await clientResponse.text();
    await drainAsyncTasks();

    expect(mockRecordFailure).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ message: expect.stringContaining("FAKE_200") })
    );
    expect(mockRecordEndpointFailure).not.toHaveBeenCalled();
    expect(SessionManager.clearSessionProvider).toHaveBeenCalledWith("fake-session", 1, 456);

    const chain = session.getProviderChain();
    expect(
      chain.some(
        (item) =>
          item.id === 1 &&
          item.reason === "retry_failed" &&
          item.statusCode === 401 &&
          item.statusCodeInferred === true
      )
    ).toBe(true);
  });

  it("does not clear a binding when the request routing mode forbids binding mutations", async () => {
    const session = createSession();
    Object.assign(session, { isSessionBindingAllowed: () => false });
    setDeferredMeta(session, 42);

    const clientResponse = await ProxyResponseHandler.dispatch(
      session,
      createFake200StreamResponse()
    );
    await clientResponse.text();
    await drainAsyncTasks();

    expect(SessionManager.clearSessionProvider).not.toHaveBeenCalled();
    expect(SessionManager.clearVersionedSessionProvider).not.toHaveBeenCalled();
  });

  it("高并发模式下，fake-200 流式错误仍应记录核心失败，但跳过 session 观测写入", async () => {
    const session = createSession();
    session.setHighConcurrencyModeEnabled(true);
    setDeferredMeta(session, 42);

    const response = createFake200StreamResponse();
    const clientResponse = await ProxyResponseHandler.dispatch(session, response);
    await clientResponse.text();
    await drainAsyncTasks();

    expect(mockRecordFailure).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ message: expect.stringContaining("FAKE_200") })
    );
    expect(mockRecordEndpointFailure).not.toHaveBeenCalled();
    expect(SessionManager.clearSessionProvider).toHaveBeenCalledWith("fake-session", 1, 456);
    expect(SessionManager.updateSessionUsage).not.toHaveBeenCalled();
    expect(SessionTracker.refreshSession).not.toHaveBeenCalled();
  });

  it("fake-200 inferred 404 should NOT call recordFailure and should be marked as resource_not_found", async () => {
    const session = createSession();
    setDeferredMeta(session, 42);

    const response = createFake200StreamResponse("model not found");
    const clientResponse = await ProxyResponseHandler.dispatch(session, response);
    await clientResponse.text();
    await drainAsyncTasks();

    expect(mockRecordFailure).not.toHaveBeenCalled();
    expect(mockRecordEndpointFailure).not.toHaveBeenCalled();
    expect(SessionManager.clearSessionProvider).toHaveBeenCalledWith("fake-session", 1, 456);

    const chain = session.getProviderChain();
    expect(
      chain.some(
        (item) =>
          item.id === 1 &&
          item.reason === "resource_not_found" &&
          item.statusCode === 404 &&
          item.statusCodeInferred === true
      )
    ).toBe(true);
  });

  it("non-200 HTTP status should call recordFailure but NOT recordEndpointFailure", async () => {
    const session = createSession();
    // Set upstream status to 429 in deferred meta
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "test-provider",
      providerPriority: 10,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.com",
      upstreamStatusCode: 429,
    });

    const response = createNon200StreamResponse(429);
    const clientResponse = await ProxyResponseHandler.dispatch(session, response);
    await clientResponse.text();
    await drainAsyncTasks();

    expect(mockRecordFailure).toHaveBeenCalledWith(1, expect.any(Error));
    expect(mockRecordEndpointFailure).not.toHaveBeenCalled();
  });

  it("streaming success DOES call recordEndpointSuccess (regression guard)", async () => {
    const session = createSession();
    setDeferredMeta(session, 42);

    const response = createSuccessStreamResponse();
    const clientResponse = await ProxyResponseHandler.dispatch(session, response);
    await clientResponse.text();
    await drainAsyncTasks();

    expect(mockRecordEndpointSuccess).toHaveBeenCalledWith(42);
    expect(mockRecordSuccess).toHaveBeenCalledWith(1);
    expect(mockRecordEndpointFailure).not.toHaveBeenCalled();
    expect(SessionManager.updateSessionBindingSmart).toHaveBeenCalledWith(
      "fake-session",
      1,
      10,
      true,
      false,
      456
    );
    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ statusCode: 200, providerId: 1 }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it("streaming success without endpointId should NOT call any endpoint circuit breaker function", async () => {
    const session = createSession();
    setDeferredMeta(session, null);

    const response = createSuccessStreamResponse();
    const clientResponse = await ProxyResponseHandler.dispatch(session, response);
    await clientResponse.text();
    await drainAsyncTasks();

    expect(mockRecordEndpointSuccess).not.toHaveBeenCalled();
    expect(mockRecordEndpointFailure).not.toHaveBeenCalled();
  });

  it("does not clear a create binding when Discovery finishes with fake-200", async () => {
    const session = createSession();
    session.recordProviderSessionRef(1);
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "test-provider",
      providerPriority: 10,
      attemptNumber: 1,
      totalProvidersAttempted: 2,
      isFirstAttempt: false,
      isFailoverSuccess: true,
      endpointId: 42,
      endpointUrl: "https://api.test.com",
      upstreamStatusCode: 200,
      bindingIntent: "create",
      bindingSnapshot: {
        sessionId: "fake-session",
        keyId: 456,
        providerId: null,
        generation: "create-generation",
      },
      providerSessionRefOwned: true,
    });

    const clientResponse = await ProxyResponseHandler.dispatch(
      session,
      createFake200StreamResponse()
    );
    await clientResponse.text();
    await drainAsyncTasks();

    expect(SessionManager.clearVersionedSessionProvider).not.toHaveBeenCalled();
    expect(SessionManager.clearSessionProvider).not.toHaveBeenCalled();
    expect(RateLimitService.releaseProviderSession).toHaveBeenCalledOnce();
    expect(RateLimitService.releaseProviderSession).toHaveBeenCalledWith(1, "fake-session");
  });

  it("clears only the captured renew snapshot after a fake-200", async () => {
    const session = createSession();
    const snapshot = {
      sessionId: "fake-session",
      keyId: 456,
      providerId: 1,
      generation: "renew-generation",
    } as const;
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "test-provider",
      providerPriority: 10,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.com",
      upstreamStatusCode: 200,
      bindingIntent: "renew",
      bindingSnapshot: snapshot,
    });

    const clientResponse = await ProxyResponseHandler.dispatch(
      session,
      createFake200StreamResponse()
    );
    await clientResponse.text();
    await drainAsyncTasks();

    expect(SessionManager.clearVersionedSessionProvider).toHaveBeenCalledWith(snapshot, 1, 0);
    expect(SessionManager.clearSessionProvider).not.toHaveBeenCalled();
  });

  it("never mutates a binding for fallback intent none", async () => {
    const session = createSession();
    session.recordProviderSessionRef(1);
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "test-provider",
      providerPriority: 10,
      attemptNumber: 2,
      totalProvidersAttempted: 2,
      isFirstAttempt: false,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.com",
      upstreamStatusCode: 200,
      bindingIntent: "none",
      providerSessionRefOwned: true,
    });

    const clientResponse = await ProxyResponseHandler.dispatch(
      session,
      createFake200StreamResponse()
    );
    await clientResponse.text();
    await drainAsyncTasks();

    expect(SessionManager.clearVersionedSessionProvider).not.toHaveBeenCalled();
    expect(SessionManager.clearSessionProvider).not.toHaveBeenCalled();
    expect(SessionManager.compareAndSetSessionProvider).not.toHaveBeenCalled();
    expect(SessionManager.updateSessionBindingSmart).not.toHaveBeenCalled();
    expect(RateLimitService.releaseProviderSession).toHaveBeenCalledWith(1, "fake-session");
  });

  it("does not clear a create tombstone when the completion marker is missing", async () => {
    const session = createSession();
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "test-provider",
      providerPriority: 10,
      attemptNumber: 1,
      totalProvidersAttempted: 2,
      isFirstAttempt: false,
      isFailoverSuccess: true,
      endpointId: 42,
      endpointUrl: "https://api.test.com",
      upstreamStatusCode: 200,
      bindingIntent: "create",
      bindingSnapshot: {
        sessionId: "fake-session",
        keyId: 456,
        providerId: null,
        generation: "incomplete-generation",
      },
      requiresCompletionMarker: true,
    });

    const clientResponse = await ProxyResponseHandler.dispatch(
      session,
      createSuccessStreamResponse()
    );
    await clientResponse.text();
    await drainAsyncTasks();

    expect(SessionManager.clearVersionedSessionProvider).not.toHaveBeenCalled();
    expect(SessionManager.clearSessionProvider).not.toHaveBeenCalled();
    expect(SessionManager.compareAndSetSessionProvider).not.toHaveBeenCalled();
  });

  it("does not accept completion marker words embedded in ordinary SSE content", async () => {
    const session = createSession();
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "test-provider",
      providerPriority: 10,
      attemptNumber: 1,
      totalProvidersAttempted: 2,
      isFirstAttempt: false,
      isFailoverSuccess: true,
      endpointId: 42,
      endpointUrl: "https://api.test.com",
      upstreamStatusCode: 200,
      bindingIntent: "create",
      bindingSnapshot: {
        sessionId: "fake-session",
        keyId: 456,
        providerId: null,
        generation: "misleading-content-generation",
      },
      requiresCompletionMarker: true,
    });

    const clientResponse = await ProxyResponseHandler.dispatch(
      session,
      createMisleadingCompletionTextResponse()
    );
    await clientResponse.text();
    await drainAsyncTasks();

    expect(SessionManager.compareAndSetSessionProvider).not.toHaveBeenCalled();
    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        statusCode: 502,
        errorMessage: "STREAM_COMPLETION_MARKER_MISSING",
      }),
      expect.objectContaining({ onCommitted: expect.any(Function) })
    );
  });

  it("does not let response.done override an earlier nested Responses failure", async () => {
    const session = createSession();
    session.originalFormat = "response";
    const snapshot = {
      sessionId: "fake-session",
      keyId: 456,
      providerId: null,
      generation: "failed-before-done-generation",
    } as const;
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "test-provider",
      providerPriority: 10,
      attemptNumber: 1,
      totalProvidersAttempted: 2,
      isFirstAttempt: false,
      isFailoverSuccess: true,
      endpointId: 42,
      endpointUrl: "https://api.test.com",
      upstreamStatusCode: 200,
      bindingIntent: "create",
      bindingSnapshot: snapshot,
      requiresCompletionMarker: true,
    });
    const body =
      `event: response.output_text.delta\ndata: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: "partial output",
      })}\n\n` +
      `event: response.failed\ndata: ${JSON.stringify({
        type: "response.failed",
        response: { status: "failed", error: { message: "upstream failed" } },
      })}\n\n` +
      `event: response.done\ndata: ${JSON.stringify({ type: "response.done" })}\n\n`;

    const clientResponse = await ProxyResponseHandler.dispatch(
      session,
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })
    );
    await clientResponse.text();
    await drainAsyncTasks();

    expect(SessionManager.compareAndSetSessionProvider).not.toHaveBeenCalled();
    expect(mockRecordSuccess).not.toHaveBeenCalled();
    expect(mockRecordFailure).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ message: "STREAM_COMPLETION_MARKER_MISSING" })
    );
  });

  it.each([
    {
      label: "Claude data-only stop",
      format: "claude" as const,
      body: `data: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    },
    {
      label: "OpenAI Responses",
      format: "response" as const,
      body: `event: response.completed\ndata: ${JSON.stringify({
        type: "response.completed",
        response: { id: "resp_completed" },
      })}\n\n`,
    },
    {
      label: "OpenAI Responses data-only completed",
      format: "response" as const,
      body: `data: ${JSON.stringify({
        type: "response.completed",
        response: { id: "resp_data_only_completed" },
      })}\n\n`,
    },
    {
      label: "OpenAI Responses done",
      format: "response" as const,
      body: `event: response.done\ndata: ${JSON.stringify({ type: "response.done" })}\n\n`,
    },
    {
      label: "OpenAI Chat finish reason",
      format: "openai" as const,
      body: `data: ${JSON.stringify({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      })}\n\n`,
    },
    {
      label: "OpenAI Chat done sentinel",
      format: "openai" as const,
      body: "data: [DONE]\n\n",
    },
    {
      label: "Gemini",
      format: "gemini" as const,
      body: `data: ${JSON.stringify({
        candidates: [{ finishReason: "STOP" }],
      })}\n\n`,
    },
    {
      label: "Gemini wrapped response",
      format: "gemini" as const,
      body: `data: ${JSON.stringify({
        response: { candidates: [{ finishReason: "STOP" }] },
      })}\n\n`,
    },
    {
      label: "Gemini CLI",
      format: "gemini-cli" as const,
      body: `data: ${JSON.stringify({
        response: { candidates: [{ finishReason: "STOP" }] },
      })}\n\n`,
    },
  ])("accepts a structurally valid $label completion marker", async ({ format, body }) => {
    const session = createSession();
    session.originalFormat = format;
    const snapshot = {
      sessionId: "fake-session",
      keyId: 456,
      providerId: null,
      generation: `${format}-completion-generation`,
    } as const;
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "test-provider",
      providerPriority: 10,
      attemptNumber: 1,
      totalProvidersAttempted: 2,
      isFirstAttempt: false,
      isFailoverSuccess: true,
      endpointId: 42,
      endpointUrl: "https://api.test.com",
      upstreamStatusCode: 200,
      bindingIntent: "create",
      bindingSnapshot: snapshot,
      requiresCompletionMarker: true,
    });

    const clientResponse = await ProxyResponseHandler.dispatch(
      session,
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })
    );
    await clientResponse.text();
    await drainAsyncTasks();

    expect(SessionManager.compareAndSetSessionProvider).toHaveBeenCalledWith(snapshot, 1);
    expect(mockRecordFailure).not.toHaveBeenCalled();
  });

  it("releases a create attempt ref when generation CAS loses", async () => {
    const session = createSession();
    session.recordProviderSessionRef(1);
    const snapshot = {
      sessionId: "fake-session",
      keyId: 456,
      providerId: null,
      generation: "stale-generation",
    } as const;
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "test-provider",
      providerPriority: 10,
      attemptNumber: 1,
      totalProvidersAttempted: 2,
      isFirstAttempt: false,
      isFailoverSuccess: true,
      endpointId: 42,
      endpointUrl: "https://api.test.com",
      upstreamStatusCode: 200,
      bindingIntent: "create",
      bindingSnapshot: snapshot,
      requiresCompletionMarker: true,
      providerSessionRefOwned: true,
      providerSessionRefRetainOnSuccess: true,
    });
    vi.mocked(SessionManager.compareAndSetSessionProvider).mockResolvedValueOnce({
      status: "conflict",
      reason: "generation_mismatch",
      legacyFallbackAllowed: false,
    });

    const clientResponse = await ProxyResponseHandler.dispatch(
      session,
      createSuccessStreamResponseWithCompletion()
    );
    await clientResponse.text();
    await drainAsyncTasks();

    expect(RateLimitService.releaseProviderSession).toHaveBeenCalledOnce();
    expect(RateLimitService.releaseProviderSession).toHaveBeenCalledWith(1, "fake-session");
  });

  it("retains an owned Provider ref after a renew generation CAS succeeds", async () => {
    const session = createSession();
    session.recordProviderSessionRef(1);
    const snapshot = {
      sessionId: "fake-session",
      keyId: 456,
      providerId: 1,
      generation: "renew-generation",
    } as const;
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "test-provider",
      providerPriority: 10,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.com",
      upstreamStatusCode: 200,
      bindingIntent: "renew",
      bindingSnapshot: snapshot,
      requiresCompletionMarker: true,
      providerSessionRefOwned: true,
      providerSessionRefRetainOnSuccess: true,
    });

    const clientResponse = await ProxyResponseHandler.dispatch(
      session,
      createSuccessStreamResponseWithCompletion()
    );
    await clientResponse.text();
    await drainAsyncTasks();

    expect(SessionManager.compareAndSetSessionProvider).toHaveBeenCalledWith(snapshot, 1);
    expect(RateLimitService.releaseProviderSession).not.toHaveBeenCalled();
  });

  it("releases an owned Provider ref after CAS success when it is not the new baseline", async () => {
    const session = createSession();
    session.recordProviderSessionRef(1);
    const snapshot = {
      sessionId: "fake-session",
      keyId: 456,
      providerId: 1,
      generation: "existing-baseline-generation",
    } as const;
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "test-provider",
      providerPriority: 10,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.com",
      upstreamStatusCode: 200,
      bindingIntent: "renew",
      bindingSnapshot: snapshot,
      requiresCompletionMarker: true,
      providerSessionRefOwned: true,
      providerSessionRefRetainOnSuccess: false,
    });

    const clientResponse = await ProxyResponseHandler.dispatch(
      session,
      createSuccessStreamResponseWithCompletion()
    );
    await clientResponse.text();
    await drainAsyncTasks();

    expect(SessionManager.compareAndSetSessionProvider).toHaveBeenCalledWith(snapshot, 1);
    expect(RateLimitService.releaseProviderSession).toHaveBeenCalledWith(1, "fake-session");
  });

  it.each([
    {
      label: "lost",
      leaseResult: {
        status: "lost",
        reason: "not_owner_or_missing",
        legacyFallbackAllowed: false,
      } as const,
    },
    {
      label: "unavailable",
      leaseResult: {
        status: "unavailable",
        reason: "operation_failed",
        capabilityState: "unavailable",
        legacyFallbackAllowed: true,
      } as const,
    },
  ])("fails binding closed when the finalizer lease is $label", async ({ leaseResult }) => {
    const session = createSession();
    session.recordProviderSessionRef(1);
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "test-provider",
      providerPriority: 10,
      attemptNumber: 1,
      totalProvidersAttempted: 2,
      isFirstAttempt: false,
      isFailoverSuccess: true,
      endpointId: 42,
      endpointUrl: "https://api.test.com",
      upstreamStatusCode: 200,
      bindingIntent: "create",
      bindingSnapshot: {
        sessionId: "fake-session",
        keyId: 456,
        providerId: null,
        generation: "lease-guarded-generation",
      },
      requiresCompletionMarker: true,
      discoveryLease: {
        sessionId: "fake-session",
        keyId: 456,
        ownerToken: "lease-owner",
        ttlSeconds: 30,
      },
      providerSessionRefOwned: true,
    });
    vi.mocked(SessionManager.renewSessionDiscoveryLease).mockResolvedValueOnce(leaseResult);

    const clientResponse = await ProxyResponseHandler.dispatch(
      session,
      createSuccessStreamResponseWithCompletion()
    );
    await clientResponse.text();
    await drainAsyncTasks();

    expect(SessionManager.renewSessionDiscoveryLease).toHaveBeenCalledOnce();
    expect(SessionManager.compareAndSetSessionProvider).not.toHaveBeenCalled();
    expect(RateLimitService.releaseProviderSession).toHaveBeenCalledWith(1, "fake-session");
    expect(SessionManager.releaseSessionDiscoveryLease).toHaveBeenCalledOnce();
  });

  it("renews a long-stream lease and releases it once after terminal side effects", async () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];
      const session = createSession();
      setDeferredStreamingFinalization(session, {
        providerId: 1,
        providerName: "test-provider",
        providerPriority: 10,
        attemptNumber: 2,
        totalProvidersAttempted: 2,
        isFirstAttempt: false,
        isFailoverSuccess: false,
        endpointId: 42,
        endpointUrl: "https://api.test.com",
        upstreamStatusCode: 200,
        bindingIntent: "none",
        requiresCompletionMarker: false,
        discoveryLease: {
          sessionId: "fake-session",
          keyId: 456,
          ownerToken: "lease-owner",
          ttlSeconds: 2,
        },
      });
      mockRecordSuccess.mockImplementationOnce(async () => {
        order.push("side-effect");
      });
      vi.mocked(SessionManager.releaseSessionDiscoveryLease).mockImplementationOnce(async () => {
        order.push("lease-release");
        return { status: "released", legacyFallbackAllowed: false };
      });
      const controlled = createControllableSuccessStreamResponse();

      const clientResponse = await ProxyResponseHandler.dispatch(session, controlled.response);
      const bodyPromise = clientResponse.text();
      await vi.advanceTimersByTimeAsync(0);
      expect(SessionManager.renewSessionDiscoveryLease).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_100);
      expect(SessionManager.renewSessionDiscoveryLease).toHaveBeenCalledWith(
        "fake-session",
        456,
        "lease-owner",
        2
      );

      controlled.complete();
      await bodyPromise;
      await drainAsyncTasks();

      expect(SessionManager.releaseSessionDiscoveryLease).toHaveBeenCalledOnce();
      expect(SessionManager.releaseSessionDiscoveryLease).toHaveBeenCalledWith(
        "fake-session",
        456,
        "lease-owner"
      );
      expect(order).toEqual(["side-effect", "lease-release"]);

      const renewCalls = vi.mocked(SessionManager.renewSessionDiscoveryLease).mock.calls.length;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(SessionManager.renewSessionDiscoveryLease).toHaveBeenCalledTimes(renewCalls);
    } finally {
      vi.useRealTimers();
    }
  });

  it("touches the captured binding often enough for a long Discovery winner", async () => {
    vi.useFakeTimers();
    try {
      const session = createSession();
      const snapshot = {
        sessionId: "fake-session",
        keyId: 456,
        providerId: null,
        generation: "long-stream-generation",
      } as const;
      setDeferredStreamingFinalization(session, {
        providerId: 1,
        providerName: "test-provider",
        providerPriority: 10,
        attemptNumber: 1,
        totalProvidersAttempted: 2,
        isFirstAttempt: false,
        isFailoverSuccess: true,
        endpointId: 42,
        endpointUrl: "https://api.test.com",
        upstreamStatusCode: 200,
        bindingIntent: "create",
        bindingSnapshot: snapshot,
        requiresCompletionMarker: true,
        discoveryLease: {
          sessionId: "fake-session",
          keyId: 456,
          ownerToken: "long-stream-owner",
          ttlSeconds: 3_600,
        },
      });
      vi.mocked(SessionManager.getVersionedSessionBindingRefreshIntervalMs).mockReturnValue(1_000);
      const controlled = createControllableSuccessStreamResponse();

      const clientResponse = await ProxyResponseHandler.dispatch(session, controlled.response);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(SessionManager.touchVersionedSessionBinding).toHaveBeenCalledTimes(4);
      expect(SessionManager.touchVersionedSessionBinding).toHaveBeenLastCalledWith(snapshot);

      controlled.complete();
      await clientResponse.text();
      await drainAsyncTasks();

      expect(SessionManager.compareAndSetSessionProvider).toHaveBeenCalledWith(snapshot, 1);
      expect(SessionManager.getSessionBindingSnapshot).not.toHaveBeenCalled();
      expect(SessionManager.releaseSessionDiscoveryLease).toHaveBeenCalledWith(
        "fake-session",
        456,
        "long-stream-owner"
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not revive a binding after an authority advances its generation", async () => {
    vi.useFakeTimers();
    try {
      const session = createSession();
      const snapshot = {
        sessionId: "fake-session",
        keyId: 456,
        providerId: 1,
        generation: "generation-before-termination",
      } as const;
      setDeferredStreamingFinalization(session, {
        providerId: 1,
        providerName: "test-provider",
        providerPriority: 10,
        attemptNumber: 1,
        totalProvidersAttempted: 1,
        isFirstAttempt: true,
        isFailoverSuccess: false,
        endpointId: 42,
        endpointUrl: "https://api.test.com",
        upstreamStatusCode: 200,
        bindingIntent: "renew",
        bindingSnapshot: snapshot,
        requiresCompletionMarker: true,
        discoveryLease: {
          sessionId: "fake-session",
          keyId: 456,
          ownerToken: "terminated-stream-owner",
          ttlSeconds: 3_600,
        },
      });
      vi.mocked(SessionManager.getVersionedSessionBindingRefreshIntervalMs).mockReturnValue(1_000);
      vi.mocked(SessionManager.touchVersionedSessionBinding)
        .mockResolvedValueOnce({
          status: "ok",
          source: "touched",
          snapshot,
          legacyFallbackAllowed: false,
        })
        .mockResolvedValueOnce({
          status: "conflict",
          reason: "generation_mismatch",
          legacyFallbackAllowed: false,
        });
      const controlled = createControllableSuccessStreamResponse();

      const clientResponse = await ProxyResponseHandler.dispatch(session, controlled.response);
      await vi.advanceTimersByTimeAsync(1_000);
      controlled.complete();
      await clientResponse.text();
      await drainAsyncTasks();

      expect(SessionManager.touchVersionedSessionBinding).toHaveBeenCalledTimes(2);
      expect(SessionManager.compareAndSetSessionProvider).not.toHaveBeenCalled();
      expect(SessionManager.getSessionBindingSnapshot).not.toHaveBeenCalled();
      expect(SessionManager.releaseSessionDiscoveryLease).toHaveBeenCalledWith(
        "fake-session",
        456,
        "terminated-stream-owner"
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not delay downstream delivery while the lease handoff renewal is pending", async () => {
    const handoffRenewal = Promise.withResolvers<{
      status: "renewed";
      legacyFallbackAllowed: false;
    }>();
    vi.mocked(SessionManager.renewSessionDiscoveryLease).mockReturnValueOnce(
      handoffRenewal.promise
    );
    const session = createSession();
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "test-provider",
      providerPriority: 10,
      attemptNumber: 2,
      totalProvidersAttempted: 2,
      isFirstAttempt: false,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.com",
      upstreamStatusCode: 200,
      bindingIntent: "none",
      requiresCompletionMarker: false,
      discoveryLease: {
        sessionId: "fake-session",
        keyId: 456,
        ownerToken: "pending-handoff-owner",
        ttlSeconds: 30,
      },
    });

    const clientResponse = await ProxyResponseHandler.dispatch(
      session,
      createSuccessStreamResponseWithCompletion()
    );
    await expect(clientResponse.text()).resolves.toContain("message_stop");
    expect(SessionManager.renewSessionDiscoveryLease).toHaveBeenCalledOnce();

    handoffRenewal.resolve({ status: "renewed", legacyFallbackAllowed: false });
    await drainAsyncTasks();
    expect(SessionManager.releaseSessionDiscoveryLease).toHaveBeenCalledOnce();
  });

  it("bounds a stalled lease release and still invokes compare-delete exactly once", async () => {
    vi.useFakeTimers();
    try {
      const session = createSession();
      setDeferredStreamingFinalization(session, {
        providerId: 1,
        providerName: "test-provider",
        providerPriority: 10,
        attemptNumber: 2,
        totalProvidersAttempted: 2,
        isFirstAttempt: false,
        isFailoverSuccess: false,
        endpointId: 42,
        endpointUrl: "https://api.test.com",
        upstreamStatusCode: 200,
        bindingIntent: "none",
        requiresCompletionMarker: false,
        discoveryLease: {
          sessionId: "fake-session",
          keyId: 456,
          ownerToken: "stalled-release-owner",
          ttlSeconds: 30,
        },
      });
      vi.mocked(SessionManager.releaseSessionDiscoveryLease).mockImplementationOnce(
        () => new Promise(() => undefined)
      );

      const clientResponse = await ProxyResponseHandler.dispatch(
        session,
        createSuccessStreamResponseWithCompletion()
      );
      await clientResponse.text();
      const drainPromise = drainAsyncTasks();
      await vi.advanceTimersByTimeAsync(5_000);
      await drainPromise;

      expect(SessionManager.releaseSessionDiscoveryLease).toHaveBeenCalledOnce();
      expect(SessionManager.releaseSessionDiscoveryLease).toHaveBeenCalledWith(
        "fake-session",
        456,
        "stalled-release-owner"
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when the captured Discovery generation has expired", async () => {
    const session = createSession();
    const snapshot = {
      sessionId: "fake-session",
      keyId: 456,
      providerId: null,
      generation: "expired-generation",
    } as const;
    setDeferredStreamingFinalization(session, {
      providerId: 1,
      providerName: "test-provider",
      providerPriority: 10,
      attemptNumber: 1,
      totalProvidersAttempted: 2,
      isFirstAttempt: false,
      isFailoverSuccess: true,
      endpointId: 42,
      endpointUrl: "https://api.test.com",
      upstreamStatusCode: 200,
      bindingIntent: "create",
      bindingSnapshot: snapshot,
      requiresCompletionMarker: true,
      providerSessionRefOwned: true,
    });
    session.recordProviderSessionRef(1);
    vi.mocked(SessionManager.compareAndSetSessionProvider).mockResolvedValueOnce({
      status: "conflict",
      reason: "canonical_missing",
      legacyFallbackAllowed: false,
    });

    const clientResponse = await ProxyResponseHandler.dispatch(
      session,
      createSuccessStreamResponseWithCompletion()
    );
    await clientResponse.text();
    await drainAsyncTasks();

    expect(SessionManager.getSessionBindingSnapshot).not.toHaveBeenCalled();
    expect(SessionManager.compareAndSetSessionProvider).toHaveBeenCalledOnce();
    expect(SessionManager.compareAndSetSessionProvider).toHaveBeenCalledWith(snapshot, 1);
    expect(RateLimitService.releaseProviderSession).toHaveBeenCalledWith(1, "fake-session");
  });

  it("keeps the captured legacy Hedge winner binding alive throughout a long stream", async () => {
    vi.useFakeTimers();
    try {
      const session = createSession();
      const snapshot = {
        sessionId: "fake-session",
        keyId: 456,
        providerId: 1,
        generation: "hedge-long-stream-generation",
      } as const;
      setDeferredMeta(session, 42, {
        isHedgeWinner: true,
        hedgeBindingAuthorityPromise: Promise.resolve({
          snapshot,
          legacyClearAllowed: false,
        }),
      });
      vi.mocked(SessionManager.getVersionedSessionBindingRefreshIntervalMs).mockReturnValue(1_000);
      const controlled = createControllableSuccessStreamResponse();

      const clientResponse = await ProxyResponseHandler.dispatch(session, controlled.response);
      const bodyPromise = clientResponse.text();
      await vi.advanceTimersByTimeAsync(3_000);

      // Immediate ownership validation plus one heartbeat per interval.
      expect(SessionManager.touchVersionedSessionBinding).toHaveBeenCalledTimes(4);
      expect(SessionManager.touchVersionedSessionBinding).toHaveBeenLastCalledWith(snapshot);

      controlled.complete();
      await bodyPromise;
      await drainAsyncTasks();

      // A final touch gives the next turn a complete TTL from stream completion.
      expect(SessionManager.touchVersionedSessionBinding).toHaveBeenCalledTimes(5);
      expect(SessionManager.touchVersionedSessionBinding).toHaveBeenLastCalledWith(snapshot);
      expect(SessionManager.updateSessionBindingSmart).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(3_000);
      expect(SessionManager.touchVersionedSessionBinding).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears a failed Hedge stream only through its captured generation", async () => {
    vi.useFakeTimers();
    try {
      const session = createSession();
      const snapshot = {
        sessionId: "fake-session",
        keyId: 456,
        providerId: 1,
        generation: "failed-hedge-generation",
      } as const;
      setDeferredMeta(session, 42, {
        isHedgeWinner: true,
        hedgeBindingAuthorityPromise: Promise.resolve({
          snapshot,
          legacyClearAllowed: false,
        }),
      });
      vi.mocked(SessionManager.getVersionedSessionBindingRefreshIntervalMs).mockReturnValue(1_000);
      vi.mocked(SessionManager.clearVersionedSessionProvider).mockResolvedValueOnce({
        status: "conflict",
        reason: "generation_mismatch",
        legacyFallbackAllowed: false,
      });

      const clientResponse = await ProxyResponseHandler.dispatch(
        session,
        createFake200StreamResponse()
      );
      await clientResponse.text();
      await drainAsyncTasks();

      expect(SessionManager.clearVersionedSessionProvider).toHaveBeenCalledWith(snapshot, 1);
      expect(SessionManager.clearSessionProvider).not.toHaveBeenCalled();
      const touchesAfterFailure = vi.mocked(SessionManager.touchVersionedSessionBinding).mock.calls
        .length;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(SessionManager.touchVersionedSessionBinding).toHaveBeenCalledTimes(
        touchesAfterFailure
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a failed stale Hedge stream clear a newer same-Provider generation", async () => {
    const session = createSession();
    setDeferredMeta(session, 42, {
      isHedgeWinner: true,
      hedgeBindingAuthorityPromise: Promise.resolve({
        snapshot: null,
        legacyClearAllowed: false,
      }),
    });

    const clientResponse = await ProxyResponseHandler.dispatch(
      session,
      createFake200StreamResponse()
    );
    await clientResponse.text();
    await drainAsyncTasks();

    expect(SessionManager.clearVersionedSessionProvider).not.toHaveBeenCalled();
    expect(SessionManager.clearSessionProvider).not.toHaveBeenCalled();
    expect(SessionManager.touchVersionedSessionBinding).not.toHaveBeenCalled();
  });

  it("uses generic cleanup only after the Hedge winner confirms a legacy binding write", async () => {
    const session = createSession();
    setDeferredMeta(session, 42, {
      isHedgeWinner: true,
      hedgeBindingAuthorityPromise: Promise.resolve({
        snapshot: null,
        legacyClearAllowed: true,
      }),
    });

    const clientResponse = await ProxyResponseHandler.dispatch(
      session,
      createFake200StreamResponse()
    );
    await clientResponse.text();
    await drainAsyncTasks();

    expect(SessionManager.clearVersionedSessionProvider).not.toHaveBeenCalled();
    expect(SessionManager.clearSessionProvider).toHaveBeenCalledWith("fake-session", 1, 456);
    expect(SessionManager.touchVersionedSessionBinding).not.toHaveBeenCalled();
  });

  it("stops Hedge heartbeats after a generation conflict and never revives the binding", async () => {
    vi.useFakeTimers();
    try {
      const session = createSession();
      const snapshot = {
        sessionId: "fake-session",
        keyId: 456,
        providerId: 1,
        generation: "generation-before-termination",
      } as const;
      setDeferredMeta(session, 42, {
        isHedgeWinner: true,
        hedgeBindingAuthorityPromise: Promise.resolve({
          snapshot,
          legacyClearAllowed: false,
        }),
      });
      vi.mocked(SessionManager.getVersionedSessionBindingRefreshIntervalMs).mockReturnValue(1_000);
      vi.mocked(SessionManager.touchVersionedSessionBinding)
        .mockResolvedValueOnce({
          status: "ok",
          source: "touched",
          snapshot,
          legacyFallbackAllowed: false,
        })
        .mockResolvedValueOnce({
          status: "conflict",
          reason: "generation_mismatch",
          legacyFallbackAllowed: false,
        });
      const controlled = createControllableSuccessStreamResponse();

      const clientResponse = await ProxyResponseHandler.dispatch(session, controlled.response);
      const bodyPromise = clientResponse.text();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(SessionManager.touchVersionedSessionBinding).toHaveBeenCalledTimes(2);

      controlled.complete();
      await bodyPromise;
      await drainAsyncTasks();

      expect(SessionManager.touchVersionedSessionBinding).toHaveBeenCalledTimes(2);
      expect(SessionManager.updateSessionBindingSmart).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
