import { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  finalizeHedgeLoserBilling,
  finalizeRequestStats,
} from "@/app/v1/_lib/proxy/response-handler";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider } from "@/types/provider";

const mocks = vi.hoisted(() => ({
  addLoserCost: vi.fn<(id: number, cost: object, entry: object) => Promise<void>>(),
  durable: vi.fn<(id: number, details: object) => Promise<void>>(),
  updateCost: vi.fn<(id: number, cost: object, breakdown: object) => Promise<void>>(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  },
}));
vi.mock("@/repository/message", () => ({
  addMessageRequestHedgeLoserCost: mocks.addLoserCost,
  updateMessageRequestCostWithBreakdown: mocks.updateCost,
  updateMessageRequestDetails: vi.fn(),
  updateMessageRequestDetailsDurably: mocks.durable,
  updateMessageRequestDetailsIfUnfinalized: vi.fn(),
  updateMessageRequestDuration: vi.fn(),
  updateMessageRequestWinnerCost: vi.fn(),
}));

const CREATED_AT = new Date(0);

function createProvider(): Provider {
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
    firstByteTimeoutStreamingMs: 0,
    geminiGoogleSearchPreference: null,
    groupPriorities: null,
    groupTag: null,
    id: 13,
    isEnabled: true,
    key: "provider-key",
    limit5hResetMode: "fixed",
    limit5hUsd: null,
    limitConcurrentSessions: 0,
    limitDailyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    limitWeeklyUsd: null,
    maxRetryAttempts: null,
    mcpPassthroughType: "none",
    mcpPassthroughUrl: null,
    modelRedirects: null,
    name: "finalizer-provider",
    preserveClientIp: false,
    priority: 1,
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
    url: "https://provider.test",
    websiteUrl: null,
    weight: 1,
  } satisfies Provider;
}

async function createSession(
  provider: Provider | null,
  priceData: {
    input_cost_per_token: number;
    output_cost_per_token: number;
    input_cost_per_request?: number;
  } = {
    input_cost_per_token: 1,
    output_cost_per_token: 10,
  }
): Promise<ProxySession> {
  const request = new Request("https://hub.test/v1/messages", {
    body: JSON.stringify({ messages: [], model: "claude-test", stream: false }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const session = await ProxySession.fromContext(new Context(request));
  session.setProvider(provider);
  session.setOriginalModel("claude-test");
  if (provider) {
    Object.defineProperty(session, "messageContext", {
      value: { createdAt: CREATED_AT, id: 71 },
      writable: true,
    });
    Object.defineProperty(session, "getResolvedPricingByBillingSource", {
      value: vi.fn(async () => ({
        priceData,
        resolvedModelName: "claude-test",
        resolvedPricingProviderKey: "anthropic",
        source: "official_fallback" as const,
      })),
    });
  }
  return session;
}

describe("exported response finalizers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addLoserCost.mockResolvedValue(undefined);
    mocks.durable.mockResolvedValue(undefined);
    mocks.updateCost.mockResolvedValue(undefined);
  });

  it("skips request finalization without provider and message context", async () => {
    const session = await createSession(null);

    const usage = await finalizeRequestStats(session, "{}", 200, 15);

    expect(usage).toBeNull();
    expect(mocks.durable).not.toHaveBeenCalled();
  });

  it("returns parsed usage and durably persists request statistics", async () => {
    const session = await createSession(createProvider());
    const responseText = JSON.stringify({ usage: { input_tokens: 2, output_tokens: 3 } });

    const usage = await finalizeRequestStats(session, responseText, 200, 15);

    expect(usage).toMatchObject({ input_tokens: 2, output_tokens: 3 });
    expect(mocks.durable).toHaveBeenCalledWith(
      71,
      expect.objectContaining({ inputTokens: 2, outputTokens: 3, statusCode: 200 })
    );
  });

  it("skips incomplete hedge drains that contain no usage", async () => {
    const provider = createProvider();
    const session = await createSession(provider);

    const billed = await finalizeHedgeLoserBilling({
      allContent: "partial",
      attemptNumber: 2,
      drainComplete: false,
      loserSession: session,
      messageRequestCreatedAtMs: 0,
      messageRequestId: 71,
      provider,
      upstreamStatusCode: 200,
    });

    expect(billed).toBeNull();
    expect(mocks.addLoserCost).not.toHaveBeenCalled();
  });

  it("skips Discovery loser billing without explicit usage even for per-request pricing", async () => {
    const provider = createProvider();
    const session = await createSession(provider, {
      input_cost_per_token: 1,
      output_cost_per_token: 10,
      input_cost_per_request: 5,
    });

    const billed = await finalizeHedgeLoserBilling({
      allContent: 'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      attemptNumber: 3,
      drainComplete: true,
      loserSession: session,
      messageRequestCreatedAtMs: 0,
      messageRequestId: 71,
      provider,
      requireUsage: true,
      upstreamStatusCode: 200,
    });

    expect(billed).toBeNull();
    expect(mocks.addLoserCost).not.toHaveBeenCalled();
  });

  it("adds a complete hedge loser's calculated cost to the original request", async () => {
    const provider = createProvider();
    const session = await createSession(provider);

    const billed = await finalizeHedgeLoserBilling({
      allContent: JSON.stringify({ usage: { input_tokens: 2, output_tokens: 3 } }),
      attemptNumber: 2,
      drainComplete: true,
      loserSession: session,
      messageRequestCreatedAtMs: 0,
      messageRequestId: 71,
      provider,
      upstreamStatusCode: 200,
    });

    expect(billed).toBe("32");
    expect(mocks.addLoserCost).toHaveBeenCalledWith(
      71,
      expect.objectContaining({ toString: expect.any(Function) }),
      expect.objectContaining({ attemptNumber: 2, costUsd: "32", providerId: 13 })
    );
  });
});
