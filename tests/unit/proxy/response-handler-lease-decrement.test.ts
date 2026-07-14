/**
 * TDD: Tests for atomic lease budget settlement in response-handler.ts
 *
 * Tests that settleLeaseBudgets is called once after trackCostToRedis completes.
 * The service expands the explicit key/user/provider entities into all twelve windows.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import type { ModelPriceData } from "@/types/model-price";

// Track async tasks for draining
const asyncTasks: Promise<void>[] = [];
const asyncTaskControllers = new Map<Promise<void>, AbortController>();
let asyncTaskAdmissionOpen = true;

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
      if (!asyncTaskAdmissionOpen) {
        controller.abort();
        return controller;
      }

      let promise: Promise<void>;
      try {
        promise = Promise.resolve(factory(controller.signal));
      } catch (error) {
        promise = Promise.reject(error);
      }
      asyncTasks.push(promise);
      asyncTaskControllers.set(promise, controller);
      return controller;
    },
    touch: vi.fn(() => true),
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
  updateMessageRequestDuration: vi.fn(),
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    updateSessionUsage: vi.fn(async () => undefined),
    storeSessionResponse: vi.fn(),
    storeSessionResponsePhaseSnapshot: vi.fn(async () => undefined),
    extractCodexPromptCacheKey: vi.fn(),
    updateSessionWithCodexCacheKey: vi.fn(),
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  RateLimitService: {
    trackCost: vi.fn(),
    trackUserDailyCost: vi.fn(),
    decrementLeaseBudget: vi.fn(),
    settleLeaseBudgets: vi.fn(),
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
import { AsyncTaskManager } from "@/lib/async-task-manager";
import { SessionManager } from "@/lib/session-manager";
import { RateLimitService } from "@/lib/rate-limit";
import { SessionTracker } from "@/lib/session-tracker";
import {
  updateMessageRequestCost,
  updateMessageRequestDetails,
  updateMessageRequestDetailsDurably,
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
  pathname?: string;
  providerType?: "claude" | "codex";
  originalFormat?: "claude" | "response";
}): ProxySession {
  const {
    originalModel,
    redirectedModel,
    sessionId,
    messageId,
    pathname = "/v1/messages",
    providerType = "claude",
    originalFormat = "claude",
  } = opts;

  const session = Object.create(ProxySession.prototype) as ProxySession;
  Object.assign(session, {
    request: { message: {}, log: "(test)", model: redirectedModel },
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL(`http://localhost${pathname}`),
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
    originalFormat,
    providerType: null,
    originalModelName: null,
    originalUrlPathname: null,
    providerChain: [],
    cacheTtlResolved: null,
    context1mApplied: false,
    specialSettings: [],
    cachedPriceData: undefined,
    cachedBillingModelSource: undefined,
    resolvedPricingCache: new Map(),
    endpointPolicy: resolveEndpointPolicy(pathname),
    isHeaderModified: () => false,
    getContext1mApplied: () => false,
    getGroupCostMultiplier: () => 1,
    getOriginalModel: () => originalModel,
    getCurrentModel: () => redirectedModel,
    getProviderChain: () => [],
    getResolvedPricingByBillingSource: async () => ({
      resolvedModelName: redirectedModel,
      resolvedPricingProviderKey: "test-provider",
      source: "cloud_exact" as const,
      priceData: testPriceData,
    }),
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
    providerType,
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

function createChunkedNonStreamResponse(usage: {
  input_tokens: number;
  output_tokens: number;
}): Response {
  const body = JSON.stringify({
    type: "message",
    usage,
  });
  const encoder = new TextEncoder();
  const chunks = [
    encoder.encode(body.slice(0, 8)),
    encoder.encode(body.slice(8, 24)),
    encoder.encode(body.slice(24)),
  ];
  let index = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
        return;
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
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
  const errors: unknown[] = [];
  const maxDrainRounds = 100;
  let round = 0;

  while (asyncTasks.length > 0) {
    if (round >= maxDrainRounds) {
      asyncTaskAdmissionOpen = false;
      const overflowTasks = asyncTasks.splice(0, asyncTasks.length);
      for (const task of overflowTasks) {
        asyncTaskControllers.get(task)?.abort();
      }
      const overflowResults = await Promise.allSettled(overflowTasks);
      for (let index = 0; index < overflowResults.length; index += 1) {
        asyncTaskControllers.delete(overflowTasks[index]);
        const result = overflowResults[index];
        if (result.status === "rejected") {
          errors.push(result.reason);
        }
      }
      errors.push(new Error(`Async task drain exceeded ${maxDrainRounds} rounds`));
      break;
    }
    round += 1;

    const tasks = asyncTasks.splice(0, asyncTasks.length);
    const results = await Promise.allSettled(tasks);
    for (let index = 0; index < results.length; index += 1) {
      asyncTaskControllers.delete(tasks[index]);
      const result = results[index];
      if (result.status === "rejected") {
        errors.push(result.reason);
      }
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, "Async task drain failed");
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  asyncTaskAdmissionOpen = false;
  for (const controller of asyncTaskControllers.values()) {
    controller.abort();
  }
  asyncTasks.splice(0, asyncTasks.length);
  asyncTaskControllers.clear();
  asyncTaskAdmissionOpen = true;
});

describe("drainAsyncTasks", () => {
  it("waits for a tail task registered while draining the primary task", async () => {
    let markTailStarted: () => void = () => {};
    let releaseTail: () => void = () => {};
    const tailStarted = new Promise<void>((resolve) => {
      markTailStarted = resolve;
    });
    const tailCompleted = vi.fn();

    AsyncTaskManager.register("primary", async () => {
      await Promise.resolve();
      AsyncTaskManager.register("tail", async () => {
        markTailStarted();
        await new Promise<void>((resolve) => {
          releaseTail = resolve;
        });
        tailCompleted();
      });
    });

    const drainPromise = drainAsyncTasks();
    await tailStarted;

    try {
      const outcome = await Promise.race([
        drainPromise.then(() => "drained" as const),
        new Promise<"pending">((resolve) => {
          setTimeout(() => resolve("pending"), 0);
        }),
      ]);

      expect(outcome).toBe("pending");
    } finally {
      releaseTail();
    }

    await drainPromise;
    expect(tailCompleted).toHaveBeenCalledTimes(1);
  });

  it("waits for sibling tail work before reporting tail rejections", async () => {
    const tailError = new Error("tail task failed");
    let markPendingTailStarted: () => void = () => {};
    let releasePendingTail: () => void = () => {};
    const pendingTailStarted = new Promise<void>((resolve) => {
      markPendingTailStarted = resolve;
    });

    AsyncTaskManager.register("primary", async () => {
      await Promise.resolve();
      AsyncTaskManager.register("rejecting-tail", async () => {
        throw tailError;
      });
      void asyncTasks.at(-1)?.catch(() => {});
      AsyncTaskManager.register("pending-tail", async () => {
        markPendingTailStarted();
        await new Promise<void>((resolve) => {
          releasePendingTail = resolve;
        });
      });
    });

    const drainPromise = drainAsyncTasks();
    await pendingTailStarted;

    try {
      const earlyOutcome = await Promise.race([
        drainPromise.then(
          () => "resolved" as const,
          () => "rejected" as const
        ),
        new Promise<"pending">((resolve) => {
          setTimeout(() => resolve("pending"), 0);
        }),
      ]);

      expect(earlyOutcome).toBe("pending");
    } finally {
      releasePendingTail();
    }

    const rejection = await drainPromise.then(
      () => undefined,
      (error: unknown) => error
    );
    expect(rejection).toBeInstanceOf(AggregateError);
    expect((rejection as AggregateError).errors).toEqual([tailError]);
  });

  it("closes admission and observes overflow work when the drain guard trips", async () => {
    const overflowError = new Error("overflow task aborted");
    const blockedTailStarted = vi.fn();
    let overflowController: AbortController | undefined;

    const registerGeneration = (generation: number): void => {
      const controller = AsyncTaskManager.register(`generation-${generation}`, async (signal) => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });

        if (generation <= 100) {
          registerGeneration(generation + 1);
          return;
        }

        await new Promise<void>((_resolve, reject) => {
          const rejectOnAbort = () => {
            AsyncTaskManager.register("blocked-overflow-tail", async () => {
              blockedTailStarted();
            });
            reject(overflowError);
          };

          if (signal.aborted) {
            rejectOnAbort();
            return;
          }
          signal.addEventListener("abort", rejectOnAbort, { once: true });
        });
      });

      if (generation === 101) {
        overflowController = controller;
      }
    };

    registerGeneration(1);
    const rejection = await drainAsyncTasks().then(
      () => undefined,
      (error: unknown) => error
    );

    try {
      expect(rejection).toBeInstanceOf(AggregateError);
      expect((rejection as AggregateError).errors).toContain(overflowError);
      expect((rejection as AggregateError).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: "Async task drain exceeded 100 rounds" }),
        ])
      );
      expect(blockedTailStarted).not.toHaveBeenCalled();
      expect(asyncTasks).toHaveLength(0);
    } finally {
      overflowController?.abort();
      await Promise.allSettled(asyncTasks.splice(0, asyncTasks.length));
    }
  });
});

describe("Lease Budget Decrement after trackCostToRedis", () => {
  const originalModel = "claude-sonnet-4-20250514";
  const usage = { input_tokens: 1000, output_tokens: 500 };

  beforeEach(async () => {
    vi.mocked(getSystemSettings).mockResolvedValue(makeSystemSettings("original"));
    vi.mocked(findLatestPriceByModel).mockResolvedValue(
      makePriceRecord(originalModel, testPriceData)
    );
    vi.mocked(updateMessageRequestDetailsDurably).mockResolvedValue(undefined);
    vi.mocked(updateMessageRequestDuration).mockResolvedValue(undefined);
    vi.mocked(SessionManager.storeSessionResponse).mockResolvedValue(undefined);
    vi.mocked(SessionManager.storeSessionResponsePhaseSnapshot).mockResolvedValue(undefined);
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
    vi.mocked(SessionTracker.refreshSession).mockResolvedValue(undefined);
  });

  it("should settle all windows and entity types in one call (non-stream)", async () => {
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

    expect(RateLimitService.settleLeaseBudgets).toHaveBeenCalledTimes(1);
    expect(RateLimitService.settleLeaseBudgets).toHaveBeenCalledWith({
      requestId: 5001,
      cost: expectedCost,
      entities: {
        key: { id: 456, resetModes: { "5h": undefined, daily: "fixed" } },
        user: { id: 123, resetModes: { "5h": undefined, daily: "fixed" } },
        provider: { id: 99, resetModes: { "5h": undefined, daily: "fixed" } },
      },
    });
    expect(RateLimitService.decrementLeaseBudget).not.toHaveBeenCalled();
  });

  it("should refresh task activity while reading chunked non-stream response bodies", async () => {
    const messageId = 5010;
    const session = createSession({
      originalModel,
      redirectedModel: originalModel,
      sessionId: "sess-non-stream-chunked-touch",
      messageId,
    });

    const response = createChunkedNonStreamResponse(usage);
    const cloneSpy = vi.spyOn(response, "clone");

    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    const taskId = `non-stream-${messageId}`;
    const touchCalls = vi
      .mocked(AsyncTaskManager.touch)
      .mock.calls.filter(([calledTaskId]) => calledTaskId === taskId);
    expect(touchCalls.length).toBeGreaterThanOrEqual(2);
    expect(cloneSpy).toHaveBeenCalledTimes(1);
    expect(SessionManager.storeSessionResponsePhaseSnapshot).toHaveBeenCalledWith(
      session.sessionId,
      "after",
      expect.objectContaining({
        body: expect.stringContaining('"type":"message"'),
        meta: expect.objectContaining({ statusCode: 200 }),
      }),
      session.requestSequence
    );
    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      messageId,
      expect.objectContaining({
        statusCode: 200,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
      })
    );
  });

  it("should settle all windows and entity types in one call (stream)", async () => {
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

    expect(RateLimitService.settleLeaseBudgets).toHaveBeenCalledTimes(1);
    expect(RateLimitService.decrementLeaseBudget).not.toHaveBeenCalled();
  });

  it("should NOT settle lease budgets when cost is zero", async () => {
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

    // Override getResolvedPricingByBillingSource to return zero prices
    (
      session as {
        getResolvedPricingByBillingSource: () => Promise<{
          resolvedModelName: string;
          resolvedPricingProviderKey: string;
          source: string;
          priceData: ModelPriceData;
        }>;
      }
    ).getResolvedPricingByBillingSource = async () => ({
      resolvedModelName: originalModel,
      resolvedPricingProviderKey: "test-provider",
      source: "cloud_exact" as const,
      priceData: zeroPriceData,
    });

    const response = createNonStreamResponse(usage);
    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    // Zero cost should NOT trigger settlement.
    expect(RateLimitService.settleLeaseBudgets).not.toHaveBeenCalled();
    expect(RateLimitService.decrementLeaseBudget).not.toHaveBeenCalled();
  });

  it("should skip redis cost tracking and lease decrement for non-billing compact endpoint variants", async () => {
    const session = createSession({
      originalModel,
      redirectedModel: originalModel,
      sessionId: "sess-non-billing-compact",
      messageId: 5999,
      pathname: "/v1/responses/compact/",
      providerType: "codex",
      originalFormat: "response",
    });

    const response = createNonStreamResponse(usage);
    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    expect(RateLimitService.trackCost).not.toHaveBeenCalled();
    expect(RateLimitService.trackUserDailyCost).not.toHaveBeenCalled();
    expect(RateLimitService.settleLeaseBudgets).not.toHaveBeenCalled();
    expect(RateLimitService.decrementLeaseBudget).not.toHaveBeenCalled();
    expect(updateMessageRequestDetailsDurably).toHaveBeenCalledWith(
      5999,
      expect.objectContaining({
        statusCode: 200,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
      })
    );
  });

  it("should call settleLeaseBudgets exactly once per request", async () => {
    const session = createSession({
      originalModel,
      redirectedModel: originalModel,
      sessionId: "sess-lease-test-4",
      messageId: 5004,
    });

    const response = createNonStreamResponse(usage);
    await ProxyResponseHandler.dispatch(session, response);
    await drainAsyncTasks();

    expect(RateLimitService.settleLeaseBudgets).toHaveBeenCalledTimes(1);
    expect(RateLimitService.settleLeaseBudgets).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 5004 })
    );
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

    expect(RateLimitService.settleLeaseBudgets).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 5005,
        entities: expect.objectContaining({
          key: expect.objectContaining({ id: customKeyId }),
          user: expect.objectContaining({ id: customUserId }),
          provider: expect.objectContaining({ id: customProviderId }),
        }),
      })
    );
  });

  it("should preserve fail-open completion when atomic settlement unexpectedly rejects", async () => {
    vi.mocked(RateLimitService.settleLeaseBudgets).mockRejectedValue(
      new Error("Redis connection failed")
    );

    const session = createSession({
      originalModel,
      redirectedModel: originalModel,
      sessionId: "sess-lease-test-6",
      messageId: 5006,
    });

    const response = createNonStreamResponse(usage);

    // Should NOT throw even if the settlement wrapper fails unexpectedly.
    await expect(ProxyResponseHandler.dispatch(session, response)).resolves.toBeDefined();
    await drainAsyncTasks();

    expect(RateLimitService.settleLeaseBudgets).toHaveBeenCalledTimes(1);
  });
});
