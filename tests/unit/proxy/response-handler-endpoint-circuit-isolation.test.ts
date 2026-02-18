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
    register: (_taskId: string, promise: Promise<void>) => {
      asyncTasks.push(promise);
      return new AbortController();
    },
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
  updateMessageRequestDetails: vi.fn(),
  updateMessageRequestDuration: vi.fn(),
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    updateSessionUsage: vi.fn(),
    storeSessionResponse: vi.fn(),
    extractCodexPromptCacheKey: vi.fn(),
    updateSessionWithCodexCacheKey: vi.fn(),
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  RateLimitService: {
    trackCost: vi.fn(),
    trackUserDailyCost: vi.fn(),
    decrementLeaseBudget: vi.fn(),
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
const { mockRecordFailure, mockRecordEndpointFailure, mockRecordEndpointSuccess } = vi.hoisted(
  () => ({
    mockRecordFailure: vi.fn(),
    mockRecordEndpointFailure: vi.fn(),
    mockRecordEndpointSuccess: vi.fn(),
  })
);

vi.mock("@/lib/circuit-breaker", () => ({
  recordFailure: mockRecordFailure,
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
import { updateMessageRequestDetails, updateMessageRequestDuration } from "@/repository/message";
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
    sessionId: opts?.sessionId ?? null,
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

function setDeferredMeta(session: ProxySession, endpointId: number | null = 42) {
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

async function drainAsyncTasks(): Promise<void> {
  const tasks = asyncTasks.splice(0, asyncTasks.length);
  await Promise.all(tasks);
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
  vi.mocked(updateMessageRequestDuration).mockResolvedValue(undefined);
  vi.mocked(SessionManager.storeSessionResponse).mockResolvedValue(undefined);
  vi.mocked(RateLimitService.trackCost).mockResolvedValue(undefined);
  vi.mocked(RateLimitService.trackUserDailyCost).mockResolvedValue(undefined);
  vi.mocked(RateLimitService.decrementLeaseBudget).mockResolvedValue({
    success: true,
    newRemaining: 10,
  });
  vi.mocked(SessionTracker.refreshSession).mockResolvedValue(undefined);
  mockRecordFailure.mockResolvedValue(undefined);
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
    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    expect(mockRecordFailure).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ message: expect.stringContaining("FAKE_200") })
    );
    expect(mockRecordEndpointFailure).not.toHaveBeenCalled();

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

  it("fake-200 inferred 404 should NOT call recordFailure and should be marked as resource_not_found", async () => {
    const session = createSession();
    setDeferredMeta(session, 42);

    const response = createFake200StreamResponse("model not found");
    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    expect(mockRecordFailure).not.toHaveBeenCalled();
    expect(mockRecordEndpointFailure).not.toHaveBeenCalled();

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
    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    expect(mockRecordFailure).toHaveBeenCalledWith(1, expect.any(Error));
    expect(mockRecordEndpointFailure).not.toHaveBeenCalled();
  });

  it("streaming success DOES call recordEndpointSuccess (regression guard)", async () => {
    const session = createSession();
    setDeferredMeta(session, 42);

    const response = createSuccessStreamResponse();
    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    expect(mockRecordEndpointSuccess).toHaveBeenCalledWith(42);
    expect(mockRecordEndpointFailure).not.toHaveBeenCalled();
  });

  it("streaming success without endpointId should NOT call any endpoint circuit breaker function", async () => {
    const session = createSession();
    setDeferredMeta(session, null);

    const response = createSuccessStreamResponse();
    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    expect(mockRecordEndpointSuccess).not.toHaveBeenCalled();
    expect(mockRecordEndpointFailure).not.toHaveBeenCalled();
  });
});
