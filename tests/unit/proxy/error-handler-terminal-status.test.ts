import { Context } from "hono";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ProxyErrorHandler } from "@/app/v1/_lib/proxy/error-handler";
import { ProxyError, RateLimitError } from "@/app/v1/_lib/proxy/errors";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { ErrorDetectionResult } from "@/lib/error-rule-detector";
import type { Provider } from "@/types/provider";

const mocks = vi.hoisted(() => ({
  detectAsync: vi.fn<(content: string) => Promise<ErrorDetectionResult>>(),
  emitProxyLangfuseTrace: vi.fn(),
  getCachedSystemSettings: vi.fn(async () => ({
    verboseProviderError: false,
    passThroughUpstreamErrorMessage: false,
  })),
}));

vi.mock("@/lib/error-rule-detector", () => ({
  errorRuleDetector: { detectAsync: mocks.detectAsync },
}));

vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: mocks.getCachedSystemSettings,
}));

vi.mock("@/lib/langfuse/emit-proxy-trace", () => ({
  emitProxyLangfuseTrace: mocks.emitProxyLangfuseTrace,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  },
}));

const PROVIDER = {
  id: 7,
  name: "provider-a",
  url: "https://provider-a.example.com",
  key: "provider-key",
  providerVendorId: 70,
  isEnabled: true,
  weight: 1,
  priority: 0,
  groupPriorities: null,
  costMultiplier: 1,
  groupTag: null,
  providerType: "claude",
  preserveClientIp: false,
  disableSessionReuse: false,
  modelRedirects: null,
  activeTimeStart: null,
  activeTimeEnd: null,
  allowedModels: null,
  allowedClients: [],
  blockedClients: [],
  mcpPassthroughType: "none",
  mcpPassthroughUrl: null,
  limit5hUsd: null,
  limit5hResetMode: "fixed",
  limitDailyUsd: null,
  dailyResetMode: "fixed",
  dailyResetTime: "00:00",
  limitWeeklyUsd: null,
  limitMonthlyUsd: null,
  limitTotalUsd: null,
  totalCostResetAt: null,
  limitConcurrentSessions: 0,
  maxRetryAttempts: 3,
  circuitBreakerFailureThreshold: 5,
  circuitBreakerOpenDuration: 1_800_000,
  circuitBreakerHalfOpenSuccessThreshold: 2,
  proxyUrl: null,
  proxyFallbackToDirect: false,
  customHeaders: null,
  firstByteTimeoutStreamingMs: 30_000,
  streamingIdleTimeoutMs: 10_000,
  requestTimeoutNonStreamingMs: 600_000,
  websiteUrl: null,
  faviconUrl: null,
  cacheTtlPreference: null,
  swapCacheTtlBilling: false,
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
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
} satisfies Provider;

const RATE_LIMIT_CASES = [
  { limitType: "rpm", expectedStatus: 429 },
  { limitType: "concurrent_sessions", expectedStatus: 429 },
  { limitType: "daily_quota", expectedStatus: 402 },
  { limitType: "usd_5h", expectedStatus: 402 },
] as const;

async function createSession(): Promise<ProxySession> {
  const request = new Request("https://hub.test/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "hello" }],
    }),
  });
  return ProxySession.fromContext(new Context(request));
}

describe("ProxyErrorHandler.handle terminal status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.detectAsync.mockResolvedValue({ matched: false });
    mocks.getCachedSystemSettings.mockResolvedValue({
      verboseProviderError: false,
      passThroughUpstreamErrorMessage: false,
    });
  });

  test.each([400, 404, 429, 524])("preserves ProxyError status %i", async (status) => {
    const session = await createSession();
    const error = new ProxyError("Upstream failed", status, { body: "Upstream failed" });

    const response = await ProxyErrorHandler.handle(session, error);

    expect(response.status).toBe(status);
    expect(mocks.emitProxyLangfuseTrace).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ statusCode: status })
    );
  });

  test("uses the last failed provider-chain status for a generic error", async () => {
    const session = await createSession();
    session.addProviderToChain(PROVIDER, { reason: "retry_failed", statusCode: 503 });

    const response = await ProxyErrorHandler.handle(session, new Error("fetch failed"));

    expect(response.status).toBe(503);
    expect(mocks.emitProxyLangfuseTrace).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ statusCode: 503, errorMessage: "fetch failed" })
    );
  });

  test.each(RATE_LIMIT_CASES)("maps $limitType limits to HTTP $expectedStatus", async ({
    limitType,
    expectedStatus,
  }) => {
    const session = await createSession();
    const error = new RateLimitError("rate_limit_error", "limit exceeded", limitType, 12, 20, null);

    const response = await ProxyErrorHandler.handle(session, error);

    expect(response.status).toBe(expectedStatus);
    expect(await response.json()).toEqual({
      error: {
        type: "rate_limit_error",
        message: "limit exceeded",
        code: "rate_limit_exceeded",
        limit_type: limitType,
        current: 12,
        limit: 20,
        reset_time: null,
      },
    });
    expect(mocks.emitProxyLangfuseTrace).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        responseText: "",
        statusCode: expectedStatus,
        errorMessage: "limit exceeded",
      })
    );
  });

  test("keeps fixed-window rate-limit headers", async () => {
    const session = await createSession();
    const error = new RateLimitError(
      "rate_limit_error",
      "daily limit exceeded",
      "daily_quota",
      12,
      20,
      "2026-04-22T13:30:00.000Z"
    );

    const response = await ProxyErrorHandler.handle(session, error);

    expect(response.status).toBe(402);
    expect(response.headers.get("X-RateLimit-Limit")).toBe("20");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("8");
    expect(response.headers.get("X-RateLimit-Reset")).toBe("1776864600");
    expect(response.headers.get("Retry-After")).toBe("0");
  });
});
