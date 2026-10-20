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
    passThroughUpstreamErrorMessage: false,
  })),
}));

vi.mock("@/lib/error-rule-detector", () => ({
  errorRuleDetector: { detectAsync: mocks.detectAsync },
}));

vi.mock("@/lib/langfuse/emit-proxy-trace", () => ({
  emitProxyLangfuseTrace: mocks.emitProxyLangfuseTrace,
}));

vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: mocks.getCachedSystemSettings,
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

type SessionInput = {
  readonly stream?: boolean;
  readonly url?: string;
};

async function createSession(input: SessionInput = {}): Promise<ProxySession> {
  const request = new Request(input.url ?? "https://hub.test/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "vitest" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "hello" }],
      stream: input.stream ?? false,
    }),
  });
  return ProxySession.fromContext(new Context(request));
}

describe("ProxyErrorHandler.handle Langfuse traces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.detectAsync.mockResolvedValue({ matched: false });
    mocks.getCachedSystemSettings.mockResolvedValue({
      verboseProviderError: false,
      passThroughUpstreamErrorMessage: false,
    });
  });

  test("emits an empty-output trace for a local request error", async () => {
    const session = await createSession();

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
    const trace = mocks.emitProxyLangfuseTrace.mock.calls[0]?.[1];
    expect(trace?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("emits an empty-output trace for a thrown network error", async () => {
    const session = await createSession();

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

  test("prefers the raw upstream body as trace output", async () => {
    const session = await createSession();
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

  test("falls back to the sanitized upstream body when no raw body exists", async () => {
    const session = await createSession();
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

  test("preserves body-declared streaming context on an early error", async () => {
    const session = await createSession({ stream: true });

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

  test("detects a Gemini SSE URL as streaming on an early error", async () => {
    const session = await createSession({
      url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:streamGenerateContent?alt=sse",
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
});
