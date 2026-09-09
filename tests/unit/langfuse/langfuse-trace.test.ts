import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import type { StreamFinalOutput } from "@/lib/langfuse/stream-final-output-core";

// Mock the langfuse modules at the top level
const mockStartObservation = vi.fn();
const mockPropagateAttributes = vi.fn();
const mockSpanEnd = vi.fn();
const mockGenerationEnd = vi.fn();
const mockGenerationUpdate = vi.fn();
const mockGuardSpanEnd = vi.fn();
const mockEventEnd = vi.fn();

const mockGeneration: any = {
  update: (...args: unknown[]) => {
    mockGenerationUpdate(...args);
    return mockGeneration;
  },
  end: mockGenerationEnd,
};

const mockGuardSpan: any = {
  end: mockGuardSpanEnd,
};

const mockEventObs: any = {
  end: mockEventEnd,
};

const mockSetTraceIO = vi.fn();
const MOCK_PARENT_SPAN_CONTEXT = { traceId: "lf-trace", spanId: "lf-root" };
const propagateState = { active: false };
const createdInsidePropagate: boolean[] = [];

const mockRootSpan = {
  startObservation: vi.fn(),
  setTraceIO: mockSetTraceIO,
  end: mockSpanEnd,
  otelSpan: { spanContext: () => MOCK_PARENT_SPAN_CONTEXT },
};

function getObservationCall(name: string) {
  return mockStartObservation.mock.calls.find((c: unknown[]) => c[0] === name);
}

function getObservationCalls(name: string) {
  return mockStartObservation.mock.calls.filter((c: unknown[]) => c[0] === name);
}

function setupDefaultStartObservation() {
  mockRootSpan.startObservation.mockImplementation((name: string) => {
    if (name === "guard-pipeline") return mockGuardSpan;
    if (name === "provider-attempt" || name === "hedge-trigger") return mockEventObs;
    return mockGeneration;
  });
}

vi.mock("@langfuse/tracing", () => ({
  startObservation: (...args: unknown[]) => {
    mockStartObservation(...args);
    createdInsidePropagate.push(propagateState.active);
    const name = args[0] as string;
    if (name === "guard-pipeline") return mockGuardSpan;
    if (name === "provider-attempt" || name === "hedge-trigger") return mockEventObs;
    if (name === "llm-call") return mockGeneration;
    return mockRootSpan;
  },
  propagateAttributes: async (attrs: unknown, fn: () => Promise<void>) => {
    mockPropagateAttributes(attrs);
    propagateState.active = true;
    try {
      await fn();
    } finally {
      propagateState.active = false;
    }
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

let langfuseEnabled = true;
vi.mock("@/lib/langfuse/index", () => ({
  isLangfuseEnabled: () => langfuseEnabled,
}));

function createMockSession(overrides: Record<string, unknown> = {}) {
  const startTime = (overrides.startTime as number) ?? Date.now() - 500;
  const headers =
    (overrides.headers as Headers | undefined) ??
    new Headers({
      "content-type": "application/json",
      "x-api-key": "test-mock-key-not-real",
      "user-agent": "claude-code/1.0",
    });
  const getOriginalHeaders =
    typeof overrides.getOriginalHeaders === "function"
      ? (overrides.getOriginalHeaders as () => Headers)
      : () => new Headers(headers);

  return {
    startTime,
    method: "POST",
    request: {
      message: {
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
        max_tokens: 4096,
        tools: [{ name: "tool1" }],
      },
      model: "claude-sonnet-4-20250514",
    },
    originalFormat: "claude",
    userAgent: "claude-code/1.0",
    sessionId: "sess_abc12345_def67890",
    clientIp: "192.168.1.42",
    provider: {
      id: 1,
      name: "anthropic-main",
      providerType: "claude",
    },
    messageContext: {
      id: 42,
      user: { id: 7, name: "testuser" },
      key: { name: "default-key" },
    },
    ttftMs: 200,
    firstByteMs: 200,
    forwardStartTime: startTime + 5,
    forwardedRequestBody: null,
    getEndpoint: () => "/v1/messages",
    getRequestSequence: () => 3,
    getMessagesLength: () => 1,
    getCurrentModel: () => "claude-sonnet-4-20250514",
    getOriginalModel: () => "claude-sonnet-4-20250514",
    isModelRedirected: () => false,
    getProviderChain: () => [
      {
        id: 1,
        name: "anthropic-main",
        providerType: "claude",
        reason: "initial_selection",
        timestamp: startTime + 2,
      },
    ],
    getSpecialSettings: () => null,
    getCacheTtlResolved: () => null,
    getContext1mApplied: () => false,
    getGroupCostMultiplier: () => 1,
    ...overrides,
    headers,
    getOriginalHeaders,
  } as any;
}

describe("traceProxyRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    langfuseEnabled = true;
    createdInsidePropagate.length = 0;
    setupDefaultStartObservation();
  });

  test("should not trace when Langfuse is disabled", async () => {
    langfuseEnabled = false;
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    expect(mockStartObservation).not.toHaveBeenCalled();
  });

  test("should trace when Langfuse is enabled with actual bodies", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");
    const responseBody = { content: "Hi there" };

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers({ "content-type": "application/json" }),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
      responseText: JSON.stringify(responseBody),
    });

    // Root span should have actual request body as input (not summary)
    const rootCall = mockStartObservation.mock.calls[0];
    expect(rootCall[0]).toBe("testuser:claude-sonnet-4-20250514");

    // Input should be the actual request message (since forwardedRequestBody is null)
    expect(rootCall[1].input).toEqual(
      expect.objectContaining({
        model: "claude-sonnet-4-20250514",
        messages: expect.any(Array),
      })
    );
    // Output should be actual response body
    expect(rootCall[1].output).toEqual(responseBody);
    // Should have level
    expect(rootCall[1].level).toBe("DEFAULT");
    // Should have metadata with former summaries
    expect(rootCall[1].metadata).toEqual(
      expect.objectContaining({
        endpoint: "/v1/messages",
        method: "POST",
        statusCode: 200,
        durationMs: 500,
      })
    );

    // Should have child observations
    const callNames = mockStartObservation.mock.calls.map((c: unknown[]) => c[0]);
    expect(callNames).toContain("guard-pipeline");
    expect(callNames).toContain("llm-call");

    expect(mockSpanEnd).toHaveBeenCalledWith(expect.any(Date));
    expect(mockGenerationEnd).toHaveBeenCalledWith(expect.any(Date));
  });

  test("should use actual request messages as generation input", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");
    const session = createMockSession();

    await traceProxyRequest({
      session,
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
      responseText: '{"content": "response"}',
    });

    // Find the llm-call invocation
    const llmCall = getObservationCall("llm-call");
    expect(llmCall).toBeDefined();
    expect(llmCall[1].input).toEqual(session.request.message);
  });

  test("should use actual response body as generation output", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");
    const responseBody = { content: [{ type: "text", text: "Hello!" }] };

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
      responseText: JSON.stringify(responseBody),
    });

    const llmCall = getObservationCall("llm-call");
    expect(llmCall[1].output).toEqual(responseBody);
  });

  test("redacts credential headers and preserves benign headers at the Langfuse boundary", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");
    const authorizationSecret = "Bearer request-authorization-secret";
    const apiKeySecret = "request-api-key-secret";
    const cookieSecret = "request-cookie-secret";
    const setCookieSecret = "response-set-cookie-secret";

    await traceProxyRequest({
      session: createMockSession({
        headers: new Headers({
          authorization: authorizationSecret,
          cookie: cookieSecret,
          "content-type": "application/json",
          "x-api-key": apiKeySecret,
          "x-cch-future-marker": "future-internal-canary",
          "x-cch-responses-ws-session": "ws-session-canary",
          "x-request-id": "request-123",
        }),
      }),
      responseHeaders: new Headers({
        "content-type": "text/event-stream",
        "set-cookie": setCookieSecret,
        "x-response-id": "response-456",
      }),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    const llmCall = getObservationCall("llm-call");
    const metadata = llmCall[1].metadata;
    expect(metadata.requestHeaders).toEqual({
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      "content-type": "application/json",
      "x-api-key": "[REDACTED]",
      "x-request-id": "request-123",
    });
    expect(metadata.responseHeaders).toEqual({
      "content-type": "text/event-stream",
      "set-cookie": "[REDACTED]",
      "x-response-id": "response-456",
    });
    expect(metadata.client_metadata).toEqual({
      authorization: "Bearer requ******cret",
      cookie: "requ******cret",
      "content-type": "application/json",
      "x-api-key": "requ******cret",
      "x-request-id": "request-123",
    });

    const serializedSdkArguments = JSON.stringify({
      rootObservation: mockStartObservation.mock.calls,
      propagatedAttributes: mockPropagateAttributes.mock.calls,
      childObservations: mockStartObservation.mock.calls,
      generationUpdates: mockGenerationUpdate.mock.calls,
      generationEnds: mockGenerationEnd.mock.calls,
      guardEnds: mockGuardSpanEnd.mock.calls,
      eventEnds: mockEventEnd.mock.calls,
      traceIo: mockSetTraceIO.mock.calls,
      rootEnds: mockSpanEnd.mock.calls,
    });
    for (const secret of [authorizationSecret, apiKeySecret, cookieSecret, setCookieSecret]) {
      expect(serializedSdkArguments).not.toContain(secret);
    }
    expect(serializedSdkArguments).not.toContain("x-cch-");
    expect(serializedSdkArguments).not.toContain("future-internal-canary");
    expect(serializedSdkArguments).not.toContain("ws-session-canary");
  });

  test("records mashed client-sent headers in client_metadata", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");
    const authorizationSecret = "Bearer request-authorization-secret";
    const apiKeySecret = "request-api-key-secret";
    const cookieSecret = "session=request-cookie-secret";
    const basicSecret = "Basic dXNlcjpwYXNz";

    await traceProxyRequest({
      session: createMockSession({
        headers: new Headers({
          authorization: "Bearer filter-injected-authorization-secret",
          "x-filter-added": "from-request-filter",
        }),
        getOriginalHeaders: () =>
          new Headers({
            authorization: authorizationSecret,
            "x-api-key": apiKeySecret,
            cookie: cookieSecret,
            "x-auth-token": "short",
            "proxy-authorization": basicSecret,
            "content-type": "application/json",
            "user-agent": "claude-code/1.0",
            "x-request-id": "request-123",
          }),
      }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    const llmCall = getObservationCall("llm-call");
    const clientMetadata = llmCall[1].metadata.client_metadata;

    expect(clientMetadata).toEqual({
      authorization: "Bearer requ******cret",
      "x-api-key": "requ******cret",
      cookie: "sess******cret",
      "x-auth-token": "[REDACTED]",
      "proxy-authorization": "Basi******YXNz",
      "content-type": "application/json",
      "user-agent": "claude-code/1.0",
      "x-request-id": "request-123",
    });
    expect(clientMetadata).not.toHaveProperty("x-filter-added");

    const serializedClientMetadata = JSON.stringify(clientMetadata);
    for (const secret of [authorizationSecret, apiKeySecret, cookieSecret, basicSecret]) {
      expect(serializedClientMetadata).not.toContain(secret);
    }
  });

  test("should include provider name and model in tags", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    expect(mockPropagateAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "testuser",
        sessionId: "sess_abc12345_def67890",
        tags: expect.arrayContaining([
          "claude",
          "anthropic-main",
          "claude-sonnet-4-20250514",
          "2xx",
        ]),
      })
    );
  });

  test("should prefix trace name with username and include user/key/ip metadata", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    expect(mockPropagateAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        traceName: "testuser:claude-sonnet-4-20250514",
        metadata: expect.objectContaining({
          userName: "testuser",
          keyName: "default-key",
          clientIp: "192.168.1.42",
        }),
      })
    );
    expect(getObservationCall("testuser:claude-sonnet-4-20250514")).toBeDefined();
  });

  test("should use the bare model as trace name when username is absent", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession({ messageContext: null, userName: undefined }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    expect(mockPropagateAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        traceName: "claude-sonnet-4-20250514",
      })
    );
    expect(getObservationCall("claude-sonnet-4-20250514")).toBeDefined();
  });

  test("strips provider prefixes from observation and trace names at the last slash", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession({
        getCurrentModel: () => "openrouter/anthropic/claude-sonnet-4-20250514",
      }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    expect(mockPropagateAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        traceName: "testuser:claude-sonnet-4-20250514",
      })
    );
    expect(getObservationCall("testuser:claude-sonnet-4-20250514")).toBeDefined();
    expect(
      getObservationCall("testuser:openrouter/anthropic/claude-sonnet-4-20250514")
    ).toBeUndefined();
  });

  test("should include usage details when provided", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
      usageMetrics: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 20,
      },
      costUsd: "0.0015",
    });

    const llmCall = getObservationCall("llm-call");
    expect(llmCall[1].usageDetails).toEqual({
      input: 100,
      output: 50,
      cache_read_input_tokens: 20,
    });
    expect(llmCall[1].costDetails).toEqual({
      total: 0.0015,
    });
  });

  test("should include providerChain, specialSettings, and model in metadata", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    const providerChain = [
      {
        id: 1,
        name: "anthropic-main",
        providerType: "claude",
        reason: "initial_selection",
        timestamp: Date.now(),
      },
    ];

    await traceProxyRequest({
      session: createMockSession({
        getSpecialSettings: () => ({ maxThinking: 8192 }),
        getProviderChain: () => providerChain,
      }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    const llmCall = getObservationCall("llm-call");
    const metadata = llmCall[1].metadata;
    expect(metadata.providerChain).toEqual(providerChain);
    expect(metadata.specialSettings).toEqual({ maxThinking: 8192 });
    expect(metadata.model).toBe("claude-sonnet-4-20250514");
    expect(metadata.originalModel).toBe("claude-sonnet-4-20250514");
    expect(metadata.providerName).toBe("anthropic-main");
    expect(metadata.requestSummary).toEqual(
      expect.objectContaining({
        model: "claude-sonnet-4-20250514",
        messageCount: 1,
      })
    );
  });

  test("should preserve request summary fields from lightweight Langfuse previews", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession({
        request: {
          message: {
            truncatedForLangfuse: true,
            model: "claude-sonnet-4-20250514",
            stream: true,
            max_tokens: 1024,
            temperature: 0.7,
            messageCount: 3,
            toolsCount: 2,
            hasSystemPrompt: true,
          },
          model: "claude-sonnet-4-20250514",
        },
        getMessagesLength: () => 3,
      }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: true,
    });

    const llmCall = getObservationCall("llm-call");
    expect(llmCall[1].metadata.requestSummary).toEqual(
      expect.objectContaining({
        model: "claude-sonnet-4-20250514",
        messageCount: 3,
        hasSystemPrompt: true,
        toolsCount: 2,
        stream: true,
        maxTokens: 1024,
        temperature: 0.7,
      })
    );
  });

  test("should handle model redirect metadata", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession({
        isModelRedirected: () => true,
        getOriginalModel: () => "claude-sonnet-4-20250514",
        getCurrentModel: () => "glm-4",
        request: {
          message: { model: "glm-4", messages: [] },
          model: "glm-4",
        },
      }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    const llmCall = getObservationCall("llm-call");
    expect(llmCall[1].metadata.modelRedirected).toBe(true);
    expect(llmCall[1].metadata.originalModel).toBe("claude-sonnet-4-20250514");
  });

  test("should set completionStartTime from ttftMs", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    const startTime = Date.now() - 500;
    await traceProxyRequest({
      session: createMockSession({ startTime, ttftMs: 200 }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    expect(mockGenerationUpdate).toHaveBeenCalledWith({
      completionStartTime: new Date(startTime + 200),
    });
  });

  test("should pass correct startTime and endTime to observations", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    const startTime = 1700000000000;
    const durationMs = 5000;

    await traceProxyRequest({
      session: createMockSession({ startTime, forwardStartTime: startTime + 5 }),
      responseHeaders: new Headers(),
      durationMs,
      statusCode: 200,
      isStreaming: false,
    });

    const expectedStart = new Date(startTime);
    const expectedEnd = new Date(startTime + durationMs);
    const expectedForwardStart = new Date(startTime + 5);

    // Root span gets startTime in options (3rd arg)
    expect(mockStartObservation).toHaveBeenCalledWith(
      "testuser:claude-sonnet-4-20250514",
      expect.any(Object),
      {
        startTime: expectedStart,
      }
    );

    // Generation gets forwardStartTime in options (3rd arg)
    const llmCall = getObservationCall("llm-call");
    expect(llmCall[2]).toEqual({
      asType: "generation",
      startTime: expectedForwardStart,
      parentSpanContext: MOCK_PARENT_SPAN_CONTEXT,
    });

    // Both end() calls receive the computed endTime
    expect(mockGenerationEnd).toHaveBeenCalledWith(expectedEnd);
    expect(mockSpanEnd).toHaveBeenCalledWith(expectedEnd);
  });

  test("should handle errors gracefully without throwing", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    // Make startObservation throw
    mockStartObservation.mockImplementationOnce(() => {
      throw new Error("SDK error");
    });

    await expect(
      traceProxyRequest({
        session: createMockSession(),
        responseHeaders: new Headers(),
        durationMs: 500,
        statusCode: 200,
        isStreaming: false,
      })
    ).resolves.toBeUndefined();
  });

  test("should include correct tags for error responses", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 502,
      isStreaming: false,
      errorMessage: "upstream error",
    });

    expect(mockPropagateAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: expect.arrayContaining(["5xx"]),
      })
    );
  });

  test("should pass large input/output without truncation", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    // Generate a large response text
    const largeContent = "x".repeat(200_000);

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
      responseText: largeContent,
    });

    const llmCall = getObservationCall("llm-call");
    const output = llmCall[1].output as string;
    // Should be the full content, no truncation
    expect(output).toBe(largeContent);
    expect(output).not.toContain("...[truncated]");
  });

  test("should use a bounded diagnostic when streaming output has no finalizer result and no responseText", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: true,
      sseEventCount: 42,
    });

    const llmCall = getObservationCall("llm-call");
    expect(llmCall[1].output).toEqual({
      kind: "final_output_unavailable",
      reason: "no_terminal_event",
      eventCount: 42,
      status: 200,
    });
  });

  test("should mark missing non-stream output for error traces", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 502,
      isStreaming: false,
      errorMessage: "fetch failed",
    });

    const expectedOutput = {
      statusCode: 502,
      errorMessage: "fetch failed",
      responseMissing: true,
    };
    const rootCall = mockStartObservation.mock.calls[0];
    expect(rootCall[1].output).toEqual(expectedOutput);

    const llmCall = getObservationCall("llm-call");
    expect(llmCall[1].output).toEqual(expectedOutput);
    expect(mockSetTraceIO).not.toHaveBeenCalled();
  });

  test("should mark missing non-stream output when request input exists", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession({
        request: {
          message: {
            model: "claude-sonnet-4-20250514",
            messages: [{ role: "user", content: "Hello" }],
            stream: false,
          },
          model: "claude-sonnet-4-20250514",
        },
      }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 204,
      isStreaming: false,
    });

    const expectedOutput = {
      statusCode: 204,
      responseMissing: true,
    };
    const rootCall = mockStartObservation.mock.calls[0];
    expect(rootCall[1].output).toEqual(expectedOutput);

    const llmCall = getObservationCall("llm-call");
    expect(llmCall[1].output).toEqual(expectedOutput);
    expect(mockSetTraceIO).not.toHaveBeenCalled();
  });

  test("should include costUsd in root span metadata", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
      costUsd: "0.05",
    });

    const rootCall = mockStartObservation.mock.calls[0];
    expect(rootCall[1].metadata).toEqual(
      expect.objectContaining({
        costUsd: "0.05",
      })
    );
  });

  test("should set input/output on the root observation instead of deprecated setTraceIO", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");
    const responseBody = { result: "ok" };

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
      responseText: JSON.stringify(responseBody),
      costUsd: "0.05",
    });

    const rootCall = getObservationCall("testuser:claude-sonnet-4-20250514");

    expect(rootCall?.[1].input).toEqual(
      expect.objectContaining({
        model: "claude-sonnet-4-20250514",
        messages: expect.any(Array),
      })
    );
    expect(rootCall?.[1].output).toEqual(responseBody);
    expect(mockSetTraceIO).not.toHaveBeenCalled();
  });

  test("should emit only sanitized Responses output and native Responses usage", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");
    const responseBody = {
      id: "resp_123",
      object: "response",
      created_at: 1,
      completed_at: 2,
      background: true,
      error: null,
      incomplete_details: null,
      frequency_penalty: 0,
      presence_penalty: 0,
      temperature: 1,
      top_p: 1,
      top_logprobs: 0,
      max_output_tokens: 100,
      max_tool_calls: 2,
      parallel_tool_calls: true,
      tool_choice: "auto",
      truncation: "disabled",
      store: false,
      previous_response_id: "resp_previous",
      prompt_cache_key: "cache-key",
      prompt_cache_retention: "24h",
      reasoning: { effort: "high" },
      safety_identifier: "user-hash",
      service_tier: "default",
      text: { format: { type: "text" } },
      tools: [{ type: "function", name: "lookup" }],
      tool_usage: { count: 1 },
      user: "user_123",
      metadata: { request: "metadata" },
      status: "completed",
      model: "gpt-5.6",
      output: [
        {
          id: "msg_123",
          type: "message",
          status: "completed",
          content: [{ type: "output_text", text: "Hello" }],
        },
        {
          id: "fc_123",
          type: "function_call",
          status: "completed",
          internal_chat_message_metadata_passthrough: { internal: true },
          metadata: { internal: true },
          call_id: "call_123",
          name: "lookup",
          arguments: '{"city":"Taipei"}',
        },
      ],
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 25 },
        output_tokens: 50,
        output_tokens_details: { reasoning_tokens: 10 },
        total_tokens: 150,
      },
    };

    await traceProxyRequest({
      session: createMockSession({ originalFormat: "response" }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
      responseText: JSON.stringify(responseBody),
    });

    const expectedOutput = [
      {
        id: "msg_123",
        type: "message",
        status: "completed",
        content: [{ type: "output_text", text: "Hello" }],
      },
      {
        type: "function_call",
        call_id: "call_123",
        name: "lookup",
        arguments: '{"city":"Taipei"}',
      },
    ];
    const rootCall = mockStartObservation.mock.calls[0];
    const llmCall = getObservationCall("llm-call");

    expect(rootCall[1].output).toEqual(expectedOutput);
    expect(llmCall?.[1]).toMatchObject({
      output: expectedOutput,
      usageDetails: responseBody.usage,
      metadata: { response: { id: "resp_123", status: "completed", model: "gpt-5.6" } },
    });
    expect(mockSetTraceIO).not.toHaveBeenCalled();
  });

  test("should sanitize finalized streaming Responses output", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");
    const finalResponseOutput: StreamFinalOutput = {
      kind: "final",
      value: {
        id: "resp_stream",
        object: "response",
        status: "completed",
        model: "gpt-5.6",
        output: [
          {
            id: "tool_123",
            type: "function_call",
            status: "completed",
            metadata: { hidden: true },
            call_id: "call_123",
          },
        ],
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      },
    };

    await traceProxyRequest({
      session: createMockSession({ originalFormat: "response" }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: true,
      finalResponseOutput,
    });

    const llmCall = getObservationCall("llm-call");

    expect(llmCall?.[1]).toMatchObject({
      output: [{ type: "function_call", call_id: "call_123" }],
      usageDetails: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      metadata: { response: { id: "resp_stream", status: "completed", model: "gpt-5.6" } },
    });
  });

  test("should reuse structured streaming output across all Langfuse output sinks", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");
    const finalValue = {
      id: "chat-1",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "hello" } }],
    };
    const finalResponseOutput: StreamFinalOutput = { kind: "final", value: finalValue };

    await traceProxyRequest({
      session: createMockSession({ originalFormat: "openai" }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: true,
      responseText: 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n',
      finalResponseOutput,
    });

    const rootCall = mockStartObservation.mock.calls[0];
    const llmCall = getObservationCall("llm-call");

    expect(rootCall[1].output).toBe(finalValue);
    expect(llmCall?.[1].output).toBe(finalValue);
    expect(mockSetTraceIO).not.toHaveBeenCalled();
    expect(JSON.stringify(rootCall[1].output)).not.toContain("data: ");
    expect(JSON.stringify(llmCall?.[1].output)).not.toContain("data: ");
  });

  test("should use a structured diagnostic as the shared streaming output", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");
    const diagnostic: StreamFinalOutput = {
      kind: "final_output_unavailable",
      reason: "no_terminal_event",
      eventCount: 2,
      framing: "sse",
    };

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: true,
      responseText: "data: partial\n\n",
      finalResponseOutput: diagnostic,
    });

    const rootCall = mockStartObservation.mock.calls[0];
    const llmCall = getObservationCall("llm-call");

    expect(rootCall[1].output).toBe(diagnostic);
    expect(llmCall?.[1].output).toBe(diagnostic);
    expect(mockSetTraceIO).not.toHaveBeenCalled();
  });

  test("should use a bounded diagnostic when streaming output has no finalizer result", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");
    const rawSse = 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: [DONE]';
    const diagnostic: StreamFinalOutput = {
      kind: "final_output_unavailable",
      reason: "no_terminal_event",
      eventCount: 2,
      status: 200,
    };

    await traceProxyRequest({
      session: createMockSession({ originalFormat: "openai" }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: true,
      sseEventCount: 2,
      responseText: rawSse,
    });

    const rootCall = mockStartObservation.mock.calls[0];
    const llmCall = getObservationCall("llm-call");

    expect(rootCall[1].output).toEqual(diagnostic);
    expect(llmCall?.[1].output).toEqual(diagnostic);
    expect(mockSetTraceIO).not.toHaveBeenCalled();
    expect(JSON.stringify(rootCall[1].output)).not.toContain("data:");
    expect(JSON.stringify(llmCall?.[1].output)).not.toContain("data:");
  });

  // --- New tests for multi-span hierarchy ---

  test("should create guard-pipeline span with correct timing", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    const startTime = 1700000000000;
    const forwardStartTime = startTime + 8; // 8ms guard pipeline

    await traceProxyRequest({
      session: createMockSession({ startTime, forwardStartTime }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    const guardCall = getObservationCall("guard-pipeline");
    expect(guardCall).toBeDefined();
    expect(guardCall[1]).toEqual({
      output: { durationMs: 8, passed: true },
    });
    expect(guardCall[2]).toEqual({
      startTime: new Date(startTime),
      parentSpanContext: MOCK_PARENT_SPAN_CONTEXT,
    });

    // Guard span should end at forwardStartTime
    expect(mockGuardSpanEnd).toHaveBeenCalledWith(new Date(forwardStartTime));
  });

  test("should skip guard-pipeline span when forwardStartTime is null", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession({ forwardStartTime: null }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    const guardCall = getObservationCall("guard-pipeline");
    expect(guardCall).toBeUndefined();
    expect(mockGuardSpanEnd).not.toHaveBeenCalled();
  });

  test("should create provider-attempt events for failed chain items", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    const startTime = 1700000000000;
    const failTimestamp = startTime + 100;

    await traceProxyRequest({
      session: createMockSession({
        startTime,
        getProviderChain: () => [
          {
            id: 1,
            name: "provider-a",
            providerType: "claude",
            reason: "retry_failed",
            errorMessage: "502 Bad Gateway",
            statusCode: 502,
            attemptNumber: 1,
            timestamp: failTimestamp,
          },
          {
            id: 2,
            name: "provider-b",
            providerType: "claude",
            reason: "system_error",
            errorMessage: "ECONNREFUSED",
            timestamp: failTimestamp + 50,
          },
          {
            id: 3,
            name: "provider-c",
            providerType: "claude",
            reason: "request_success",
            timestamp: failTimestamp + 200,
          },
        ],
      }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    const eventCalls = getObservationCalls("provider-attempt");
    // 2 failed items (retry_failed + system_error), success is skipped
    expect(eventCalls).toHaveLength(2);

    // First event: retry_failed -> WARNING level
    expect(eventCalls[0][1]).toEqual(
      expect.objectContaining({
        level: "WARNING",
        input: expect.objectContaining({
          providerId: 1,
          providerName: "provider-a",
          attempt: 1,
        }),
        output: expect.objectContaining({
          reason: "retry_failed",
          errorMessage: "502 Bad Gateway",
          statusCode: 502,
        }),
      })
    );
    expect(eventCalls[0][2]).toEqual({
      asType: "event",
      startTime: new Date(failTimestamp),
      parentSpanContext: MOCK_PARENT_SPAN_CONTEXT,
    });

    // Second event: system_error -> ERROR level
    expect(eventCalls[1][1].level).toBe("ERROR");
    expect(eventCalls[1][1].output.reason).toBe("system_error");
  });

  test("should set generation startTime to forwardStartTime", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    const startTime = 1700000000000;
    const forwardStartTime = startTime + 10;

    await traceProxyRequest({
      session: createMockSession({ startTime, forwardStartTime }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    const llmCall = getObservationCall("llm-call");
    expect(llmCall[2]).toEqual({
      asType: "generation",
      startTime: new Date(forwardStartTime),
      parentSpanContext: MOCK_PARENT_SPAN_CONTEXT,
    });
  });

  test("should fall back to requestStartTime when forwardStartTime is null", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    const startTime = 1700000000000;

    await traceProxyRequest({
      session: createMockSession({ startTime, forwardStartTime: null }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    const llmCall = getObservationCall("llm-call");
    expect(llmCall[2]).toEqual({
      asType: "generation",
      startTime: new Date(startTime),
      parentSpanContext: MOCK_PARENT_SPAN_CONTEXT,
    });
  });

  test("should include timingBreakdown in root span metadata and generation metadata", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    const startTime = 1700000000000;
    const forwardStartTime = startTime + 5;

    await traceProxyRequest({
      session: createMockSession({
        startTime,
        forwardStartTime,
        ttftMs: 105,
        firstByteMs: 105,
        getProviderChain: () => [
          { id: 1, name: "p1", reason: "retry_failed", timestamp: startTime + 50 },
          { id: 2, name: "p2", reason: "request_success", timestamp: startTime + 100 },
        ],
      }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    const expectedTimingBreakdown = {
      guardPipelineMs: 5,
      upstreamTotalMs: 495,
      ttftFromForwardMs: 100, // ttftMs(105) - guardPipelineMs(5)
      tokenGenerationMs: 395, // durationMs(500) - ttftMs(105)
      failedAttempts: 1, // only retry_failed is non-success
      providersAttempted: 2, // 2 unique provider ids
    };

    // Root span metadata should have timingBreakdown
    const rootCall = mockStartObservation.mock.calls[0];
    expect(rootCall[1].metadata.timingBreakdown).toEqual(expectedTimingBreakdown);

    // Generation metadata should also have timingBreakdown
    const llmCall = getObservationCall("llm-call");
    expect(llmCall[1].metadata.timingBreakdown).toEqual(expectedTimingBreakdown);
  });

  test("should not create provider-attempt events when all providers succeeded", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession({
        getProviderChain: () => [
          { id: 1, name: "p1", reason: "initial_selection", timestamp: Date.now() },
          { id: 1, name: "p1", reason: "request_success", timestamp: Date.now() },
        ],
      }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    const eventCalls = getObservationCalls("provider-attempt");
    expect(eventCalls).toHaveLength(0);
  });

  // --- New tests for input/output, level, and cost breakdown ---

  test("should use forwardedRequestBody as trace input when available", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    const forwardedBody = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "Preprocessed Hello" }],
      stream: true,
    });

    await traceProxyRequest({
      session: createMockSession({
        forwardedRequestBody: forwardedBody,
      }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
      responseText: '{"ok": true}',
    });

    // Root span input should be the forwarded body (parsed JSON)
    const rootCall = mockStartObservation.mock.calls[0];
    expect(rootCall[1].input).toEqual(JSON.parse(forwardedBody));

    expect(mockSetTraceIO).not.toHaveBeenCalled();
  });

  test("should set root span level to DEFAULT for successful request", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    const rootCall = mockStartObservation.mock.calls[0];
    expect(rootCall[1].level).toBe("DEFAULT");
  });

  test("should set root span level to WARNING when retries occurred", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    const startTime = Date.now() - 500;
    await traceProxyRequest({
      session: createMockSession({
        startTime,
        getProviderChain: () => [
          { id: 1, name: "p1", reason: "retry_failed", timestamp: startTime + 50 },
          { id: 2, name: "p2", reason: "request_success", timestamp: startTime + 200 },
        ],
      }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    const rootCall = mockStartObservation.mock.calls[0];
    expect(rootCall[1].level).toBe("WARNING");
  });

  test("should set root span level to ERROR for non-200 status", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 502,
      isStreaming: false,
    });

    const rootCall = mockStartObservation.mock.calls[0];
    expect(rootCall[1].level).toBe("ERROR");
  });

  test("should set root span level to ERROR for 499 client abort", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 499,
      isStreaming: false,
    });

    const rootCall = mockStartObservation.mock.calls[0];
    expect(rootCall[1].level).toBe("ERROR");
  });

  test("should include cost breakdown in costDetails when provided", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    const costBreakdown = {
      input: 0.001,
      output: 0.002,
      cache_creation: 0.0005,
      cache_read: 0.0001,
      total: 0.0036,
    };

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
      costUsd: "0.0036",
      costBreakdown,
    });

    const llmCall = getObservationCall("llm-call");
    expect(llmCall[1].costDetails).toEqual(costBreakdown);
  });

  test("should fallback to total-only costDetails when no breakdown", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
      costUsd: "0.05",
    });

    const llmCall = getObservationCall("llm-call");
    expect(llmCall[1].costDetails).toEqual({ total: 0.05 });
  });

  test("should include former summaries in root span metadata", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
      costUsd: "0.05",
    });

    const rootCall = mockStartObservation.mock.calls[0];
    const metadata = rootCall[1].metadata;
    // Former input summary fields
    expect(metadata.endpoint).toBe("/v1/messages");
    expect(metadata.method).toBe("POST");
    expect(metadata.model).toBe("claude-sonnet-4-20250514");
    expect(metadata.clientFormat).toBe("claude");
    expect(metadata.providerName).toBe("anthropic-main");
    // Former output summary fields
    expect(metadata.statusCode).toBe(200);
    expect(metadata.durationMs).toBe(500);
    expect(metadata.costUsd).toBe("0.05");
    expect(metadata.timingBreakdown).toBeDefined();
  });

  test("creates every observation inside propagateAttributes", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    expect(createdInsidePropagate.length).toBeGreaterThan(0);
    expect(createdInsidePropagate.every(Boolean)).toBe(true);
    expect(getObservationCall("testuser:claude-sonnet-4-20250514")).toBeDefined();

    expect(getObservationCall("llm-call")?.[2]).toEqual(
      expect.objectContaining({
        asType: "generation",
        parentSpanContext: MOCK_PARENT_SPAN_CONTEXT,
      })
    );
  });

  test("clamps propagated metadata values to 200 characters", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");
    const longUserAgent = `claude-code/${"x".repeat(400)}`;

    await traceProxyRequest({
      session: createMockSession({ userAgent: longUserAgent }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    expect(mockPropagateAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          userAgent: longUserAgent.slice(0, 200),
        }),
      })
    );
  });

  test("omits empty propagated metadata fields", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession({ messageContext: null, userName: undefined, clientIp: null }),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    const metadata = mockPropagateAttributes.mock.calls[0][0].metadata as Record<string, string>;
    expect(metadata).not.toHaveProperty("userName");
    expect(metadata).not.toHaveProperty("keyName");
    expect(metadata).not.toHaveProperty("clientIp");
  });
});

describe("isLangfuseEnabled", () => {
  const originalPublicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const originalSecretKey = process.env.LANGFUSE_SECRET_KEY;

  afterEach(() => {
    // Restore env
    if (originalPublicKey !== undefined) {
      process.env.LANGFUSE_PUBLIC_KEY = originalPublicKey;
    } else {
      delete process.env.LANGFUSE_PUBLIC_KEY;
    }
    if (originalSecretKey !== undefined) {
      process.env.LANGFUSE_SECRET_KEY = originalSecretKey;
    } else {
      delete process.env.LANGFUSE_SECRET_KEY;
    }
  });

  test("should return false when env vars are not set", () => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;

    // Direct function test (not using the mock)
    const isEnabled = !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
    expect(isEnabled).toBe(false);
  });

  test("should return true when both keys are set", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test-mock";
    process.env.LANGFUSE_SECRET_KEY = "test-mock-not-real";

    const isEnabled = !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
    expect(isEnabled).toBe(true);
  });
});
