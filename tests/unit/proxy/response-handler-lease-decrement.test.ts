/**
 * TDD: RED Phase - Tests for lease budget decrement in response-handler.ts
 *
 * Tests that decrementLeaseBudget is called correctly after trackCostToRedis completes.
 * - All windows: 5h, daily, weekly, monthly
 * - All entity types: key, user, provider
 * - Zero-cost requests should NOT trigger decrement
 * - Function runs once per request (no duplicates)
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

import { ProxyResponseHandler } from "@/app/v1/_lib/proxy/response-handler";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import { SessionManager } from "@/lib/session-manager";
import { RateLimitService } from "@/lib/rate-limit";
import { SessionTracker } from "@/lib/session-tracker";
import {
  updateMessageRequestCost,
  updateMessageRequestDetails,
  updateMessageRequestDuration,
} from "@/repository/message";
import { findLatestPriceByModel } from "@/repository/model-price";
import { getSystemSettings } from "@/repository/system-config";

// Test price data
const testPriceData: ModelPriceData = {
  input_cost_per_token: 0.000003,
  output_cost_per_token: 0.000015,
};

function makePriceRecord(modelName: string, priceData: ModelPriceData) {
  return {
    id: 1,
    modelName,
    priceData,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeSystemSettings(billingModelSource: "original" | "redirected" = "original") {
  return {
    billingModelSource,
    streamBufferEnabled: false,
    streamBufferMode: "none",
    streamBufferSize: 0,
  } as ReturnType<typeof getSystemSettings> extends Promise<infer T> ? T : never;
}

function createSession(opts: {
  originalModel: string;
  redirectedModel: string;
  sessionId: string;
  messageId: number;
}): ProxySession {
  const { originalModel, redirectedModel, sessionId, messageId } = opts;

  const session = Object.create(ProxySession.prototype) as ProxySession;
  Object.assign(session, {
    request: { message: {}, log: "(test)", model: redirectedModel },
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("http://localhost/v1/messages"),
    headers: new Headers(),
    headerLog: "",
    userAgent: null,
    context: {},
    clientAbortSignal: null,
    userName: "test-user",
    authState: null,
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
    endpointPolicy: resolveEndpointPolicy("/v1/messages"),
    isHeaderModified: () => false,
    getContext1mApplied: () => false,
    getOriginalModel: () => originalModel,
    getCurrentModel: () => redirectedModel,
    getProviderChain: () => [],
    getCachedPriceDataByBillingSource: async () => testPriceData,
    recordTtfb: () => 100,
    ttfbMs: null,
    getRequestSequence: () => 1,
  });

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

  session.setOriginalModel(originalModel);
  session.setSessionId(sessionId);

  const provider = {
    id: 99,
    name: "test-provider",
    providerType: "claude",
    costMultiplier: 1.0,
    streamingIdleTimeoutMs: 0,
    dailyResetTime: "00:00",
    dailyResetMode: "fixed",
  } as unknown;

  const user = {
    id: 123,
    name: "test-user",
    dailyResetTime: "00:00",
    dailyResetMode: "fixed",
  } as unknown;

  const key = {
    id: 456,
    name: "test-key",
    dailyResetTime: "00:00",
    dailyResetMode: "fixed",
  } as unknown;

  session.setProvider(provider);
  session.setAuthState({
    user,
    key,
    apiKey: "sk-test",
    success: true,
  });
  session.setMessageContext({
    id: messageId,
    createdAt: new Date(),
    user,
    key,
    apiKey: "sk-test",
  });

  return session;
}

function createNonStreamResponse(usage: { input_tokens: number; output_tokens: number }): Response {
  return new Response(
    JSON.stringify({
      type: "message",
      usage,
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}

function createStreamResponse(usage: { input_tokens: number; output_tokens: number }): Response {
  const sseText = `event: message_delta\ndata: ${JSON.stringify({ usage })}\n\n`;
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

beforeEach(() => {
  vi.clearAllMocks();
  asyncTasks.splice(0, asyncTasks.length);
});

describe("Lease Budget Decrement after trackCostToRedis", () => {
  const originalModel = "claude-sonnet-4-20250514";
  const usage = { input_tokens: 1000, output_tokens: 500 };

  beforeEach(async () => {
    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings("original"));
    vi.mocked(findLatestPriceByModel).mockResolvedValue(
      makePriceRecord(originalModel, testPriceData)
    );
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
  });

  it("should call decrementLeaseBudget for all windows and entity types (non-stream)", async () => {
    const session = createSession({
      originalModel,
      redirectedModel: originalModel,
      sessionId: "sess-lease-test-1",
      messageId: 5001,
    });

    const response = createNonStreamResponse(usage);
    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    // Expected cost: (1000 * 0.000003) + (500 * 0.000015) = 0.003 + 0.0075 = 0.0105
    const expectedCost = 0.0105;

    // Should be called 12 times:
    // 4 windows x 3 entity types = 12 calls
    // Windows: 5h, daily, weekly, monthly
    // Entity types: key(456), user(123), provider(99)
    expect(RateLimitService.decrementLeaseBudget).toHaveBeenCalled();

    const calls = vi.mocked(RateLimitService.decrementLeaseBudget).mock.calls;
    expect(calls.length).toBe(12);

    // Verify all windows are covered for each entity type
    const windows = ["5h", "daily", "weekly", "monthly"];
    const entities = [
      { id: 456, type: "key" },
      { id: 123, type: "user" },
      { id: 99, type: "provider" },
    ];

    for (const entity of entities) {
      for (const window of windows) {
        const matchingCall = calls.find(
          (call) => call[0] === entity.id && call[1] === entity.type && call[2] === window
        );
        expect(matchingCall).toBeDefined();
        // Cost should be approximately 0.0105
        expect(matchingCall![3]).toBeCloseTo(expectedCost, 4);
      }
    }
  });

  it("should call decrementLeaseBudget for all windows and entity types (stream)", async () => {
    const session = createSession({
      originalModel,
      redirectedModel: originalModel,
      sessionId: "sess-lease-test-2",
      messageId: 5002,
    });

    const response = createStreamResponse(usage);
    const clientResponse = await ProxyResponseHandler.dispatch(session, response);
    await clientResponse.text();
    await drainAsyncTasks();

    expect(RateLimitService.decrementLeaseBudget).toHaveBeenCalled();
    const calls = vi.mocked(RateLimitService.decrementLeaseBudget).mock.calls;

    // Should have exactly 12 calls (4 windows x 3 entity types)
    expect(calls.length).toBe(12);
  });

  it("should NOT call decrementLeaseBudget when cost is zero", async () => {
    // Mock price data that results in zero cost
    const zeroPriceData: ModelPriceData = {
      input_cost_per_token: 0,
      output_cost_per_token: 0,
    };
    vi.mocked(findLatestPriceByModel).mockResolvedValue(
      makePriceRecord(originalModel, zeroPriceData)
    );

    const session = createSession({
      originalModel,
      redirectedModel: originalModel,
      sessionId: "sess-lease-test-3",
      messageId: 5003,
    });

    // Override getCachedPriceDataByBillingSource to return zero prices
    (
      session as { getCachedPriceDataByBillingSource: () => Promise<ModelPriceData> }
    ).getCachedPriceDataByBillingSource = async () => zeroPriceData;

    const response = createNonStreamResponse(usage);
    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    // Zero cost should NOT trigger decrement
    expect(RateLimitService.decrementLeaseBudget).not.toHaveBeenCalled();
  });

  it("should call decrementLeaseBudget exactly once per request (no duplicates)", async () => {
    const session = createSession({
      originalModel,
      redirectedModel: originalModel,
      sessionId: "sess-lease-test-4",
      messageId: 5004,
    });

    const response = createNonStreamResponse(usage);
    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    // Each window/entity combo should be called exactly once
    const calls = vi.mocked(RateLimitService.decrementLeaseBudget).mock.calls;

    // Create a unique key for each call to check for duplicates
    const callKeys = calls.map((call) => `${call[0]}-${call[1]}-${call[2]}`);
    const uniqueKeys = new Set(callKeys);

    // No duplicates: unique keys should equal total calls
    expect(uniqueKeys.size).toBe(calls.length);
    expect(calls.length).toBe(12); // 4 windows x 3 entities
  });

  it("should use correct entity IDs from session", async () => {
    const customKeyId = 789;
    const customUserId = 321;
    const customProviderId = 111;

    const session = createSession({
      originalModel,
      redirectedModel: originalModel,
      sessionId: "sess-lease-test-5",
      messageId: 5005,
    });

    // Override with custom IDs
    session.setProvider({
      id: customProviderId,
      name: "custom-provider",
      providerType: "claude",
      costMultiplier: 1.0,
      dailyResetTime: "00:00",
      dailyResetMode: "fixed",
    } as unknown);

    session.setAuthState({
      user: {
        id: customUserId,
        name: "custom-user",
        dailyResetTime: "00:00",
        dailyResetMode: "fixed",
      },
      key: {
        id: customKeyId,
        name: "custom-key",
        dailyResetTime: "00:00",
        dailyResetMode: "fixed",
      },
      apiKey: "sk-custom",
      success: true,
    });

    session.setMessageContext({
      id: 5005,
      createdAt: new Date(),
      user: {
        id: customUserId,
        name: "custom-user",
        dailyResetTime: "00:00",
        dailyResetMode: "fixed",
      },
      key: {
        id: customKeyId,
        name: "custom-key",
        dailyResetTime: "00:00",
        dailyResetMode: "fixed",
      },
      apiKey: "sk-custom",
    });

    const response = createNonStreamResponse(usage);
    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    const calls = vi.mocked(RateLimitService.decrementLeaseBudget).mock.calls;

    // Verify key ID
    const keyCalls = calls.filter((c) => c[1] === "key");
    expect(keyCalls.every((c) => c[0] === customKeyId)).toBe(true);
    expect(keyCalls.length).toBe(4);

    // Verify user ID
    const userCalls = calls.filter((c) => c[1] === "user");
    expect(userCalls.every((c) => c[0] === customUserId)).toBe(true);
    expect(userCalls.length).toBe(4);

    // Verify provider ID
    const providerCalls = calls.filter((c) => c[1] === "provider");
    expect(providerCalls.every((c) => c[0] === customProviderId)).toBe(true);
    expect(providerCalls.length).toBe(4);
  });

  it("should use fire-and-forget pattern (not block on decrement failures)", async () => {
    // Mock decrementLeaseBudget to fail
    vi.mocked(RateLimitService.decrementLeaseBudget).mockRejectedValue(
      new Error("Redis connection failed")
    );

    const session = createSession({
      originalModel,
      redirectedModel: originalModel,
      sessionId: "sess-lease-test-6",
      messageId: 5006,
    });

    const response = createNonStreamResponse(usage);

    // Should NOT throw even if decrementLeaseBudget fails
    await expect(ProxyResponseHandler.dispatch(session, response)).resolves.toBeDefined();
    await drainAsyncTasks();

    // Verify decrement was attempted
    expect(RateLimitService.decrementLeaseBudget).toHaveBeenCalled();
  });
});
