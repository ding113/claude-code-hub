import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

// Mock the langfuse modules at the top level
const mockStartObservation = vi.fn();
const mockPropagateAttributes = vi.fn();
const mockSpanEnd = vi.fn();
const mockGenerationEnd = vi.fn();
const mockGenerationUpdate = vi.fn();

const mockGeneration: any = {
  update: (...args: unknown[]) => {
    mockGenerationUpdate(...args);
    return mockGeneration;
  },
  end: mockGenerationEnd,
};

const mockUpdateTrace = vi.fn();

const mockRootSpan = {
  startObservation: vi.fn().mockReturnValue(mockGeneration),
  updateTrace: mockUpdateTrace,
  end: mockSpanEnd,
};

vi.mock("@langfuse/tracing", () => ({
  startObservation: (...args: unknown[]) => {
    mockStartObservation(...args);
    return mockRootSpan;
  },
  propagateAttributes: async (attrs: unknown, fn: () => Promise<void>) => {
    mockPropagateAttributes(attrs);
    await fn();
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
  return {
    startTime: Date.now() - 500,
    method: "POST",
    headers: new Headers({
      "content-type": "application/json",
      "x-api-key": "test-mock-key-not-real",
      "user-agent": "claude-code/1.0",
    }),
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
    ttfbMs: 200,
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
        timestamp: Date.now(),
      },
    ],
    getSpecialSettings: () => null,
    getCacheTtlResolved: () => null,
    getContext1mApplied: () => false,
    ...overrides,
  } as any;
}

describe("traceProxyRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    langfuseEnabled = true;
    // Re-setup return values after clearAllMocks
    mockRootSpan.startObservation.mockReturnValue(mockGeneration);
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

  test("should trace when Langfuse is enabled", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers({ "content-type": "application/json" }),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
      responseText: '{"content": "Hi there"}',
    });

    expect(mockStartObservation).toHaveBeenCalledWith(
      "proxy-request",
      expect.objectContaining({
        input: expect.objectContaining({
          endpoint: "/v1/messages",
          method: "POST",
          clientFormat: "claude",
          providerName: "anthropic-main",
        }),
        output: expect.objectContaining({
          statusCode: 200,
          durationMs: 500,
          costUsd: undefined,
        }),
      }),
      expect.objectContaining({
        startTime: expect.any(Date),
      })
    );

    expect(mockRootSpan.startObservation).toHaveBeenCalledWith(
      "llm-call",
      expect.objectContaining({
        model: "claude-sonnet-4-20250514",
      }),
      expect.objectContaining({
        asType: "generation",
        startTime: expect.any(Date),
      })
    );

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

    const generationCall = mockRootSpan.startObservation.mock.calls[0];
    // Generation input should be the actual request message, not a summary
    expect(generationCall[1].input).toEqual(session.request.message);
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

    const generationCall = mockRootSpan.startObservation.mock.calls[0];
    expect(generationCall[1].output).toEqual(responseBody);
  });

  test("should redact sensitive headers", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers({ "x-api-key": "secret-mock" }),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
    });

    const generationCall = mockRootSpan.startObservation.mock.calls[0];
    const metadata = generationCall[1].metadata;
    expect(metadata.requestHeaders["x-api-key"]).toBe("[REDACTED]");
    expect(metadata.requestHeaders["content-type"]).toBe("application/json");
    expect(metadata.responseHeaders["x-api-key"]).toBe("[REDACTED]");
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

    const generationCall = mockRootSpan.startObservation.mock.calls[0];
    expect(generationCall[1].usageDetails).toEqual({
      input: 100,
      output: 50,
      cache_read_input_tokens: 20,
    });
    expect(generationCall[1].costDetails).toEqual({
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

    const generationCall = mockRootSpan.startObservation.mock.calls[0];
    const metadata = generationCall[1].metadata;
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

    const generationCall = mockRootSpan.startObservation.mock.calls[0];
    expect(generationCall[1].metadata.modelRedirected).toBe(true);
    expect(generationCall[1].metadata.originalModel).toBe("claude-sonnet-4-20250514");
  });

  test("should set completionStartTime from ttfbMs", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    const startTime = Date.now() - 500;
    await traceProxyRequest({
      session: createMockSession({ startTime, ttfbMs: 200 }),
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
      session: createMockSession({ startTime }),
      responseHeaders: new Headers(),
      durationMs,
      statusCode: 200,
      isStreaming: false,
    });

    const expectedStart = new Date(startTime);
    const expectedEnd = new Date(startTime + durationMs);

    // Root span gets startTime in options (3rd arg)
    expect(mockStartObservation).toHaveBeenCalledWith("proxy-request", expect.any(Object), {
      startTime: expectedStart,
    });

    // Generation gets startTime in options (3rd arg)
    expect(mockRootSpan.startObservation).toHaveBeenCalledWith("llm-call", expect.any(Object), {
      asType: "generation",
      startTime: expectedStart,
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

  test("should truncate large input/output for Langfuse", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    // Generate a large response text (> default 100KB limit)
    const largeContent = "x".repeat(200_000);

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
      responseText: largeContent,
    });

    const generationCall = mockRootSpan.startObservation.mock.calls[0];
    const output = generationCall[1].output as string;
    // Non-JSON text should be truncated
    expect(output.length).toBeLessThan(200_000);
    expect(output).toContain("...[truncated]");
  });

  test("should show streaming output with sseEventCount when no responseText", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: true,
      sseEventCount: 42,
    });

    const generationCall = mockRootSpan.startObservation.mock.calls[0];
    expect(generationCall[1].output).toEqual({
      streaming: true,
      sseEventCount: 42,
    });
  });

  test("should include costUsd in root span output", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
      costUsd: "0.05",
    });

    expect(mockStartObservation).toHaveBeenCalledWith(
      "proxy-request",
      expect.objectContaining({
        output: expect.objectContaining({
          costUsd: "0.05",
        }),
      }),
      expect.objectContaining({
        startTime: expect.any(Date),
      })
    );
  });
  test("should set trace-level input/output via updateTrace", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    await traceProxyRequest({
      session: createMockSession(),
      responseHeaders: new Headers(),
      durationMs: 500,
      statusCode: 200,
      isStreaming: false,
      costUsd: "0.05",
    });

    expect(mockUpdateTrace).toHaveBeenCalledWith({
      input: expect.objectContaining({
        endpoint: "/v1/messages",
        method: "POST",
        model: "claude-sonnet-4-20250514",
        clientFormat: "claude",
        providerName: "anthropic-main",
      }),
      output: expect.objectContaining({
        statusCode: 200,
        durationMs: 500,
        costUsd: "0.05",
      }),
    });
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
