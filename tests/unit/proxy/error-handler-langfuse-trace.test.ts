import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emitProxyLangfuseTrace: vi.fn(),
  getCachedSystemSettings: vi.fn(async () => ({
    verboseProviderError: false,
    passThroughUpstreamErrorMessage: false,
  })),
  getErrorOverrideAsync: vi.fn(async () => undefined),
  updateMessageRequestDetails: vi.fn(async () => undefined),
  updateMessageRequestDuration: vi.fn(async () => undefined),
  endRequest: vi.fn(),
}));

vi.mock("@/lib/langfuse/emit-proxy-trace", () => ({
  emitProxyLangfuseTrace: mocks.emitProxyLangfuseTrace,
}));

vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: mocks.getCachedSystemSettings,
}));

vi.mock("@/repository/message", () => ({
  updateMessageRequestDetails: mocks.updateMessageRequestDetails,
  updateMessageRequestDuration: mocks.updateMessageRequestDuration,
}));

vi.mock("@/lib/proxy-status-tracker", () => ({
  ProxyStatusTracker: {
    getInstance: () => ({
      endRequest: mocks.endRequest,
    }),
  },
}));

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

vi.mock("@/app/v1/_lib/proxy/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/v1/_lib/proxy/errors")>();
  return {
    ...actual,
    getErrorOverrideAsync: mocks.getErrorOverrideAsync,
  };
});

import { ProxyErrorHandler } from "@/app/v1/_lib/proxy/error-handler";
import { ProxyError, RateLimitError } from "@/app/v1/_lib/proxy/errors";

function createSession(overrides: Record<string, unknown> = {}): any {
  const requestMessage = {
    model: "claude-sonnet-4-20250514",
    messages: [{ role: "user", content: "hello" }],
  };

  return {
    sessionId: "s_langfuse_error",
    messageContext: {
      id: "msg_langfuse_error",
      user: { id: 42, name: "test-user" },
      key: { name: "test-key" },
    },
    startTime: Date.now() - 25,
    method: "POST",
    originalFormat: "claude",
    request: {
      message: requestMessage,
      model: requestMessage.model,
      log: JSON.stringify(requestMessage),
    },
    headers: new Headers({ "user-agent": "vitest" }),
    provider: {
      id: 7,
      name: "provider-a",
      providerType: "claude",
      swapCacheTtlBilling: false,
    },
    getProviderChain: () => [],
    getCurrentModel: () => requestMessage.model,
    getContext1mApplied: () => false,
    getGroupCostMultiplier: () => 1,
    getSpecialSettings: () => null,
    getEndpoint: () => "/v1/messages",
    getRequestSequence: () => 1,
    ...overrides,
  };
}

describe("ProxyErrorHandler.handle - Langfuse error traces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCachedSystemSettings.mockResolvedValue({
      verboseProviderError: false,
      passThroughUpstreamErrorMessage: false,
    });
    mocks.getErrorOverrideAsync.mockResolvedValue(undefined);
  });

  test("emits trace for local request errors without upstream output", async () => {
    const session = createSession();

    await ProxyErrorHandler.handle(session, new ProxyError("Invalid request: missing model", 400));

    expect(mocks.emitProxyLangfuseTrace).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        responseHeaders: expect.any(Headers),
        responseText: "",
        usageMetrics: null,
        costUsd: undefined,
        statusCode: 400,
        isStreaming: false,
        errorMessage: "Invalid request: missing model",
      })
    );
    expect(mocks.emitProxyLangfuseTrace.mock.calls[0][1].durationMs).toBeGreaterThanOrEqual(0);
  });

  test("emits trace for thrown network errors without upstream output", async () => {
    const session = createSession();

    await ProxyErrorHandler.handle(session, new Error("fetch failed"));

    expect(mocks.emitProxyLangfuseTrace).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        responseText: "",
        statusCode: 500,
        isStreaming: false,
        errorMessage: "fetch failed",
      })
    );
  });

  test("emits trace before database persistence failures can abort handling", async () => {
    const session = createSession();
    mocks.updateMessageRequestDuration.mockRejectedValueOnce(new Error("db down"));

    await expect(ProxyErrorHandler.handle(session, new Error("fetch failed"))).rejects.toThrow(
      "db down"
    );

    expect(mocks.emitProxyLangfuseTrace).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        responseText: "",
        statusCode: 500,
        errorMessage: "fetch failed",
      })
    );
  });

  test("uses upstream raw body as trace output when available", async () => {
    const session = createSession();
    const error = new ProxyError("Upstream failed", 502, {
      body: "sanitized upstream body",
      rawBody: '{"error":{"message":"raw upstream failure"}}',
      rawBodyTruncated: false,
      providerId: 7,
      providerName: "provider-a",
    });

    await ProxyErrorHandler.handle(session, error);

    expect(mocks.emitProxyLangfuseTrace).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        responseText: '{"error":{"message":"raw upstream failure"}}',
        statusCode: 502,
        errorMessage: expect.stringContaining("Upstream failed"),
      })
    );
  });

  test("emits final override response and status after error override is applied", async () => {
    const session = createSession();
    mocks.getErrorOverrideAsync.mockResolvedValueOnce({
      statusCode: 429,
      response: {
        error: {
          message: "masked quota message",
          type: "rate_limit_error",
        },
      },
    });

    const response = await ProxyErrorHandler.handle(
      session,
      new ProxyError("Upstream failed", 502, {
        rawBody: '{"error":{"message":"raw upstream failure"}}',
        providerId: 7,
        providerName: "provider-a",
      })
    );

    expect(response.status).toBe(429);
    expect(mocks.emitProxyLangfuseTrace).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        responseText: expect.stringContaining("masked quota message"),
        statusCode: 429,
        errorMessage: "masked quota message",
      })
    );
    expect(mocks.emitProxyLangfuseTrace.mock.calls[0][1].responseText).not.toContain(
      "raw upstream failure"
    );
  });

  test("falls back to upstream body when raw body is missing", async () => {
    const session = createSession();
    const error = new ProxyError("Upstream failed", 502, {
      body: "sanitized upstream body",
      rawBodyTruncated: false,
      providerId: 7,
      providerName: "provider-a",
    });

    await ProxyErrorHandler.handle(session, error);

    expect(mocks.emitProxyLangfuseTrace).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        responseText: "sanitized upstream body",
        statusCode: 502,
        errorMessage: expect.stringContaining("Upstream failed"),
      })
    );
  });

  test("preserves streaming request context for early error traces", async () => {
    const requestMessage = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
    };
    const session = createSession({
      request: {
        message: requestMessage,
        model: requestMessage.model,
        log: JSON.stringify(requestMessage),
      },
    });

    await ProxyErrorHandler.handle(session, new Error("fetch failed"));

    expect(mocks.emitProxyLangfuseTrace).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        responseText: "",
        statusCode: 500,
        isStreaming: true,
        sseEventCount: 0,
        errorMessage: "fetch failed",
      })
    );
  });

  test("detects Gemini SSE URLs as streaming for early error traces", async () => {
    const session = createSession({
      requestUrl: new URL(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:streamGenerateContent?alt=sse"
      ),
    });

    await ProxyErrorHandler.handle(session, new Error("fetch failed"));

    expect(mocks.emitProxyLangfuseTrace).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        responseText: "",
        statusCode: 500,
        isStreaming: true,
        sseEventCount: 0,
        errorMessage: "fetch failed",
      })
    );
  });

  test("emits trace for rate limit early returns", async () => {
    const session = createSession();

    await ProxyErrorHandler.handle(
      session,
      new RateLimitError("rate_limit_error", "limit exceeded", "daily_quota", 12, 20, null)
    );

    expect(mocks.emitProxyLangfuseTrace).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        responseText: "",
        statusCode: 402,
        isStreaming: false,
        errorMessage: "limit exceeded",
      })
    );
  });
});
