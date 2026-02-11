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
    getPreferredProviderEndpoints: vi.fn(async () => []),
    getEndpointFilterStats: vi.fn(async () => null),
    recordEndpointSuccess: vi.fn(async () => {}),
    recordEndpointFailure: vi.fn(async () => {}),
    isVendorTypeCircuitOpen: vi.fn(async () => false),
    recordVendorTypeAllEndpointsTimeout: vi.fn(async () => {}),
    // ErrorCategory.PROVIDER_ERROR
    categorizeErrorAsync: vi.fn(async () => 0),
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

vi.mock("@/lib/provider-endpoints/endpoint-selector", () => ({
  getPreferredProviderEndpoints: mocks.getPreferredProviderEndpoints,
  getEndpointFilterStats: mocks.getEndpointFilterStats,
}));

vi.mock("@/lib/endpoint-circuit-breaker", () => ({
  recordEndpointSuccess: mocks.recordEndpointSuccess,
  recordEndpointFailure: mocks.recordEndpointFailure,
}));

vi.mock("@/lib/circuit-breaker", () => ({
  getCircuitState: mocks.getCircuitState,
  getProviderHealthInfo: mocks.getProviderHealthInfo,
  recordFailure: mocks.recordFailure,
  recordSuccess: mocks.recordSuccess,
}));

vi.mock("@/lib/vendor-type-circuit-breaker", () => ({
  isVendorTypeCircuitOpen: mocks.isVendorTypeCircuitOpen,
  recordVendorTypeAllEndpointsTimeout: mocks.recordVendorTypeAllEndpointsTimeout,
}));

vi.mock("@/repository/message", () => ({
  updateMessageRequestDetails: mocks.updateMessageRequestDetails,
}));

vi.mock("@/app/v1/_lib/proxy/provider-selector", () => ({
  ProxyProviderResolver: {
    pickRandomProviderWithExclusion: mocks.pickRandomProviderWithExclusion,
  },
}));

vi.mock("@/app/v1/_lib/proxy/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/v1/_lib/proxy/errors")>();
  return {
    ...actual,
    categorizeErrorAsync: mocks.categorizeErrorAsync,
  };
});

import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ProxyError } from "@/app/v1/_lib/proxy/errors";
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
    providerType: "claude",
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

  return session as ProxySession;
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
    const failure1 = mocks.recordFailure.mock.calls[0]?.[1];
    expect(failure1).toBeInstanceOf(ProxyError);
    expect((failure1 as ProxyError).getClientSafeMessage()).toContain("HTML document");
    expect((failure1 as ProxyError).getClientSafeMessage()).toContain("Upstream detail:");
    expect(mocks.recordSuccess).toHaveBeenCalledWith(2);
    expect(mocks.recordSuccess).not.toHaveBeenCalledWith(1);
  });

  test("200 + text/html 但 body 是 JSON error 也应视为失败并切换供应商", async () => {
    const provider1 = createProvider({ id: 1, name: "p1", key: "k1", maxRetryAttempts: 1 });
    const provider2 = createProvider({ id: 2, name: "p2", key: "k2", maxRetryAttempts: 1 });

    const session = createSession();
    session.setProvider(provider1);

    mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(provider2);

    const doForward = vi.spyOn(ProxyForwarder as any, "doForward");

    const jsonErrorBody = JSON.stringify({ error: "upstream blocked" });
    const okJson = JSON.stringify({ type: "message", content: [{ type: "text", text: "ok" }] });

    doForward.mockResolvedValueOnce(
      new Response(jsonErrorBody, {
        status: 200,
        headers: {
          // 故意使用 text/html：模拟部分上游 Content-Type 错配但 body 仍为错误 JSON 的情况
          "content-type": "text/html; charset=utf-8",
          "content-length": String(jsonErrorBody.length),
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
      expect.objectContaining({ message: "FAKE_200_JSON_ERROR_NON_EMPTY" })
    );
    const failure2 = mocks.recordFailure.mock.calls[0]?.[1];
    expect(failure2).toBeInstanceOf(ProxyError);
    expect((failure2 as ProxyError).getClientSafeMessage()).toContain("JSON body");
    expect((failure2 as ProxyError).getClientSafeMessage()).toContain("`error`");
    expect((failure2 as ProxyError).getClientSafeMessage()).toContain("upstream blocked");
    expect((failure2 as ProxyError).upstreamError?.rawBody).toBe(jsonErrorBody);
    expect((failure2 as ProxyError).upstreamError?.rawBodyTruncated).toBe(false);
    expect(mocks.recordSuccess).toHaveBeenCalledWith(2);
    expect(mocks.recordSuccess).not.toHaveBeenCalledWith(1);
  });

  test("200 + application/json 且有 Content-Length 的 JSON error 也应视为失败并切换供应商", async () => {
    const provider1 = createProvider({ id: 1, name: "p1", key: "k1", maxRetryAttempts: 1 });
    const provider2 = createProvider({ id: 2, name: "p2", key: "k2", maxRetryAttempts: 1 });

    const session = createSession();
    session.setProvider(provider1);

    mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(provider2);

    const doForward = vi.spyOn(ProxyForwarder as any, "doForward");

    const jsonErrorBody = JSON.stringify({ error: "upstream blocked" });
    const okJson = JSON.stringify({ type: "message", content: [{ type: "text", text: "ok" }] });

    doForward.mockResolvedValueOnce(
      new Response(jsonErrorBody, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-length": String(jsonErrorBody.length),
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
      expect.objectContaining({ message: "FAKE_200_JSON_ERROR_NON_EMPTY" })
    );
    const failure3 = mocks.recordFailure.mock.calls[0]?.[1];
    expect(failure3).toBeInstanceOf(ProxyError);
    expect((failure3 as ProxyError).getClientSafeMessage()).toContain("JSON body");
    expect((failure3 as ProxyError).getClientSafeMessage()).toContain("`error`");
    expect((failure3 as ProxyError).getClientSafeMessage()).toContain("upstream blocked");
    expect((failure3 as ProxyError).upstreamError?.rawBody).toBe(jsonErrorBody);
    expect((failure3 as ProxyError).upstreamError?.rawBodyTruncated).toBe(false);
    expect(mocks.recordSuccess).toHaveBeenCalledWith(2);
    expect(mocks.recordSuccess).not.toHaveBeenCalledWith(1);
  });

  test("200 + 非法 Content-Length 时应按缺失处理，避免漏检 HTML 假200", async () => {
    const provider1 = createProvider({ id: 1, name: "p1", key: "k1", maxRetryAttempts: 1 });
    const provider2 = createProvider({ id: 2, name: "p2", key: "k2", maxRetryAttempts: 1 });

    const session = createSession();
    session.setProvider(provider1);

    mocks.pickRandomProviderWithExclusion.mockResolvedValueOnce(provider2);

    const doForward = vi.spyOn(ProxyForwarder as any, "doForward");

    const htmlErrorBody = "<!doctype html><html><body>blocked</body></html>";
    const okJson = JSON.stringify({ type: "message", content: [{ type: "text", text: "ok" }] });

    doForward.mockResolvedValueOnce(
      new Response(htmlErrorBody, {
        status: 200,
        headers: {
          // 故意不提供 html/json 的 Content-Type，覆盖“仅靠 body 嗅探”的假200检测分支
          "content-type": "text/plain; charset=utf-8",
          // 非法 Content-Length：parseInt("12abc") 会返回 12；修复后应视为非法并进入 body 检查分支
          "content-length": "12abc",
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

    const failure = mocks.recordFailure.mock.calls[0]?.[1];
    expect(failure).toBeInstanceOf(ProxyError);
    expect((failure as ProxyError).upstreamError?.rawBody).toBe(htmlErrorBody);
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
