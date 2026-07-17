import { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addMessageRequestHedgeLoserCost: vi.fn(async () => {}),
  detectUpstreamErrorFromSseOrJsonText: vi.fn(() => ({ isError: false })),
  isNonBillingEndpoint: vi.fn(() => false),
  trackCost: vi.fn(async () => {}),
  trackUserDailyCost: vi.fn(async () => {}),
  decrementLeaseBudget: vi.fn(async () => {}),
  settleLeaseBudgets: vi.fn(async () => ({
    requestId: "test",
    status: "settled" as const,
    settlements: [],
  })),
}));

vi.mock("@/repository/message", () => ({
  addMessageRequestHedgeLoserCost: mocks.addMessageRequestHedgeLoserCost,
  updateMessageRequestCostWithBreakdown: vi.fn(),
  updateMessageRequestDetails: vi.fn(),
  updateMessageRequestDuration: vi.fn(),
  updateMessageRequestWinnerCost: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
}));

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
      void Promise.resolve(factory(controller.signal)).catch(() => {});
      return controller;
    },
    touch: vi.fn(() => true),
    cleanup: vi.fn(),
    cancel: vi.fn(),
  },
}));

vi.mock("@/lib/utils/upstream-error-detection", () => ({
  detectUpstreamErrorFromSseOrJsonText: mocks.detectUpstreamErrorFromSseOrJsonText,
  inferUpstreamErrorStatusCodeFromText: vi.fn(() => null),
}));

vi.mock("@/lib/rate-limit", () => ({
  RateLimitService: {
    trackCost: mocks.trackCost,
    trackUserDailyCost: mocks.trackUserDailyCost,
    decrementLeaseBudget: mocks.decrementLeaseBudget,
    settleLeaseBudgets: mocks.settleLeaseBudgets,
  },
}));

vi.mock(import("@/lib/utils/performance-formatter"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isNonBillingEndpoint: mocks.isNonBillingEndpoint,
  };
});

import { finalizeHedgeLoserBilling } from "@/app/v1/_lib/proxy/response-handler";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider } from "@/types/provider";

function createCodexProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 11,
    name: "initial-codex-loser",
    url: "https://codex.example.com/v1",
    key: "sk-test",
    providerVendorId: null,
    isEnabled: true,
    weight: 1,
    priority: 0,
    groupPriorities: null,
    costMultiplier: 1,
    groupTag: null,
    providerType: "codex",
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

async function createLoserSession(
  provider: Provider,
  overrides: {
    sessionId?: string | null;
    context1mApplied?: boolean;
    groupCostMultiplier?: number;
  } = {}
) {
  const context = new Context(
    new Request("http://localhost/v1/responses", {
      method: "POST",
      body: JSON.stringify({ model: "winner-default-model", service_tier: "default" }),
      headers: { "content-type": "application/json" },
    })
  );
  const session = await ProxySession.fromContext(context);
  session.provider = provider;
  session.sessionId = overrides.sessionId ?? "session-1";
  session.messageContext = {
    id: 123,
    createdAt: new Date("2026-06-08T00:00:00.000Z"),
    user: { id: 20, limit5hResetMode: "rolling", dailyResetTime: "00:00", dailyResetMode: "fixed" },
    key: { id: 10, limit5hResetMode: "rolling", dailyResetTime: "00:00", dailyResetMode: "fixed" },
    apiKey: "test-api-key",
  };
  session.authState = {
    success: true,
    apiKey: "test-api-key",
    key: session.messageContext.key,
    user: session.messageContext.user,
  };
  session.getCodexPriorityBillingSource = vi.fn(async () => "requested");
  session.getResolvedPricingByBillingSource = vi.fn(async () => ({
    resolvedModelName: "gpt-5.5",
    resolvedPricingProviderKey: "openai",
    source: "official_fallback",
    priceData: {
      input_cost_per_token: 1,
      output_cost_per_token: 10,
      input_cost_per_token_priority: 2,
      output_cost_per_token_priority: 20,
    },
  }));
  if (overrides.context1mApplied) session.setContext1mApplied(true);
  if (overrides.groupCostMultiplier !== undefined) {
    session.setGroupCostMultiplier(overrides.groupCostMultiplier);
  }
  return session;
}

describe("finalizeHedgeLoserBilling Codex priority snapshot", () => {
  beforeEach(() => {
    mocks.addMessageRequestHedgeLoserCost.mockClear();
    mocks.detectUpstreamErrorFromSseOrJsonText.mockReturnValue({ isError: false });
    mocks.isNonBillingEndpoint.mockReturnValue(false);
    mocks.trackCost.mockClear();
    mocks.trackUserDailyCost.mockClear();
    mocks.decrementLeaseBudget.mockClear();
    mocks.settleLeaseBudgets.mockClear();
  });

  it("uses the initial loser's captured requested service tier after winner session sync", async () => {
    const provider = createCodexProvider();
    const loserSession = await createLoserSession(provider);
    const responseBody = JSON.stringify({
      usage: {
        input_tokens: 100,
        output_tokens: 10,
      },
    });

    const billed = await finalizeHedgeLoserBilling({
      messageRequestId: 123,
      messageRequestCreatedAtMs: new Date("2026-06-08T00:00:00.000Z").getTime(),
      loserSession,
      provider,
      attemptNumber: 1,
      upstreamStatusCode: 200,
      allContent: responseBody,
      drainComplete: true,
      billingContext: {
        originalModel: "gpt-5.5",
        redirectedModel: "gpt-5.5",
        requestedServiceTier: "priority",
        context1mApplied: false,
        groupCostMultiplier: 1,
      },
    });

    expect(billed).toBe("400");
    expect(mocks.addMessageRequestHedgeLoserCost).toHaveBeenCalledTimes(1);
    expect(mocks.addMessageRequestHedgeLoserCost.mock.calls[0]?.[1].toString()).toBe("400");
  });

  it("tracks Redis loser cost with the captured billing provider and multiplier", async () => {
    const loserProvider = createCodexProvider({
      id: 11,
      name: "initial-codex-loser",
      costMultiplier: 2,
    });
    const winnerProvider = createCodexProvider({
      id: 99,
      name: "winner-polluted-provider",
      costMultiplier: 10,
    });
    const loserSession = await createLoserSession(winnerProvider, {
      context1mApplied: true,
      groupCostMultiplier: 99,
    });
    const responseBody = JSON.stringify({
      usage: {
        input_tokens: 100,
        output_tokens: 10,
      },
    });

    const billed = await finalizeHedgeLoserBilling({
      messageRequestId: 123,
      messageRequestCreatedAtMs: new Date("2026-06-08T00:00:00.000Z").getTime(),
      loserSession,
      provider: loserProvider,
      attemptNumber: 1,
      upstreamStatusCode: 200,
      allContent: responseBody,
      drainComplete: true,
      billingContext: {
        originalModel: "gpt-5.5",
        redirectedModel: "gpt-5.5",
        requestedServiceTier: "priority",
        context1mApplied: false,
        groupCostMultiplier: 3,
      },
    });

    expect(billed).toBe("2400");
    expect(mocks.trackCost).toHaveBeenCalledTimes(1);
    expect(mocks.trackCost).toHaveBeenCalledWith(
      10,
      loserProvider.id,
      "session-1",
      2400,
      expect.objectContaining({
        userId: 20,
        userResetTime: "00:00",
        userResetMode: "fixed",
        requestId: "123:hedge-loser:11:1",
      })
    );
    expect(mocks.trackUserDailyCost).not.toHaveBeenCalled();
    expect(mocks.settleLeaseBudgets).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "123:hedge-loser:11:1",
        cost: 2400,
      })
    );
  });

  it("tracks an alternative loser even when its shadow session has no request context", async () => {
    const loserProvider = createCodexProvider({ id: 12, name: "shadow-loser" });
    const loserSession = await createLoserSession(loserProvider, { sessionId: null });
    loserSession.sessionId = null;
    loserSession.messageContext = null;

    const billed = await finalizeHedgeLoserBilling({
      messageRequestId: 124,
      messageRequestCreatedAtMs: new Date("2026-06-08T00:00:01.000Z").getTime(),
      loserSession,
      provider: loserProvider,
      attemptNumber: 2,
      upstreamStatusCode: 200,
      allContent: JSON.stringify({ usage: { input_tokens: 100, output_tokens: 10 } }),
      drainComplete: true,
    });

    expect(billed).toBe("200");
    expect(mocks.trackCost).toHaveBeenCalledWith(
      10,
      loserProvider.id,
      "",
      200,
      expect.objectContaining({
        requestId: "124:hedge-loser:12:2",
        createdAtMs: new Date("2026-06-08T00:00:01.000Z").getTime(),
      })
    );
    expect(mocks.settleLeaseBudgets).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "124:hedge-loser:12:2", cost: 200 })
    );
  });
});
