import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import { ProxyResponseHandler } from "@/app/v1/_lib/proxy/response-handler";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import { setDeferredStreamingFinalization } from "@/app/v1/_lib/proxy/stream-finalization";
import { SessionManager } from "@/lib/session-manager";
import {
  updateMessageRequestDetailsDurably,
  updateMessageRequestDetailsIfUnfinalized,
} from "@/repository/message";
import type { Provider } from "@/types/provider";

vi.mock("@/app/v1/_lib/proxy/response-fixer", () => ({
  ResponseFixer: { process: async (_s: unknown, r: Response) => r },
}));

vi.mock("@/lib/async-task-manager", () => ({
  AsyncTaskManager: {
    register: (
      _id: string,
      factory: (signal: AbortSignal) => Promise<void>,
      options: string | { abortController?: AbortController; taskType?: string } = "unknown"
    ) => {
      const c =
        typeof options === "object" && (options as any).abortController
          ? (options as any).abortController
          : new AbortController();
      const p = Promise.resolve().then(() => factory(c.signal));
      (globalThis as any).__hcTasks = (globalThis as any).__hcTasks || [];
      (globalThis as any).__hcTasks.push(p);
      return c;
    },
    touch: vi.fn(() => true),
  },
}));

vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: vi.fn(async () => ({ billNonSuccessfulRequests: false })),
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

vi.mock("@/lib/proxy-status-tracker", () => ({
  ProxyStatusTracker: { getInstance: () => ({ endRequest: vi.fn() }) },
}));

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    clearSessionProvider: vi.fn(async () => undefined),
    clearVersionedSessionProvider: vi.fn(async () => ({ status: "ok" })),
    compareAndSetSessionProvider: vi.fn(async () => ({ status: "ok", reason: "gen" })),
    getVersionedSessionBindingRefreshIntervalMs: vi.fn(() => 100_000),
    renewSessionDiscoveryLease: vi.fn(async () => ({
      status: "renewed",
      legacyFallbackAllowed: false,
    })),
    releaseSessionDiscoveryLease: vi.fn(async () => ({
      status: "released",
      legacyFallbackAllowed: false,
    })),
    touchVersionedSessionBinding: vi.fn(async (snapshot: any) => ({
      status: "ok",
      source: "touched",
      snapshot,
      legacyFallbackAllowed: false,
    })),
    extractCodexPromptCacheKey: vi.fn(),
    storeSessionResponseBodySet: vi.fn(async () => undefined),
    storeSessionRequestPhaseSnapshot: vi.fn(),
    storeSessionResponsePhaseSnapshot: vi.fn(),
    updateSessionProvider: vi.fn(),
    updateSessionUsage: vi.fn(),
    updateSessionBindingSmart: vi.fn(async () => ({ updated: true, reason: "ok" })),
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

vi.mock("@/lib/circuit-breaker", () => ({ recordFailure: vi.fn(), recordSuccess: vi.fn() }));
vi.mock("@/lib/endpoint-circuit-breaker", () => ({
  recordEndpointSuccess: vi.fn(),
  recordEndpointFailure: vi.fn(),
}));
vi.mock("@/lib/redis/live-chain-store", () => ({
  writeLiveChain: vi.fn(),
  writeLiveRoutingTrace: vi.fn(),
  deleteLiveChain: vi.fn(),
}));
vi.mock("@/repository/message", () => ({
  updateMessageRequestCostWithBreakdown: vi.fn(),
  updateMessageRequestDetails: vi.fn(),
  updateMessageRequestDetailsDurably: vi.fn(async (_id: any, _d: any, opts: any) => {
    await opts?.onCommitted?.();
    return true;
  }),
  updateMessageRequestDetailsIfUnfinalized: vi.fn(async (_id: any, _d: any, opts: any) => {
    await opts?.onCommitted?.();
    return true;
  }),
  updateMessageRequestDuration: vi.fn(),
  updateMessageRequestWinnerCost: vi.fn(),
  updateMessageRequestRoutingTrace: vi.fn(async () => {}),
}));

function makeProvider(): Provider {
  return {
    id: 1,
    name: "codex-provider",
    url: "https://api.test.invalid/v1",
    key: "sk-test",
    providerVendorId: null,
    providerType: "codex",
    isEnabled: true,
    weight: 1,
    priority: 1,
    groupPriorities: null,
    costMultiplier: 1,
    groupTag: null,
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
    codexImageGenerationPreference: null,
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
  } as unknown as Provider;
}

function makeSession(signal: AbortSignal): ProxySession {
  const provider = makeProvider();
  const session = Object.create(ProxySession.prototype) as ProxySession;
  const user = { id: 1, name: "admin" };
  const key = { id: 2, name: "Omni" };
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
    messageContext: { id: 777, createdAt: new Date(), user, key, apiKey: "sk-test" },
    originalFormat: "response",
    originalModelName: "gpt-5.4-mini",
    originalUrlPathname: "/v1/responses",
    affinity: {
      scopeTag: "test",
      chain: { head: { fp: "fp1" }, tail: [{ fp: "fp1" }] },
      nominatedProviderId: 1,
      matchedFp: "fp1",
      identityFp: "fp1",
      generation: "gen1",
      lookup: { identityFp: "fp1", generation: "gen1" },
    },
    provider,
    providerChain: [],
    providerType: "codex",
    request: { log: "", message: { model: "gpt-5.4-mini", stream: true }, model: "gpt-5.4-mini" },
    requestSequence: 1,
    requestUrl: new URL("http://localhost/v1/responses"),
    sessionId: "sess-codex-1",
    specialSettings: [],
    startTime: Date.now(),
    ttftMs: null,
    firstByteMs: null,
    userAgent: "Codex CLI",
    userName: "admin",
    highConcurrencyModeEnabled: false,
    addProviderToChain(this: any, prov: Provider, meta: any) {
      this.providerChain.push({ id: prov.id, name: prov.name, ...(meta ?? {}) });
    },
    getProviderChain() {
      return (this as any).providerChain;
    },
    clearResponseTimeout: vi.fn(),
    getContext1mApplied: () => false,
    getCurrentModel: () => "gpt-5.4-mini",
    getEndpoint: () => "/v1/responses",
    getEndpointPolicy: () => resolveEndpointPolicy("/v1/responses"),
    getGroupCostMultiplier: () => 1,
    getOriginalModel: () => "gpt-5.4-mini",
    getResolvedPricingByBillingSource: async () => null,
    getSpecialSettings: () => [],
    getSessionIdentityMetadata: () => ({
      identity: "sess-codex-1",
      kind: "session_id",
      scopeTag: null,
      fingerprint: null,
      fingerprints: [],
    }),
    isHeaderModified: () => false,
    recordTtft: vi.fn(),
    releaseAgent: vi.fn(),
    setContext1mApplied: vi.fn(),
    getCodexPriorityBillingSource: async () => "requested",
    finalizeRoutingTrace: () => null,
    appendRoutingTraceEvent: vi.fn(),
  });
  (session as any).isSessionBindingAllowed = () => true;
  return session;
}

function completedResponsesSse(): Response {
  const body = [
    `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "hello" })}`,
    `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp_1", model: "gpt-5.4-mini", usage: { input_tokens: 100, output_tokens: 50 } } })}`,
    "",
  ].join("\n\n");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function truncatedResponsesSse(): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === 0) {
        index += 1;
        controller.enqueue(
          encoder.encode(
            `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "partial" })}\n\n`
          )
        );
        return;
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function drainHcTasks() {
  const tasks: Promise<void>[] = (globalThis as any).__hcTasks.splice(0) ?? [];
  await Promise.allSettled(tasks);
  await new Promise((r) => setTimeout(r, 10));
  const more: Promise<void>[] = (globalThis as any).__hcTasks.splice(0) ?? [];
  await Promise.allSettled(more);
}

describe("high concurrency client-abort retention (fix for 499 + affinity churn)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).__hcTasks = [];
    vi.mocked(updateMessageRequestDetailsDurably).mockImplementation(
      async (_id: any, _d: any, opts: any) => {
        await opts?.onCommitted?.();
        return true;
      }
    );
    vi.mocked(updateMessageRequestDetailsIfUnfinalized).mockImplementation(
      async (_id: any, _d: any, opts: any) => {
        await opts?.onCommitted?.();
        return true;
      }
    );
  });

  it("completed Codex stream with client abort is still billed 200 and keeps binding under high concurrency", async () => {
    const controller = new AbortController();
    const session = makeSession(controller.signal);
    session.setHighConcurrencyModeEnabled(true);

    setDeferredStreamingFinalization(session as any, {
      providerId: 1,
      providerName: "codex-provider",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
      bindingIntent: "renew",
      bindingSnapshot: { sessionId: "sess-codex-1", keyId: 2, providerId: 1, generation: "gen1" },
      requiresCompletionMarkerForBinding: true,
      discoveryLease: {
        sessionId: "sess-codex-1",
        keyId: 2,
        ownerToken: "owner-1",
        ttlSeconds: 30,
      },
    });

    const downstream = await ProxyResponseHandler.dispatch(session, completedResponsesSse());
    // Codex reads response.completed then hangs up: abort after dispatch
    controller.abort(new Error("client detached"));
    await downstream.body?.cancel("client detached").catch(() => {});
    await drainHcTasks();

    const calls = vi.mocked(updateMessageRequestDetailsDurably).mock.calls;
    const last = calls[calls.length - 1]?.[1] as any;
    expect(last.statusCode).toBe(200);
    expect(last.providerChain[0].reason).toBe("request_success");
    // binding must NOT have been cleared – clearing would force next request off affinity_hit
    expect(SessionManager.clearVersionedSessionProvider).not.toHaveBeenCalled();
    expect(SessionManager.clearSessionProvider).not.toHaveBeenCalled();
  });

  it("genuinely truncated stream under high concurrency is still a failure and not billed as 200", async () => {
    const controller = new AbortController();
    controller.abort(); // already aborted before dispatch -> truncated
    const session = makeSession(controller.signal);
    session.setHighConcurrencyModeEnabled(true);
    setDeferredStreamingFinalization(session as any, {
      providerId: 1,
      providerName: "codex-provider",
      providerPriority: 1,
      attemptNumber: 1,
      totalProvidersAttempted: 1,
      isFirstAttempt: true,
      isFailoverSuccess: false,
      endpointId: 42,
      endpointUrl: "https://api.test.invalid/v1",
      upstreamStatusCode: 200,
      bindingIntent: "renew",
      bindingSnapshot: { sessionId: "sess-codex-1", keyId: 2, providerId: 1, generation: "gen1" },
      requiresCompletionMarkerForBinding: true,
      discoveryLease: {
        sessionId: "sess-codex-1",
        keyId: 2,
        ownerToken: "owner-1",
        ttlSeconds: 30,
      },
    });

    const downstream = await ProxyResponseHandler.dispatch(session, truncatedResponsesSse());
    await downstream.body?.cancel("client detached").catch(() => {});
    await drainHcTasks();

    const calls = vi.mocked(updateMessageRequestDetailsDurably).mock.calls;
    const last = calls[calls.length - 1]?.[1] as any;
    // Truncated (no response.completed marker) must not be reclassified as success,
    // regardless of concurrency mode — keep the failure path (499 or 502).
    expect(last.statusCode).not.toBe(200);
    expect(last.providerChain[0].reason).not.toBe("request_success");
  });
});
