import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import { emitProxyLangfuseTrace } from "@/lib/langfuse/emit-proxy-trace";
import * as streamFinalOutput from "@/lib/langfuse/stream-final-output";

const { mockTraceProxyRequest, mockTraceModuleLoaded, mockLoggerWarn } = vi.hoisted(() => ({
  mockTraceProxyRequest: vi.fn().mockResolvedValue(undefined),
  mockTraceModuleLoaded: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock("@/lib/langfuse/trace-proxy-request", () => {
  mockTraceModuleLoaded();
  return { traceProxyRequest: mockTraceProxyRequest };
});

vi.mock("@/lib/logger", () => ({
  logger: { warn: mockLoggerWarn },
}));

function createMockSession(originalFormat: "openai" | "claude" = "openai"): ProxySession {
  const startTime = 1_700_000_000_000;
  const session = {
    startTime,
    method: "POST",
    headers: new Headers({ "content-type": "application/json" }),
    request: {
      message: { model: "gpt-test", messages: [{ role: "user", content: "hello" }] },
      model: "gpt-test",
      log: "",
      note: undefined,
    },
    originalFormat,
    userAgent: "test-client",
    sessionId: "session-test",
    clientIp: "127.0.0.1",
    provider: null,
    messageContext: null,
    ttfbMs: null,
    forwardStartTime: startTime + 1,
    forwardedRequestBody: null,
    getEndpoint: () => "/v1/chat/completions",
    getRequestSequence: () => 1,
    getMessagesLength: () => 1,
    getCurrentModel: () => "gpt-test",
    getOriginalModel: () => "gpt-test",
    isModelRedirected: () => false,
    getProviderChain: () => [],
    getSpecialSettings: () => null,
    getCacheTtlResolved: () => null,
    getContext1mApplied: () => false,
  } as ProxySession;

  return session;
}

function chatFrame(content: string, extra: Record<string, unknown> = {}): string {
  return `data: ${JSON.stringify({
    id: "chat-test",
    object: "chat.completion.chunk",
    created: 1_700_000_000,
    model: "gpt-test",
    choices: [{ index: 0, delta: { content }, ...extra }],
  })}\n\n`;
}

function waitForTrace(): Promise<void> {
  return vi.waitFor(() => expect(mockTraceProxyRequest).toHaveBeenCalled());
}

describe("emitProxyLangfuseTrace", () => {
  const originalPublicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const originalSecretKey = process.env.LANGFUSE_SECRET_KEY;

  beforeEach(() => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    mockTraceProxyRequest.mockClear();
    mockTraceModuleLoaded.mockClear();
    mockLoggerWarn.mockClear();
  });

  afterEach(() => {
    if (originalPublicKey === undefined) delete process.env.LANGFUSE_PUBLIC_KEY;
    else process.env.LANGFUSE_PUBLIC_KEY = originalPublicKey;
    if (originalSecretKey === undefined) delete process.env.LANGFUSE_SECRET_KEY;
    else process.env.LANGFUSE_SECRET_KEY = originalSecretKey;
    vi.restoreAllMocks();
  });

  test("finalizes a complete Chat response before the raw response cap", async () => {
    const leadingFrames = Array.from({ length: 7_000 }, () => chatFrame(""));
    const trailingFrames = Array.from({ length: 7_000 }, () => chatFrame(""));
    const responseText = [
      ...leadingFrames,
      chatFrame("meaningful delta beyond the old raw head/tail window", {
        delta: { content: "meaningful delta beyond the old raw head/tail window" },
      }),
      ...trailingFrames,
      chatFrame("", { finish_reason: "stop" }),
      "data: [DONE]\n\n",
    ].join("");

    emitProxyLangfuseTrace(createMockSession("openai"), {
      responseHeaders: new Headers(),
      responseText,
      usageMetrics: null,
      costUsd: "0.25",
      costBreakdown: { total: 0.25 },
      statusCode: 200,
      durationMs: 25,
      isStreaming: true,
      sseEventCount: 14_002,
      errorMessage: "completed with trace metadata",
    });

    await waitForTrace();

    const traceContext = mockTraceProxyRequest.mock.calls[0]?.[0];
    expect(traceContext.finalResponseOutput).toEqual({
      kind: "final",
      value: {
        id: "chat-test",
        object: "chat.completion",
        created: 1_700_000_000,
        model: "gpt-test",
        choices: [
          {
            index: 0,
            message: {
              content: "meaningful delta beyond the old raw head/tail window",
            },
            finish_reason: "stop",
            logprobs: null,
          },
        ],
      },
    });
    expect(traceContext).not.toHaveProperty("responseText");
    expect(traceContext).toEqual(
      expect.objectContaining({
        responseHeaders: expect.any(Headers),
        durationMs: 25,
        statusCode: 200,
        isStreaming: true,
        usageMetrics: null,
        costUsd: "0.25",
        costBreakdown: { total: 0.25 },
        sseEventCount: 14_002,
        errorMessage: "completed with trace metadata",
      })
    );
  });

  test("does no finalization or dynamic tracing work when credentials are missing", () => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    const finalizeSpy = vi.spyOn(streamFinalOutput, "finalizeStreamOutputForClient");

    emitProxyLangfuseTrace(createMockSession(), {
      responseHeaders: new Headers(),
      responseText: 'data: {"choices":[]}\n\n',
      usageMetrics: null,
      costUsd: undefined,
      statusCode: 200,
      durationMs: 25,
      isStreaming: true,
    });

    expect(finalizeSpy).not.toHaveBeenCalled();
    expect(mockTraceModuleLoaded).not.toHaveBeenCalled();
    expect(mockTraceProxyRequest).not.toHaveBeenCalled();
  });

  test("uses a bounded diagnostic when finalization throws without blocking tracing", async () => {
    const finalizeSpy = vi
      .spyOn(streamFinalOutput, "finalizeStreamOutputForClient")
      .mockImplementation(() => {
        throw new Error("unexpected finalizer failure");
      });

    expect(() =>
      emitProxyLangfuseTrace(createMockSession(), {
        responseHeaders: new Headers(),
        responseText: 'data: {"choices":[]}\n\n',
        usageMetrics: null,
        costUsd: undefined,
        statusCode: 200,
        durationMs: 25,
        isStreaming: true,
      })
    ).not.toThrow();

    await waitForTrace();

    const traceContext = mockTraceProxyRequest.mock.calls[0]?.[0];
    expect(finalizeSpy).toHaveBeenCalledWith('data: {"choices":[]}\n\n', "openai", true);
    expect(traceContext.finalResponseOutput).toEqual({
      kind: "final_output_unavailable",
      reason: "stream_error",
      eventCount: 0,
    });
    expect(traceContext).not.toHaveProperty("responseText");
  });

  test("keeps the existing bounded text path for non-stream responses", async () => {
    const finalizeSpy = vi.spyOn(streamFinalOutput, "finalizeStreamOutputForClient");
    const responseText = "x".repeat(1024 * 1024 + 1);

    emitProxyLangfuseTrace(createMockSession("claude"), {
      responseHeaders: new Headers(),
      responseText,
      usageMetrics: null,
      costUsd: undefined,
      statusCode: 200,
      durationMs: 25,
      isStreaming: false,
    });

    await waitForTrace();

    const traceContext = mockTraceProxyRequest.mock.calls[0]?.[0];
    const expectedResponseText = `${"x".repeat(128 * 1024)}\n\n[langfuse_response_truncated]\n\n${"x".repeat(128 * 1024)}`;
    expect(finalizeSpy).not.toHaveBeenCalled();
    expect(traceContext.responseText).toBe(expectedResponseText);
    expect(traceContext).not.toHaveProperty("finalResponseOutput");
  });

  test("never lets a synchronous session snapshot failure escape", () => {
    const session = {
      getProviderChain() {
        throw new Error("snapshot exploded");
      },
    } as unknown as ProxySession;

    expect(() =>
      emitProxyLangfuseTrace(session, {
        responseHeaders: new Headers(),
        responseText: "",
        usageMetrics: null,
        costUsd: undefined,
        statusCode: 500,
        durationMs: 1,
        isStreaming: false,
      })
    ).not.toThrow();
    expect(mockLoggerWarn).toHaveBeenCalledWith("[Langfuse] Proxy trace snapshot failed", {
      error: "snapshot exploded",
    });
  });
});
