// Real loopback transport exercises production lifecycle code; persistence/control-plane seams are mocked.
import { createServer, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Context } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ProxyResponseHandler } from "@/app/v1/_lib/proxy/response-handler";
import { type MessageContext, ProxySession } from "@/app/v1/_lib/proxy/session";
import { DbPoolAdmissionError } from "@/drizzle/admitted-client";
import { getGlobalAgentPool, resetGlobalAgentPool } from "@/lib/proxy-agent";
import type { SessionBindingSnapshot } from "@/lib/redis/session-binding";
import type { Key } from "@/types/key";
import type { Provider } from "@/types/provider";
import type { User } from "@/types/user";

const state = vi.hoisted(() => {
  return {
    addLoserCost: vi.fn(),
    billHedgeLosers: false,
    discoveryEnabled: false,
    acquireDiscoveryLease: vi.fn(async () => ({
      status: "acquired",
      ownerToken: "integration-lease",
      legacyFallbackAllowed: false,
    })),
    releaseDiscoveryLease: vi.fn(async () => ({
      status: "released",
      legacyFallbackAllowed: false,
    })),
    renewDiscoveryLease: vi.fn(async () => ({
      status: "renewed",
      legacyFallbackAllowed: false,
    })),
    compareAndSetBinding: vi.fn(async () => ({
      status: "ok",
      source: "updated",
      legacyFallbackAllowed: false,
      snapshot: {
        sessionId: "integration-discovery",
        keyId: 22,
        providerId: 2,
        generation: "g2",
      },
    })),
    durableTerminal: vi.fn(
      async (
        _id: number,
        details: unknown,
        options?: { onCommitted?: (details: unknown) => void | Promise<void> }
      ) => {
        await options?.onCommitted?.(details);
        return true;
      }
    ),
    http2Error: ((): Error | null => null)(),
    loserBilled: Promise.withResolvers<void>(),
    pickAlternative: vi.fn(),
    pickDiscovery: vi.fn(),
    providers: Array.from<Provider>([]),
    recordFailure: vi.fn(async () => {}),
    settleLeaseBudgets: vi.fn(async () => {}),
    tasks: Array.from<Promise<void>>([]),
    trackCost: vi.fn(async () => {}),
    updateMessageRequestCostWithBreakdown: vi.fn(async () => {}),
    updateMessageRequestDetailsIfUnfinalized: vi.fn(async () => {}),
    updateWinnerCost: vi.fn(async () => {}),
  };
});

vi.mock("@/lib/logger", () => ({
  logger: Object.fromEntries(
    ["debug", "error", "fatal", "info", "trace", "warn"].map((level) => [level, vi.fn()])
  ),
}));
vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    getCachedSystemSettings: async () => ({
      billHedgeLosers: state.billHedgeLosers,
      discoveryConcurrency: 2,
      discoveryEnabled: state.discoveryEnabled,
      discoverySlaMs: 100,
      enableBillingHeaderRectifier: false,
      enableClaudeMetadataUserIdInjection: false,
      enableThinkingBudgetRectifier: false,
      enableThinkingSignatureRectifier: false,
      maxDiscoveryRounds: 1,
      racingTotalTimeoutMs: 500,
      stickySlaMs: 100,
      stickyTimeoutCooldownMs: 300_000,
    }),
    isHttp2Enabled: async () => {
      if (state.http2Error) throw state.http2Error;
      return true;
    },
  };
});
vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: async () => ({ billNonSuccessfulRequests: false }),
}));
vi.mock("@/app/v1/_lib/proxy/provider-selector", () => ({
  ProxyProviderResolver: {
    pickDiscoveryProviders: state.pickDiscovery,
    pickRandomProviderWithExclusion: state.pickAlternative,
    resolveEffectivePriorityForSession: (provider: Provider) => provider.priority ?? 0,
  },
}));
vi.mock("@/lib/session-manager", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session-manager")>();
  class TestSessionManager extends actual.SessionManager {
    static override async ensureVersionedBindingCapability() {
      return "available" as const;
    }
    static override async getSessionBindingSnapshot(sessionId: string, keyId: number) {
      return {
        status: "ok" as const,
        source: "existing" as const,
        legacyFallbackAllowed: false as const,
        snapshot: { sessionId, keyId, providerId: null, generation: "g1" },
      };
    }
    static override async acquireSessionDiscoveryLease() {
      return state.acquireDiscoveryLease();
    }
    static override async renewSessionDiscoveryLease() {
      return state.renewDiscoveryLease();
    }
    static override getVersionedSessionBindingRefreshIntervalMs() {
      return 100_000;
    }
    static override async touchVersionedSessionBinding(snapshot: SessionBindingSnapshot) {
      return {
        status: "ok" as const,
        source: "touched" as const,
        snapshot,
        legacyFallbackAllowed: false as const,
      };
    }
    static override async releaseSessionDiscoveryLease() {
      return state.releaseDiscoveryLease();
    }
    static override async compareAndSetSessionProvider() {
      return state.compareAndSetBinding();
    }
  }
  return { ...actual, SessionManager: TestSessionManager };
});
vi.mock("@/lib/provider-endpoints/endpoint-selector", () => ({
  getEndpointFilterStats: vi.fn(async () => null),
  getPreferredProviderEndpoints: vi.fn(async () => []),
}));
vi.mock("@/lib/circuit-breaker", () => ({
  getCircuitState: vi.fn(() => "closed"),
  getProviderHealthInfo: vi.fn(async () => ({
    config: { failureThreshold: 3 },
    health: { failureCount: 0 },
  })),
  recordFailure: state.recordFailure,
  recordSuccess: vi.fn(),
}));
vi.mock("@/lib/endpoint-circuit-breaker", () => ({
  recordEndpointFailure: vi.fn(),
  recordEndpointSuccess: vi.fn(),
  resetEndpointCircuit: vi.fn(),
}));
vi.mock("@/lib/vendor-type-circuit-breaker", () => ({
  isVendorTypeCircuitOpen: vi.fn(async () => false),
  recordVendorTypeAllEndpointsTimeout: vi.fn(),
}));
vi.mock("@/lib/rate-limit/service", () => ({
  RateLimitService: {
    checkAndTrackProviderSession: vi.fn(async () => ({ allowed: true })),
    releaseProviderSession: vi.fn(),
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  RateLimitService: {
    settleLeaseBudgets: state.settleLeaseBudgets,
    trackCost: state.trackCost,
    trackUserDailyCost: vi.fn(async () => {}),
  },
}));
vi.mock("@/lib/request-filter-engine", () => ({
  requestFilterEngine: { applyFinal: vi.fn(async () => {}) },
}));
vi.mock("@/app/v1/_lib/proxy/response-fixer", () => ({
  ResponseFixer: { process: async (_session: ProxySession, response: Response) => response },
}));
vi.mock("@/lib/async-task-manager", () => ({
  AsyncTaskManager: {
    cancel: vi.fn(),
    cleanup: vi.fn(),
    register: (
      _taskId: string,
      factory: (signal: AbortSignal) => Promise<void>,
      options?: string | { readonly abortController?: AbortController }
    ) => {
      const controller =
        typeof options === "object" && options.abortController
          ? options.abortController
          : new AbortController();
      const task = Promise.resolve().then(() => factory(controller.signal));
      void task.catch(() => undefined);
      state.tasks.push(task);
      return controller;
    },
    touch: vi.fn(() => true),
  },
}));
vi.mock("@/repository/message", () => ({
  addMessageRequestHedgeLoserCost: state.addLoserCost,
  updateMessageRequestCostWithBreakdown: state.updateMessageRequestCostWithBreakdown,
  updateMessageRequestDetails: vi.fn(async () => {}),
  updateMessageRequestDetailsDurably: state.durableTerminal,
  updateMessageRequestDetailsIfUnfinalized: state.updateMessageRequestDetailsIfUnfinalized,
  updateMessageRequestDuration: vi.fn(async () => {}),
  updateMessageRequestWinnerCost: state.updateWinnerCost,
}));
vi.mock("@/repository/model-price", () => ({
  findLatestPriceByModel: vi.fn(async (modelName: string) => ({
    createdAt: new Date(0),
    id: 1,
    modelName,
    priceData: { input_cost_per_token: 0.001, output_cost_per_token: 0.002 },
    source: "litellm",
    updatedAt: new Date(0),
  })),
}));
vi.mock("@/repository/system-config", () => ({
  getSystemSettings: vi.fn(async () => ({
    billingModelSource: "redirected",
    codexPriorityBillingSource: "requested",
  })),
}));
vi.mock("@/lib/price-sync/cloud-price-updater", () => ({ requestCloudPriceTableSync: vi.fn() }));
vi.mock("@/lib/langfuse/emit-proxy-trace", () => ({ emitProxyLangfuseTrace: vi.fn() }));
vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: { refreshSession: vi.fn(async () => {}) },
}));
vi.mock("@/lib/proxy-status-tracker", () => ({
  ProxyStatusTracker: { getInstance: () => ({ endRequest: vi.fn() }) },
}));
vi.mock("@/lib/redis/live-chain-store", () => ({
  deleteLiveChain: vi.fn(async () => {}),
  writeLiveChain: vi.fn(async () => {}),
}));

const CREATED_AT = new Date(0);
const USER = {
  createdAt: CREATED_AT,
  dailyQuota: null,
  dailyResetMode: "fixed",
  dailyResetTime: "00:00",
  description: "hedge lifecycle user",
  id: 21,
  isEnabled: true,
  limit5hResetMode: "fixed",
  name: "hedge-user",
  providerGroup: null,
  role: "user",
  rpm: null,
  updatedAt: CREATED_AT,
} satisfies User;
const KEY = {
  cacheTtlPreference: null,
  canLoginWebUi: false,
  createdAt: CREATED_AT,
  dailyResetMode: "fixed",
  dailyResetTime: "00:00",
  id: 22,
  isEnabled: true,
  key: "sk-hedge-lifecycle",
  limit5hResetMode: "fixed",
  limit5hUsd: null,
  limitConcurrentSessions: 0,
  limitDailyUsd: null,
  limitMonthlyUsd: null,
  limitWeeklyUsd: null,
  name: "hedge-key",
  providerGroup: null,
  updatedAt: CREATED_AT,
  userId: USER.id,
} satisfies Key;
const MESSAGE = {
  apiKey: KEY.key,
  createdAt: CREATED_AT,
  id: 51,
  key: KEY,
  user: USER,
} satisfies MessageContext;

function createProvider(id: number, url: string, firstByteTimeoutStreamingMs: number): Provider {
  return {
    activeTimeEnd: null,
    activeTimeStart: null,
    allowedClients: [],
    allowedModels: null,
    anthropicAdaptiveThinking: null,
    anthropicMaxTokensPreference: null,
    anthropicThinkingBudgetPreference: null,
    blockedClients: [],
    cacheTtlPreference: null,
    cc: 0,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    circuitBreakerOpenDuration: 1_800_000,
    codexImageGenerationPreference: null,
    codexParallelToolCallsPreference: null,
    codexReasoningEffortPreference: null,
    codexReasoningSummaryPreference: null,
    codexServiceTierPreference: null,
    codexTextVerbosityPreference: null,
    context1mPreference: null,
    costMultiplier: 1,
    createdAt: CREATED_AT,
    customHeaders: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    disableSessionReuse: false,
    faviconUrl: null,
    firstByteTimeoutStreamingMs,
    geminiGoogleSearchPreference: null,
    groupPriorities: null,
    groupTag: null,
    id,
    isEnabled: true,
    key: `provider-key-${id}`,
    limit5hResetMode: "fixed",
    limit5hUsd: null,
    limitConcurrentSessions: 0,
    limitDailyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    limitWeeklyUsd: null,
    maxRetryAttempts: 1,
    mcpPassthroughType: "none",
    mcpPassthroughUrl: null,
    modelRedirects: null,
    name: `provider-${id}`,
    preserveClientIp: false,
    priority: id,
    providerType: "claude",
    providerVendorId: null,
    proxyFallbackToDirect: false,
    proxyUrl: null,
    requestTimeoutNonStreamingMs: 0,
    rpd: 0,
    rpm: 0,
    streamingIdleTimeoutMs: 0,
    swapCacheTtlBilling: false,
    totalCostResetAt: null,
    tpm: 0,
    updatedAt: CREATED_AT,
    url,
    websiteUrl: null,
    weight: 1,
  };
}

type Upstream = {
  readonly abortCount: () => number;
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
  readonly requestCount: () => number;
  readonly response: Promise<ServerResponse>;
  readonly send: (body: string) => Promise<void>;
  readonly terminated: Promise<void>;
};

async function startUpstream(): Promise<Upstream> {
  const sockets = new Set<Socket>();
  const responseGate = Promise.withResolvers<ServerResponse>();
  const terminationGate = Promise.withResolvers<void>();
  let requests = 0;
  let aborts = 0;
  const server = createServer((request, response) => {
    requests += 1;
    request.resume();
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.flushHeaders();
    response.once("close", () => {
      if (!response.writableEnded) aborts += 1;
      terminationGate.resolve();
    });
    responseGate.resolve(response);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const baseUrl = await new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Loopback fixture did not receive a TCP address"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
  return {
    abortCount: () => aborts,
    baseUrl,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    requestCount: () => requests,
    response: responseGate.promise,
    send: async (body) => {
      const response = await responseGate.promise;
      await new Promise<void>((resolve) => response.end(body, resolve));
    },
    terminated: terminationGate.promise,
  };
}

async function createSession(
  provider: Provider,
  pathname: string = "/v1/messages",
  signal?: AbortSignal
): Promise<ProxySession> {
  const request = new Request(`https://hub.test${pathname}`, {
    body: JSON.stringify({
      max_tokens: 32,
      messages: [{ content: "integration", role: "user" }],
      model: "claude-test",
      stream: true,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
    ...(signal ? { signal } : {}),
  });
  const session = await ProxySession.fromContext(new Context(request));
  session.setAuthState({ apiKey: KEY.key, key: KEY, success: true, user: USER });
  session.setMessageContext(MESSAGE);
  session.setOriginalFormat("claude");
  session.setOriginalModel("claude-test");
  session.setProvider(provider);
  return session;
}

function sse(inputTokens: number, outputTokens: number): string {
  return `event: message_delta\ndata: ${JSON.stringify({
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  })}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`;
}

async function settleTasks(): Promise<void> {
  while (state.tasks.length > 0) {
    const settlements = await Promise.allSettled(state.tasks.splice(0, state.tasks.length));
    const failures = settlements.flatMap((settlement) =>
      settlement.status === "rejected" ? [settlement.reason] : []
    );
    if (failures.length > 0) throw new AggregateError(failures, "Proxy lifecycle task failed");
  }
}

function watchAgentReleases(expectedReleases: number) {
  const pool = getGlobalAgentPool();
  const originalRelease = pool.releaseAgent.bind(pool);
  const released = Promise.withResolvers<void>();
  let releaseCount = 0;
  const release = vi.spyOn(pool, "releaseAgent").mockImplementation((cacheKey, dispatcherId) => {
    originalRelease(cacheKey, dispatcherId);
    releaseCount += 1;
    if (releaseCount === expectedReleases) released.resolve();
  });
  return { acquire: vi.spyOn(pool, "getAgent"), pool, release, released: released.promise };
}

beforeEach(async () => {
  await resetGlobalAgentPool();
  vi.clearAllMocks();
  state.billHedgeLosers = false;
  state.discoveryEnabled = false;
  state.http2Error = null;
  state.loserBilled = Promise.withResolvers<void>();
  state.providers.length = 0;
  state.tasks.length = 0;
  state.addLoserCost.mockImplementation(async () => state.loserBilled.resolve());
  state.pickAlternative.mockImplementation(async (_session: unknown, excludedIds: number[]) => {
    return state.providers.find((provider) => !excludedIds.includes(provider.id)) ?? null;
  });
  state.pickDiscovery.mockImplementation(
    async (_session: unknown, count: number, excludedIds: number[]) =>
      state.providers.filter((provider) => !excludedIds.includes(provider.id)).slice(0, count)
  );
});

afterEach(async () => {
  vi.useRealTimers();
  await settleTasks();
  await resetGlobalAgentPool();
});

describe("proxy hedge transport/lifecycle integration (persistence and control-plane seams mocked)", () => {
  it("runs a leased Discovery race over real loopback transports and cancels the loser", async () => {
    const [loser, winner] = await Promise.all([startUpstream(), startUpstream()]);
    const client = new AbortController();
    try {
      state.discoveryEnabled = true;
      const initialProvider = createProvider(1, loser.baseUrl, 0);
      const winningProvider = createProvider(2, winner.baseUrl, 0);
      winningProvider.priority = initialProvider.priority;
      state.providers.push(winningProvider);
      const session = await createSession(initialProvider, "/v1/messages", client.signal);
      session.sessionId = "integration-discovery";
      const agents = watchAgentReleases(2);

      const forwarded = ProxyForwarder.send(session);
      await Promise.all([loser.response, winner.response]);
      await winner.send(
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"winner"}}\n\n' +
          'event: message_stop\ndata: {"type":"message_stop"}\n\n'
      );

      const downstream = await ProxyResponseHandler.dispatch(session, await forwarded);
      await expect(downstream.text()).resolves.toContain("winner");
      await settleTasks();
      await loser.terminated;
      await agents.released;

      expect(loser.abortCount()).toBe(1);
      expect(winner.abortCount()).toBe(0);
      expect(state.acquireDiscoveryLease).toHaveBeenCalledTimes(1);
      expect(state.compareAndSetBinding).toHaveBeenCalledTimes(1);
      expect(state.releaseDiscoveryLease).toHaveBeenCalledTimes(1);
      expect(agents.pool.getPoolStats().activeRequests).toBe(0);
    } finally {
      client.abort(new Error("fixture cleanup"));
      await Promise.all([loser.close(), winner.close()]);
    }
  });

  it("fences loser timers after winner settlement and releases each launched transport once", async () => {
    const [slow, winner, fenced] = await Promise.all([
      startUpstream(),
      startUpstream(),
      startUpstream(),
    ]);
    const client = new AbortController();
    try {
      const initialProvider = createProvider(1, slow.baseUrl, 50);
      state.providers.push(
        createProvider(2, winner.baseUrl, 50),
        createProvider(3, fenced.baseUrl, 50)
      );
      const session = await createSession(initialProvider, "/v1/messages", client.signal);
      const agents = watchAgentReleases(2);
      vi.useFakeTimers({ toFake: ["clearTimeout", "setTimeout"] });

      const forwarded = ProxyForwarder.send(session);
      await slow.response;
      await vi.advanceTimersByTimeAsync(50);
      await winner.response;
      await winner.send(sse(8, 2));
      const downstream = await ProxyResponseHandler.dispatch(session, await forwarded);
      await expect(downstream.text()).resolves.toContain("message_stop");
      await settleTasks();
      await slow.terminated;
      await agents.released;
      await vi.advanceTimersByTimeAsync(500);

      expect(fenced.requestCount()).toBe(0);
      expect(slow.abortCount()).toBe(1);
      expect(winner.abortCount()).toBe(0);
      expect(agents.acquire).toHaveBeenCalledTimes(2);
      expect(agents.release).toHaveBeenCalledTimes(2);
      expect(new Set(agents.release.mock.calls.map(([key, id]) => `${key}|${id}`))).toHaveLength(2);
      expect(agents.pool.getPoolStats().activeRequests).toBe(0);
    } finally {
      client.abort(new Error("fixture cleanup"));
      await Promise.all([slow.close(), winner.close(), fenced.close()]);
    }
  });

  it("classifies local database overload before upstream fanout", async () => {
    const [initial, alternative] = await Promise.all([startUpstream(), startUpstream()]);
    try {
      const initialProvider = createProvider(1, initial.baseUrl, 50);
      state.providers.push(createProvider(2, alternative.baseUrl, 50));
      const session = await createSession(initialProvider);
      const wrapped = new Error("Failed query", {
        cause: new DbPoolAdmissionError("data", 32),
      });
      state.http2Error = wrapped;

      await expect(ProxyForwarder.send(session)).rejects.toBe(wrapped);

      expect(initial.requestCount()).toBe(0);
      expect(alternative.requestCount()).toBe(0);
      expect(state.pickAlternative).not.toHaveBeenCalled();
      expect(state.recordFailure).not.toHaveBeenCalled();
      expect(session.getProviderChain()).toEqual([
        expect.objectContaining({
          errorDetails: expect.objectContaining({
            system: expect.objectContaining({ errorCode: "DB_POOL_ADMISSION_EXCEEDED" }),
          }),
          reason: "system_error",
        }),
      ]);
    } finally {
      await Promise.all([initial.close(), alternative.close()]);
    }
  });

  it("bills the hedge winner and naturally drained loser exactly once", async () => {
    const [loser, winner] = await Promise.all([startUpstream(), startUpstream()]);
    const client = new AbortController();
    try {
      state.billHedgeLosers = true;
      const initialProvider = createProvider(1, loser.baseUrl, 50);
      state.providers.push(createProvider(2, winner.baseUrl, 50));
      const session = await createSession(initialProvider, "/v1/messages", client.signal);
      const agents = watchAgentReleases(2);
      vi.useFakeTimers({ toFake: ["clearTimeout", "setTimeout"] });

      const forwarded = ProxyForwarder.send(session);
      await loser.response;
      await vi.advanceTimersByTimeAsync(50);
      await winner.response;
      await winner.send(sse(10, 3));
      const downstream = await ProxyResponseHandler.dispatch(session, await forwarded);
      await downstream.text();
      await settleTasks();
      await loser.send(sse(7, 2));
      await state.loserBilled.promise;
      await agents.released;

      expect(state.updateWinnerCost).toHaveBeenCalledTimes(1);
      expect(state.updateWinnerCost.mock.calls[0]?.[0]).toBe(MESSAGE.id);
      expect(String(state.updateWinnerCost.mock.calls[0]?.[1])).toBe("0.016");
      expect(state.updateMessageRequestCostWithBreakdown).not.toHaveBeenCalled();

      expect(state.addLoserCost).toHaveBeenCalledTimes(1);
      expect(state.addLoserCost.mock.calls[0]?.[0]).toBe(MESSAGE.id);
      expect(String(state.addLoserCost.mock.calls[0]?.[1])).toBe("0.011");
      expect(state.addLoserCost.mock.calls[0]?.[2]).toEqual(
        expect.objectContaining({ attemptNumber: 1, providerId: initialProvider.id })
      );

      expect(state.durableTerminal).toHaveBeenCalledTimes(1);
      expect(state.durableTerminal).toHaveBeenCalledWith(
        MESSAGE.id,
        expect.objectContaining({
          inputTokens: 10,
          outputTokens: 3,
          providerId: 2,
          statusCode: 200,
        }),
        expect.objectContaining({ onCommitted: expect.any(Function) })
      );
      expect(state.updateMessageRequestDetailsIfUnfinalized).not.toHaveBeenCalled();

      expect(state.trackCost).toHaveBeenCalledTimes(2);
      expect(state.trackCost).toHaveBeenNthCalledWith(
        1,
        KEY.id,
        2,
        "",
        0.016,
        expect.objectContaining({ requestId: MESSAGE.id, userId: USER.id })
      );
      expect(state.trackCost).toHaveBeenNthCalledWith(
        2,
        KEY.id,
        initialProvider.id,
        "",
        0.011,
        expect.objectContaining({
          requestId: `${MESSAGE.id}:hedge-loser:${initialProvider.id}:1`,
          userId: USER.id,
        })
      );
      expect(state.settleLeaseBudgets).toHaveBeenCalledTimes(2);
      expect(state.settleLeaseBudgets).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          cost: 0.016,
          entities: expect.objectContaining({
            provider: expect.objectContaining({ id: 2 }),
          }),
          requestId: MESSAGE.id,
        })
      );
      expect(state.settleLeaseBudgets).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          cost: 0.011,
          entities: expect.objectContaining({
            provider: expect.objectContaining({ id: initialProvider.id }),
          }),
          requestId: `${MESSAGE.id}:hedge-loser:${initialProvider.id}:1`,
        })
      );
      expect(loser.requestCount()).toBe(1);
      expect(winner.requestCount()).toBe(1);
      expect(loser.abortCount()).toBe(0);
      expect(winner.abortCount()).toBe(0);
      expect(agents.release).toHaveBeenCalledTimes(2);
      expect(agents.pool.getPoolStats().activeRequests).toBe(0);

      await vi.advanceTimersByTimeAsync(500);
      await settleTasks();

      expect(state.pickAlternative).toHaveBeenCalledTimes(1);
      expect(loser.requestCount()).toBe(1);
      expect(winner.requestCount()).toBe(1);
      expect(state.updateWinnerCost).toHaveBeenCalledTimes(1);
      expect(state.addLoserCost).toHaveBeenCalledTimes(1);
      expect(state.updateMessageRequestCostWithBreakdown).not.toHaveBeenCalled();
      expect(state.durableTerminal).toHaveBeenCalledTimes(1);
      expect(state.updateMessageRequestDetailsIfUnfinalized).not.toHaveBeenCalled();
      expect(state.trackCost).toHaveBeenCalledTimes(2);
      expect(state.settleLeaseBudgets).toHaveBeenCalledTimes(2);
      expect(loser.abortCount()).toBe(0);
      expect(winner.abortCount()).toBe(0);
      expect(agents.release).toHaveBeenCalledTimes(2);
    } finally {
      client.abort(new Error("fixture cleanup"));
      await Promise.all([loser.close(), winner.close()]);
    }
  });

  it("keeps the first-byte deadline armed across the public response handoff", async () => {
    const silent = await startUpstream();
    const client = new AbortController();
    try {
      const provider = createProvider(1, silent.baseUrl, 50);
      const session = await createSession(provider, "/v1/messages/count_tokens", client.signal);
      const agents = watchAgentReleases(1);
      vi.useFakeTimers({ toFake: ["clearTimeout", "setTimeout"] });

      const forwarded = ProxyForwarder.send(session);
      await silent.response;
      const downstream = await ProxyResponseHandler.dispatch(session, await forwarded);
      const bodyRejection = expect(downstream.text()).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(50);

      await bodyRejection;
      await settleTasks();
      await silent.terminated;
      await agents.released;
      expect(silent.abortCount()).toBe(1);
      expect(state.durableTerminal).toHaveBeenCalledOnce();
      expect(state.durableTerminal).toHaveBeenCalledWith(
        MESSAGE.id,
        expect.objectContaining({ statusCode: 502 }),
        expect.objectContaining({ onCommitted: expect.any(Function) })
      );
      expect(agents.release).toHaveBeenCalledOnce();
      expect(agents.pool.getPoolStats().activeRequests).toBe(0);
    } finally {
      client.abort(new Error("fixture cleanup"));
      await silent.close();
    }
  });
});
