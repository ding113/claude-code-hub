import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    getCachedSystemSettings: vi.fn(async () => ({ verboseProviderError: false }) as any),
    getErrorOverrideAsync: vi.fn(async () => undefined),
  };
});

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
import { EmptyResponseError, ProxyError } from "@/app/v1/_lib/proxy/errors";

function createSession(): any {
  return {
    sessionId: null,
    messageContext: null,
    startTime: Date.now(),
    getProviderChain: () => [],
    getCurrentModel: () => null,
    getContext1mApplied: () => false,
    provider: null,
  };
}

describe("ProxyErrorHandler.handle - verboseProviderError details", () => {
  beforeEach(() => {
    mocks.getCachedSystemSettings.mockResolvedValue({ verboseProviderError: false } as any);
    mocks.getErrorOverrideAsync.mockResolvedValue(undefined);
  });

  test("verboseProviderError=false 时，不应附带 fake-200 raw body/details", async () => {
    const session = createSession();
    const err = new ProxyError("FAKE_200_JSON_ERROR_NON_EMPTY", 502, {
      body: "sanitized",
      providerId: 1,
      providerName: "p1",
      requestId: "req_123",
      rawBody: '{"error":"boom"}',
      rawBodyTruncated: false,
    });

    const res = await ProxyErrorHandler.handle(session, err);
    expect(res.status).toBe(502);

    const body = await res.json();
    expect(body.error.details).toBeUndefined();
    expect(body.request_id).toBeUndefined();
  });

  test("verboseProviderError=true 时，fake-200 应返回详细报告与上游原文", async () => {
    mocks.getCachedSystemSettings.mockResolvedValue({ verboseProviderError: true } as any);

    const session = createSession();
    const err = new ProxyError("FAKE_200_HTML_BODY", 502, {
      body: "redacted snippet",
      providerId: 1,
      providerName: "p1",
      requestId: "req_123",
      rawBody: "<!doctype html><html><body>blocked</body></html>",
      rawBodyTruncated: false,
    });

    const res = await ProxyErrorHandler.handle(session, err);
    expect(res.status).toBe(502);

    const body = await res.json();
    expect(body.request_id).toBe("req_123");
    expect(body.error.details).toEqual({
      upstreamError: {
        kind: "fake_200",
        code: "FAKE_200_HTML_BODY",
        clientSafeMessage: expect.any(String),
        rawBody: "<!doctype html><html><body>blocked</body></html>",
        rawBodyTruncated: false,
      },
    });
  });

  test("verboseProviderError=true 时，rawBody 应做基础脱敏（避免泄露 token/key）", async () => {
    mocks.getCachedSystemSettings.mockResolvedValue({ verboseProviderError: true } as any);

    const session = createSession();
    const err = new ProxyError("FAKE_200_HTML_BODY", 502, {
      body: "redacted snippet",
      providerId: 1,
      providerName: "p1",
      requestId: "req_123",
      rawBody:
        '<!doctype html><html><body>Authorization: Bearer abc123 sk-1234567890abcdef1234567890 test@example.com</body></html>',
      rawBodyTruncated: false,
    });

    const res = await ProxyErrorHandler.handle(session, err);
    expect(res.status).toBe(502);

    const body = await res.json();
    expect(body.request_id).toBe("req_123");
    expect(body.error.details.upstreamError.kind).toBe("fake_200");

    const rawBody = body.error.details.upstreamError.rawBody as string;
    expect(rawBody).toContain("Bearer [REDACTED]");
    expect(rawBody).toContain("[REDACTED_KEY]");
    expect(rawBody).toContain("[EMAIL]");
    expect(rawBody).not.toContain("Bearer abc123");
    expect(rawBody).not.toContain("sk-1234567890abcdef1234567890");
    expect(rawBody).not.toContain("test@example.com");
  });

  test("verboseProviderError=true 时，空响应错误也应返回详细报告（rawBody 为空字符串）", async () => {
    mocks.getCachedSystemSettings.mockResolvedValue({ verboseProviderError: true } as any);

    const session = createSession();
    const err = new EmptyResponseError(1, "p1", "empty_body");

    const res = await ProxyErrorHandler.handle(session, err);
    expect(res.status).toBe(502);

    const body = await res.json();
    expect(body.error.details).toEqual({
      upstreamError: {
        kind: "empty_response",
        reason: "empty_body",
        clientSafeMessage: "Empty response: Response body is empty",
        rawBody: "",
        rawBodyTruncated: false,
      },
    });
  });

  test("有 error override 时，verbose details 不应覆盖覆写逻辑（优先级更低）", async () => {
    mocks.getCachedSystemSettings.mockResolvedValue({ verboseProviderError: true } as any);
    mocks.getErrorOverrideAsync.mockResolvedValue({ response: null, statusCode: 418 });

    const session = createSession();
    const err = new ProxyError("FAKE_200_JSON_ERROR_NON_EMPTY", 502, {
      body: "sanitized",
      providerId: 1,
      providerName: "p1",
      requestId: "req_123",
      rawBody: '{"error":"boom"}',
      rawBodyTruncated: false,
    });

    const res = await ProxyErrorHandler.handle(session, err);
    expect(res.status).toBe(418);

    const body = await res.json();
    expect(body.error.details).toBeUndefined();
  });
});
