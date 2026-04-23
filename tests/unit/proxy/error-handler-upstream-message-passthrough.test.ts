import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCachedSystemSettings: vi.fn(async () => ({
    verboseProviderError: false,
    passThroughUpstreamErrorMessage: true,
  })),
  getErrorOverrideAsync: vi.fn(async () => undefined),
}));

vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: mocks.getCachedSystemSettings,
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
import { ProxyError } from "@/app/v1/_lib/proxy/errors";

function createSession(): any {
  return {
    sessionId: "s_passthrough",
    messageContext: null,
    startTime: Date.now(),
    getProviderChain: () => [],
    getCurrentModel: () => null,
    getContext1mApplied: () => false,
    getGroupCostMultiplier: () => 1,
    provider: null,
  };
}

function createUpstreamError(overrides: Partial<NonNullable<ProxyError["upstreamError"]>> = {}) {
  return new ProxyError("FAKE_200_JSON_ERROR_MESSAGE_NON_EMPTY", 429, {
    body: "Quota exceeded for key [REDACTED_KEY]",
    providerId: 1,
    providerName: "Anthropic",
    requestId: "req_123",
    rawBody: JSON.stringify({
      error: {
        message:
          "Quota exceeded for key sk-test-1234567890abcdef at https://api.vendor.example/v1/messages request_id=req_abc123",
      },
    }),
    rawBodyTruncated: false,
    statusCodeInferred: true,
    statusCodeInferenceMatcherId: "rate_limit",
    ...overrides,
  });
}

describe("ProxyErrorHandler.handle - upstream message passthrough", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCachedSystemSettings.mockResolvedValue({
      verboseProviderError: false,
      passThroughUpstreamErrorMessage: true,
    });
    mocks.getErrorOverrideAsync.mockResolvedValue(undefined);
  });

  test("passes through sanitized upstream message when enabled", async () => {
    const res = await ProxyErrorHandler.handle(createSession(), createUpstreamError());

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.message).toContain("Quota exceeded");
    expect(body.error.message).toContain("(cch_session_id: s_passthrough)");
    expect(body.error.message).not.toContain("sk-test");
    expect(body.error.message).not.toContain("https://");
    expect(body.error.message).not.toContain("api.vendor.example");
    expect(body.error.message).not.toContain("req_abc123");
    expect(body.error.message).not.toContain("Anthropic");
    expect(body.error.details).toBeUndefined();
    expect(body.request_id).toBeUndefined();
  });

  test("uses generic fallback when passthrough disabled", async () => {
    mocks.getCachedSystemSettings.mockResolvedValue({
      verboseProviderError: false,
      passThroughUpstreamErrorMessage: false,
    });

    const res = await ProxyErrorHandler.handle(createSession(), createUpstreamError());

    const body = await res.json();
    expect(body.error.message).toContain("JSON body contains a non-empty `error.message`");
    expect(body.error.message).not.toContain("Quota exceeded");
    expect(body.error.message).not.toContain("Upstream detail:");
  });

  test("both toggles on: passthrough controls message and verbose controls details", async () => {
    mocks.getCachedSystemSettings.mockResolvedValue({
      verboseProviderError: true,
      passThroughUpstreamErrorMessage: true,
    });

    const res = await ProxyErrorHandler.handle(createSession(), createUpstreamError());
    const body = await res.json();

    expect(body.error.message).toContain("Quota exceeded");
    expect(body.error.details.upstreamError.kind).toBe("fake_200");
    expect(body.request_id).toBe("req_123");
  });

  test("passThrough=false + verbose=true keeps generic message but still returns details and request_id", async () => {
    mocks.getCachedSystemSettings.mockResolvedValue({
      verboseProviderError: true,
      passThroughUpstreamErrorMessage: false,
    });

    const res = await ProxyErrorHandler.handle(createSession(), createUpstreamError());
    const body = await res.json();

    expect(body.error.message).toContain("JSON body contains a non-empty `error.message`");
    expect(body.error.message).not.toContain("Quota exceeded");
    expect(body.error.details.upstreamError.kind).toBe("fake_200");
    expect(body.request_id).toBe("req_123");
  });

  test("override.response remains absolute priority", async () => {
    mocks.getErrorOverrideAsync.mockResolvedValue({
      statusCode: 451,
      response: {
        error: {
          type: "invalid_request_error",
          message: "custom override",
          code: "provider_unavailable",
        },
      },
    });

    const res = await ProxyErrorHandler.handle(createSession(), createUpstreamError());
    const body = await res.json();

    expect(res.status).toBe(451);
    expect(body.error.message).toBe("custom override (cch_session_id: s_passthrough)");
    expect(body.error.message).not.toContain("Quota exceeded");
  });

  test("override.response with empty message still respects passthrough resolver fallback", async () => {
    mocks.getErrorOverrideAsync.mockResolvedValue({
      statusCode: 451,
      response: {
        error: {
          type: "invalid_request_error",
          message: "",
          code: "provider_unavailable",
        },
      },
    });

    mocks.getCachedSystemSettings.mockResolvedValue({
      verboseProviderError: false,
      passThroughUpstreamErrorMessage: false,
    });

    const res = await ProxyErrorHandler.handle(createSession(), createUpstreamError());
    const body = await res.json();

    expect(res.status).toBe(451);
    expect(body.error.message).toContain("JSON body contains a non-empty `error.message`");
    expect(body.error.message).not.toContain("Quota exceeded");
    expect(body.error.message).not.toContain("Upstream detail:");
  });

  test("override.statusCode keeps override status but still resolves passthrough message", async () => {
    mocks.getErrorOverrideAsync.mockResolvedValue({ statusCode: 418, response: null });

    const res = await ProxyErrorHandler.handle(createSession(), createUpstreamError());
    const body = await res.json();

    expect(res.status).toBe(418);
    expect(body.error.message).toContain("Quota exceeded");
  });

  test("unsafe candidate falls back to generic client-safe message", async () => {
    const err = createUpstreamError({
      rawBody: undefined,
      body: "Provider Anthropic returned: overload",
      safeClientMessageCandidate: "Provider Anthropic returned: overload",
    });

    const res = await ProxyErrorHandler.handle(createSession(), err);
    const body = await res.json();

    expect(body.error.message).toContain("JSON body contains a non-empty `error.message`");
    expect(body.error.message).not.toContain("Provider Anthropic");
  });

  test("passThrough=false uses generic fallback for regular upstream ProxyError too", async () => {
    mocks.getCachedSystemSettings.mockResolvedValue({
      verboseProviderError: false,
      passThroughUpstreamErrorMessage: false,
    });

    const err = new ProxyError("Quota exceeded", 429, {
      body: "Quota exceeded",
      providerId: 1,
      providerName: "Anthropic",
      rawBody: JSON.stringify({ error: { message: "Quota exceeded" } }),
    });

    const res = await ProxyErrorHandler.handle(createSession(), err);
    const body = await res.json();

    expect(body.error.message).toContain("上游服务当前限流，请稍后重试");
    expect(body.error.message).not.toContain("Quota exceeded");
  });
});
