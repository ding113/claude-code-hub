import { Context } from "hono";
import { DrizzleQueryError } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  ProxyErrorHandler,
  resolveFinalClientErrorMessage,
} from "@/app/v1/_lib/proxy/error-handler";
import { ProxyError } from "@/app/v1/_lib/proxy/errors";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import { DbPoolAdmissionError } from "@/drizzle/admitted-client";
import type { ErrorDetectionResult } from "@/lib/error-rule-detector";

const mocks = vi.hoisted(() => ({
  detectAsync: vi.fn<(content: string) => Promise<ErrorDetectionResult>>(),
  emitProxyLangfuseTrace: vi.fn(),
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
  return ProxySession.fromContext(new Context(request));
}

describe("resolveFinalClientErrorMessage", () => {
  test("sanitizes a pass-through message extracted from an upstream body", () => {
    const error = new ProxyError("Quota exceeded", 429, {
      body: "Quota exceeded for api_key=[REDACTED_KEY]",
      rawBody: JSON.stringify({
        error: {
          message:
            "Quota exceeded for api_key=sk-secret-12345678 at https://api.vendor.example/v1 request_id=req_abc123",
        },
      }),
      providerName: "provider-a",
    });

    const message = resolveFinalClientErrorMessage({
      error,
      currentFallbackMessage: "Quota exceeded Upstream detail: provider-a",
      settings: { passThroughUpstreamErrorMessage: true },
      override: null,
    });

    expect(message).toContain("Quota exceeded");
    expect(message).not.toContain("sk-secret");
    expect(message).not.toContain("https://");
    expect(message).not.toContain("api.vendor.example");
    expect(message).not.toContain("req_abc123");
    expect(message).not.toContain("provider-a");
  });

  test("uses a safe candidate when the raw body has no extractable error", () => {
    const error = new ProxyError("Rate limit", 429, {
      body: "Rate limit exceeded for this endpoint",
      rawBody: "temporary plain-text response",
      safeClientMessageCandidate: "Rate limit exceeded for this endpoint",
      providerName: "relay-a",
    });

    const message = resolveFinalClientErrorMessage({
      error,
      currentFallbackMessage: "Rate limit",
      settings: { passThroughUpstreamErrorMessage: true },
      override: null,
    });

    expect(message).toBe("Rate limit exceeded for this endpoint");
  });

  test.each([
    [400, "上游请求参数无效，请检查后重试"],
    [401, "上游鉴权失败，请稍后重试"],
    [429, "上游服务当前限流，请稍后重试"],
    [503, "上游服务暂时不可用，请稍后重试"],
  ])("maps status %i to a generic message when pass-through is disabled", (status, expected) => {
    const error = new ProxyError("sensitive upstream failure", status, {
      body: "sensitive upstream failure",
    });

    const message = resolveFinalClientErrorMessage({
      error,
      currentFallbackMessage: "sensitive upstream failure Upstream detail: relay-a",
      settings: { passThroughUpstreamErrorMessage: false },
      override: null,
    });

    expect(message).toBe(expected);
  });

  test("falls back when every upstream candidate exposes a provider label", () => {
    const error = new ProxyError("Provider relay-a returned: overload", 503, {
      body: "Provider relay-a returned: overload",
      safeClientMessageCandidate: "Provider relay-a returned: overload",
      providerName: "relay-a",
    });

    const message = resolveFinalClientErrorMessage({
      error,
      currentFallbackMessage: "Provider relay-a returned: overload",
      settings: { passThroughUpstreamErrorMessage: true },
      override: null,
    });

    expect(message).toBe("上游服务暂时不可用，请稍后重试");
  });

  test("preserves an explicit override message", () => {
    const message = resolveFinalClientErrorMessage({
      error: new ProxyError("Upstream failed", 502, { body: "Upstream failed" }),
      currentFallbackMessage: "custom override",
      settings: { passThroughUpstreamErrorMessage: false },
      override: {
        statusCode: 451,
        response: { error: { type: "invalid_request_error", message: "custom override" } },
      },
    });

    expect(message).toBe("custom override");
  });
});

describe("ProxyErrorHandler.handle client message", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.detectAsync.mockResolvedValue({ matched: false });
    mocks.getCachedSystemSettings.mockResolvedValue({
      verboseProviderError: false,
      passThroughUpstreamErrorMessage: true,
    });
  });

  test("returns only the sanitized upstream message to the client", async () => {
    const session = await createSession();
    session.setSessionId("s_client_message");
    const error = new ProxyError("Quota exceeded", 429, {
      body: "Quota exceeded for api_key=[REDACTED_KEY]",
      rawBody: JSON.stringify({
        error: {
          message:
            "Quota exceeded for api_key=sk-secret-12345678 at https://api.vendor.example/v1 request_id=req_abc123",
        },
      }),
      providerName: "provider-a",
    });

    const response = await ProxyErrorHandler.handle(session, error);
    const responseText = await response.text();

    expect(response.status).toBe(429);
    expect(responseText).toContain("Quota exceeded");
    expect(responseText).toContain("cch_session_id: s_client_message");
    expect(responseText).not.toContain("sk-secret");
    expect(responseText).not.toContain("https://");
    expect(responseText).not.toContain("req_abc123");
    expect(responseText).not.toContain("provider-a");
  });

  test("returns a fixed 503 without exposing an admission query or parameters", async () => {
    const session = await createSession();
    const canary = "sk-admission-secret-canary";
    const error = new DrizzleQueryError(
      "select * from keys where key = $1",
      [canary],
      new DbPoolAdmissionError("control", 32)
    );

    const response = await ProxyErrorHandler.handle(session, error);
    const responseText = await response.text();

    expect(response.status).toBe(503);
    expect(responseText).not.toContain(canary);
    expect(responseText).not.toContain("select * from keys");
    expect(responseText).not.toContain("params:");
    expect(mocks.getCachedSystemSettings).not.toHaveBeenCalled();
    expect(mocks.emitProxyLangfuseTrace).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        errorMessage: expect.not.stringContaining(canary),
        statusCode: 503,
      })
    );
  });

  test("sanitizes ordinary Drizzle query failures before HTTP and Langfuse", async () => {
    const session = await createSession();
    const canary = "sk-query-secret-canary";
    const cause = Object.assign(new Error("canceling statement due to lock timeout"), {
      code: "55P03",
    });
    const error = new DrizzleQueryError("update keys set key = $1", [canary], cause);

    const response = await ProxyErrorHandler.handle(session, error);
    const responseText = await response.text();
    const traceArguments = JSON.stringify(mocks.emitProxyLangfuseTrace.mock.calls);

    expect(response.status).toBe(500);
    expect(responseText).not.toContain(canary);
    expect(responseText).not.toContain("update keys");
    expect(responseText).not.toContain("params:");
    expect(traceArguments).not.toContain(canary);
    expect(traceArguments).not.toContain("update keys");
    expect(mocks.getCachedSystemSettings).not.toHaveBeenCalled();
  });
});
