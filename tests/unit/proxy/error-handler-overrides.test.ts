import { Context } from "hono";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ProxyErrorHandler } from "@/app/v1/_lib/proxy/error-handler";
import { ProxyError } from "@/app/v1/_lib/proxy/errors";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { ErrorDetectionResult } from "@/lib/error-rule-detector";
import type { emitProxyLangfuseTrace } from "@/lib/langfuse/emit-proxy-trace";

const mocks = vi.hoisted(() => ({
  detectAsync: vi.fn<(content: string) => Promise<ErrorDetectionResult>>(),
  emitProxyLangfuseTrace: vi.fn<typeof emitProxyLangfuseTrace>(),
  getCachedSystemSettings: vi.fn(async () => ({
    verboseProviderError: false,
    passThroughUpstreamErrorMessage: true,
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

async function createSession(): Promise<ProxySession> {
  const request = new Request("https://hub.test/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "hello" }],
    }),
  });
  const session = await ProxySession.fromContext(new Context(request));
  session.setSessionId("s_override");
  return session;
}

function createUpstreamError(): ProxyError {
  return new ProxyError("Upstream failed", 502, {
    body: "Quota exceeded",
    rawBody: '{"error":{"message":"raw upstream failure"}}',
    providerId: 7,
    providerName: "provider-a",
    requestId: "req_upstream",
    safeClientMessageCandidate: "Quota exceeded",
  });
}

describe("ProxyErrorHandler.handle overrides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.detectAsync.mockResolvedValue({ matched: false });
    mocks.getCachedSystemSettings.mockResolvedValue({
      verboseProviderError: false,
      passThroughUpstreamErrorMessage: true,
    });
  });

  test("applies an explicit response and status before upstream content", async () => {
    mocks.detectAsync.mockResolvedValue({
      matched: true,
      overrideStatusCode: 429,
      overrideResponse: {
        error: {
          type: "rate_limit_error",
          message: "masked quota message",
          code: "provider_unavailable",
        },
      },
    });
    const session = await createSession();

    const response = await ProxyErrorHandler.handle(session, createUpstreamError());
    const responseText = await response.text();

    expect(response.status).toBe(429);
    expect(responseText).toContain("masked quota message (cch_session_id: s_override)");
    expect(responseText).toContain("provider_unavailable");
    expect(responseText).not.toContain("raw upstream failure");
    expect(responseText).not.toContain("req_upstream");
    expect(mocks.emitProxyLangfuseTrace).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        responseText: expect.stringContaining("masked quota message"),
        statusCode: 429,
        errorMessage: "masked quota message",
      })
    );
    const trace = mocks.emitProxyLangfuseTrace.mock.calls[0]?.[1];
    expect(trace?.responseText).not.toContain("raw upstream failure");
  });

  test("keeps the upstream status for a response-only override", async () => {
    mocks.detectAsync.mockResolvedValue({
      matched: true,
      overrideResponse: {
        type: "error",
        error: { type: "invalid_request_error", message: "custom response" },
      },
    });
    const session = await createSession();

    const response = await ProxyErrorHandler.handle(session, createUpstreamError());
    const responseText = await response.text();

    expect(response.status).toBe(502);
    expect(responseText).toContain("custom response (cch_session_id: s_override)");
    expect(responseText).not.toContain("req_upstream");
  });

  test("applies a status-only override while retaining the resolved client message", async () => {
    mocks.detectAsync.mockResolvedValue({ matched: true, overrideStatusCode: 418 });
    const session = await createSession();

    const response = await ProxyErrorHandler.handle(session, createUpstreamError());
    const responseText = await response.text();

    expect(response.status).toBe(418);
    expect(responseText).toContain("raw upstream failure (cch_session_id: s_override)");
    expect(responseText).toContain('"request_id":"req_upstream"');
    expect(responseText).not.toContain("provider-a");
  });

  test("falls back to the upstream status when an override status is invalid", async () => {
    mocks.detectAsync.mockResolvedValue({ matched: true, overrideStatusCode: 200 });
    const session = await createSession();

    const response = await ProxyErrorHandler.handle(session, createUpstreamError());

    expect(response.status).toBe(502);
    expect(mocks.emitProxyLangfuseTrace).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ statusCode: 502 })
    );
  });

  test("resolves a blank override message through the client-safe fallback", async () => {
    mocks.detectAsync.mockResolvedValue({
      matched: true,
      overrideStatusCode: 451,
      overrideResponse: {
        error: { type: "invalid_request_error", message: "", code: "provider_unavailable" },
      },
    });
    mocks.getCachedSystemSettings.mockResolvedValue({
      verboseProviderError: false,
      passThroughUpstreamErrorMessage: false,
    });
    const session = await createSession();

    const response = await ProxyErrorHandler.handle(session, createUpstreamError());
    const responseText = await response.text();

    expect(response.status).toBe(451);
    expect(responseText).toContain("上游服务暂时不可用，请稍后重试");
    expect(responseText).not.toContain("Quota exceeded");
    expect(responseText).not.toContain("raw upstream failure");
  });

  test("passes through upstream error when regex rule matches without overrideResponse", async () => {
    mocks.detectAsync.mockResolvedValue({
      matched: true,
      ruleId: 624,
      category: "invalid_request",
      pattern: "invalid_request_error",
      matchType: "regex",
    });
    mocks.getCachedSystemSettings.mockResolvedValue({
      verboseProviderError: false,
      passThroughUpstreamErrorMessage: false,
    });
    const session = await createSession();
    const upstreamResponse = new Response(
      JSON.stringify({
        error: {
          message: "Client not allowed (detected: Anthropic/JS 0.73.0)",
          type: "invalid_request_error",
        },
      }),
      {
        status: 400,
        headers: { "content-type": "application/json" },
      }
    );
    const error = await ProxyError.fromUpstreamResponse(upstreamResponse, {
      id: 89,
      name: "cpa-us-gemini",
    });

    const response = await ProxyErrorHandler.handle(session, error);
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(responseText).toContain(
      "Client not allowed (detected: Anthropic/JS 0.73.0) (cch_session_id: s_override)"
    );
    expect(responseText).not.toContain("cpa-us-gemini");
    expect(responseText).not.toContain("上游请求参数无效");
  });

  test("does not treat a rejected malformed override_response as an intentional pass-through whitelist", async () => {
    mocks.detectAsync.mockResolvedValue({
      matched: true,
      ruleId: 625,
      category: "invalid_request",
      pattern: "invalid_request_error",
      matchType: "regex",
      hasConfiguredOverrideResponse: true,
    });
    mocks.getCachedSystemSettings.mockResolvedValue({
      verboseProviderError: false,
      passThroughUpstreamErrorMessage: false,
    });
    const session = await createSession();
    const upstreamResponse = new Response(
      JSON.stringify({
        error: {
          message: "raw upstream failure that should stay hidden when override was malformed",
          type: "invalid_request_error",
        },
      }),
      {
        status: 400,
        headers: { "content-type": "application/json" },
      }
    );
    const error = await ProxyError.fromUpstreamResponse(upstreamResponse, {
      id: 89,
      name: "cpa-us-gemini",
    });

    const response = await ProxyErrorHandler.handle(session, error);
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(responseText).toContain("上游请求参数无效，请检查后重试");
    expect(responseText).not.toContain("raw upstream failure that should stay hidden");
  });
});
