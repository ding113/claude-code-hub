import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import { ProxyResponseHandler } from "@/app/v1/_lib/proxy/response-handler";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
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
  const tasks = testState.asyncTasks.splice(0);
  await Promise.allSettled(tasks);
  await new Promise((resolve) => setTimeout(resolve, 0));
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

function makeSession(clientAbortSignal: AbortSignal, stream: boolean): ProxySession {
  const endpointPolicy = resolveEndpointPolicy("/v1/chat/completions");
  const provider = makeProvider();
  const session = {
    request: {
      model: "gpt-5.4",
      log: "x".repeat(256 * 1024),
      message: {
        model: "gpt-5.4",
        stream,
        messages: [{ role: "user", content: "hello" }],
      },
    },
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("http://localhost/v1/chat/completions"),
    headers: new Headers(),
    headerLog: "",
    userAgent: null,
    context: {},
    clientAbortSignal,
    forwardedRequestBody: "y".repeat(512 * 1024),
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
    originalFormat: "openai",
    providerType: "openai",
    originalModelName: "gpt-5.4",
    originalUrlPathname: "/v1/chat/completions",
    providerChain: [],
    cacheTtlResolved: null,
    context1mApplied: false,
    specialSettings: [],
    cachedPriceData: undefined,
    cachedBillingModelSource: undefined,
    endpointPolicy,
    isHeaderModified: () => false,
    getEndpointPolicy: () => endpointPolicy,
    getContext1mApplied: () => false,
    getGroupCostMultiplier: () => 1,
    getOriginalModel: () => "gpt-5.4",
    getCurrentModel: () => "gpt-5.4",
    getProviderChain: () => [],
    getSpecialSettings: () => [],
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

describe("ProxyResponseHandler client abort listener cleanup", () => {
  beforeEach(() => {
    testState.asyncTasks = [];
    testState.cancelTask.mockClear();
    testState.cleanupTask.mockClear();
    vi.restoreAllMocks();
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
});
