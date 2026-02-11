import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    pickRandomProviderWithExclusion: vi.fn(),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(async () => {}),
    getCircuitState: vi.fn(() => "closed"),
    getProviderHealthInfo: vi.fn(async () => ({
      health: { failureCount: 0 },
      config: { failureThreshold: 3 },
    })),
    updateMessageRequestDetails: vi.fn(async () => {}),
    isHttp2Enabled: vi.fn(async () => false),
  };
});

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    isHttp2Enabled: mocks.isHttp2Enabled,
  };
});

vi.mock("@/lib/circuit-breaker", () => ({
  getCircuitState: mocks.getCircuitState,
  getProviderHealthInfo: mocks.getProviderHealthInfo,
  recordFailure: mocks.recordFailure,
  recordSuccess: mocks.recordSuccess,
}));

vi.mock("@/repository/message", () => ({
  updateMessageRequestDetails: mocks.updateMessageRequestDetails,
}));

vi.mock("@/lib/endpoint-circuit-breaker", () => ({
  recordEndpointSuccess: vi.fn(async () => {}),
  recordEndpointFailure: vi.fn(async () => {}),
}));

vi.mock("@/app/v1/_lib/proxy/provider-selector", () => ({
  ProxyProviderResolver: {
    pickRandomProviderWithExclusion: mocks.pickRandomProviderWithExclusion,
  },
}));

import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider } from "@/types/provider";

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 1,
    name: "p1",
    url: "https://provider.example.com",
    key: "k",
    providerVendorId: null,
    isEnabled: true,
    weight: 1,
    priority: 0,
    groupPriorities: null,
    costMultiplier: 1,
    groupTag: null,
    providerType: "openai-compatible",
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
    firstByteTimeoutStreamingMs: 30_000,
    streamingIdleTimeoutMs: 10_000,
    requestTimeoutNonStreamingMs: 1_000,
    websiteUrl: null,
    faviconUrl: null,
    cacheTtlPreference: null,
    context1mPreference: null,
    codexReasoningEffortPreference: null,
    codexReasoningSummaryPreference: null,
    codexTextVerbosityPreference: null,
    codexParallelToolCallsPreference: null,
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
    ...overrides,
  };
}

function createSession(): ProxySession {
  const headers = new Headers();
  const session = Object.create(ProxySession.prototype);

  Object.assign(session, {
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("https://example.com/v1/messages"),
    headers,
    originalHeaders: new Headers(headers),
    headerLog: JSON.stringify(Object.fromEntries(headers.entries())),
    request: {
      model: "claude-test",
      log: "(test)",
      message: {
        model: "claude-test",
        messages: [{ role: "user", content: "hi" }],
      },
    },
    userAgent: null,
    context: null,
    clientAbortSignal: null,
    userName: "test-user",
    authState: { success: true, user: null, key: null, apiKey: null },
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
    isHeaderModified: () => false,
  });

  return session as any;
}

describe("ProxyForwarder - fake 200 HTML body", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("200 + text/html 的 HTML 页面应视为失败并切换供应商", async () => {
    const provider1 = createProvider({ id: 1, name: "p1", key: "k1", maxRetryAttempts: 1 });
    const provider2 = createProvider({ id: 2, name: "p2", key: "k2", maxRetryAttempts: 1 });

    const session = createSession();
    session.setProvider(provider1);

    mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(provider2);

    const doForward = vi.spyOn(ProxyForwarder as any, "doForward");

    const htmlBody = [
      "<!doctype html>",
      "<html><head><title>New API</title></head>",
      "<body>blocked</body></html>",
    ].join("\n");
    const okJson = JSON.stringify({ type: "message", content: [{ type: "text", text: "ok" }] });

    doForward.mockResolvedValueOnce(
      new Response(htmlBody, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-length": String(htmlBody.length),
        },
      })
    );

    doForward.mockResolvedValueOnce(
      new Response(okJson, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-length": String(okJson.length),
        },
      })
    );

    const response = await ProxyForwarder.send(session);
    expect(await response.text()).toContain("ok");

    expect(doForward).toHaveBeenCalledTimes(2);
    expect(doForward.mock.calls[0][1].id).toBe(1);
    expect(doForward.mock.calls[1][1].id).toBe(2);

    expect(mocks.pickRandomProviderWithExclusion).toHaveBeenCalledWith(session, [1]);
    expect(mocks.recordFailure).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ message: "FAKE_200_HTML_BODY" })
    );
    expect(mocks.recordSuccess).toHaveBeenCalledWith(2);
    expect(mocks.recordSuccess).not.toHaveBeenCalledWith(1);
  });

  test("缺少 content 字段（missing_content）不应被 JSON 解析 catch 吞掉，应触发切换供应商", async () => {
    const provider1 = createProvider({ id: 1, name: "p1", key: "k1", maxRetryAttempts: 1 });
    const provider2 = createProvider({ id: 2, name: "p2", key: "k2", maxRetryAttempts: 1 });

    const session = createSession();
    session.setProvider(provider1);

    mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(provider2);

    const doForward = vi.spyOn(ProxyForwarder as any, "doForward");

    const missingContentJson = JSON.stringify({ type: "message", content: [] });
    const okJson = JSON.stringify({ type: "message", content: [{ type: "text", text: "ok" }] });

    doForward.mockResolvedValueOnce(
      new Response(missingContentJson, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          // 故意不提供 content-length：覆盖 forwarder 的 clone + JSON 内容结构检查分支
        },
      })
    );

    doForward.mockResolvedValueOnce(
      new Response(okJson, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-length": String(okJson.length),
        },
      })
    );

    const response = await ProxyForwarder.send(session);
    expect(await response.text()).toContain("ok");

    expect(doForward).toHaveBeenCalledTimes(2);
    expect(doForward.mock.calls[0][1].id).toBe(1);
    expect(doForward.mock.calls[1][1].id).toBe(2);

    expect(mocks.pickRandomProviderWithExclusion).toHaveBeenCalledWith(session, [1]);
    expect(mocks.recordFailure).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ reason: "missing_content" })
    );
    expect(mocks.recordSuccess).toHaveBeenCalledWith(2);
    expect(mocks.recordSuccess).not.toHaveBeenCalledWith(1);
  });
});
