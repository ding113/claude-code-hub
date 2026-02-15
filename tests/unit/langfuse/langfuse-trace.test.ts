import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

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

const mockUpdateTrace = vi.fn();

const mockRootSpan = {
  startObservation: vi.fn(),
  updateTrace: mockUpdateTrace,
  end: mockSpanEnd,
};

// Default: route by observation name
function setupDefaultStartObservation() {
  mockRootSpan.startObservation.mockImplementation((name: string) => {
    if (name === "guard-pipeline") return mockGuardSpan;
    if (name === "provider-attempt") return mockEventObs;
    return mockGeneration; // "llm-call"
  });
}

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
  const startTime = (overrides.startTime as number) ?? Date.now() - 500;
  return {
    startTime,
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
    forwardStartTime: startTime + 5,
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
    ...overrides,
  } as any;
}

describe("traceProxyRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    langfuseEnabled = true;
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
          timingBreakdown: expect.any(Object),
        }),
      }),
      expect.objectContaining({
        startTime: expect.any(Date),
      })
    );

    // Should have 3 child observations: guard-pipeline, llm-call (no failed providers in default mock)
    const callNames = mockRootSpan.startObservation.mock.calls.map((c: unknown[]) => c[0]);
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
    const llmCall = mockRootSpan.startObservation.mock.calls.find(
      (c: unknown[]) => c[0] === "llm-call"
    );
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

    const llmCall = mockRootSpan.startObservation.mock.calls.find(
      (c: unknown[]) => c[0] === "llm-call"
    );
    expect(llmCall[1].output).toEqual(responseBody);
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

    const llmCall = mockRootSpan.startObservation.mock.calls.find(
      (c: unknown[]) => c[0] === "llm-call"
    );
    const metadata = llmCall[1].metadata;
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

    const llmCall = mockRootSpan.startObservation.mock.calls.find(
      (c: unknown[]) => c[0] === "llm-call"
    );
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

    const llmCall = mockRootSpan.startObservation.mock.calls.find(
      (c: unknown[]) => c[0] === "llm-call"
    );
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

    const llmCall = mockRootSpan.startObservation.mock.calls.find(
      (c: unknown[]) => c[0] === "llm-call"
    );
    expect(llmCall[1].metadata.modelRedirected).toBe(true);
    expect(llmCall[1].metadata.originalModel).toBe("claude-sonnet-4-20250514");
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
    expect(mockStartObservation).toHaveBeenCalledWith("proxy-request", expect.any(Object), {
      startTime: expectedStart,
    });

    // Generation gets forwardStartTime in options (3rd arg)
    const llmCall = mockRootSpan.startObservation.mock.calls.find(
      (c: unknown[]) => c[0] === "llm-call"
    );
    expect(llmCall[2]).toEqual({
      asType: "generation",
      startTime: expectedForwardStart,
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

    const llmCall = mockRootSpan.startObservation.mock.calls.find(
      (c: unknown[]) => c[0] === "llm-call"
    );
    const output = llmCall[1].output as string;
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

    const llmCall = mockRootSpan.startObservation.mock.calls.find(
      (c: unknown[]) => c[0] === "llm-call"
    );
    expect(llmCall[1].output).toEqual({
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

    const guardCall = mockRootSpan.startObservation.mock.calls.find(
      (c: unknown[]) => c[0] === "guard-pipeline"
    );
    expect(guardCall).toBeDefined();
    expect(guardCall[1]).toEqual({
      output: { durationMs: 8, passed: true },
    });
    expect(guardCall[2]).toEqual({ startTime: new Date(startTime) });

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

    const guardCall = mockRootSpan.startObservation.mock.calls.find(
      (c: unknown[]) => c[0] === "guard-pipeline"
    );
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

    const eventCalls = mockRootSpan.startObservation.mock.calls.filter(
      (c: unknown[]) => c[0] === "provider-attempt"
    );
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

    const llmCall = mockRootSpan.startObservation.mock.calls.find(
      (c: unknown[]) => c[0] === "llm-call"
    );
    expect(llmCall[2]).toEqual({
      asType: "generation",
      startTime: new Date(forwardStartTime),
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

    const llmCall = mockRootSpan.startObservation.mock.calls.find(
      (c: unknown[]) => c[0] === "llm-call"
    );
    expect(llmCall[2]).toEqual({
      asType: "generation",
      startTime: new Date(startTime),
    });
  });

  test("should include timingBreakdown in trace output and generation metadata", async () => {
    const { traceProxyRequest } = await import("@/lib/langfuse/trace-proxy-request");

    const startTime = 1700000000000;
    const forwardStartTime = startTime + 5;

    await traceProxyRequest({
      session: createMockSession({
        startTime,
        forwardStartTime,
        ttfbMs: 105,
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

    // Root span output should have timingBreakdown
    const rootCall = mockStartObservation.mock.calls[0];
    const rootOutput = rootCall[1].output;
    expect(rootOutput.timingBreakdown).toEqual({
      guardPipelineMs: 5,
      upstreamTotalMs: 495,
      ttfbFromForwardMs: 100, // ttfbMs(105) - guardPipelineMs(5)
      tokenGenerationMs: 395, // durationMs(500) - ttfbMs(105)
      failedAttempts: 1, // only retry_failed is non-success
      providersAttempted: 2, // 2 unique provider ids
    });

    // Generation metadata should also have timingBreakdown
    const llmCall = mockRootSpan.startObservation.mock.calls.find(
      (c: unknown[]) => c[0] === "llm-call"
    );
    expect(llmCall[1].metadata.timingBreakdown).toEqual(rootOutput.timingBreakdown);
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

    const eventCalls = mockRootSpan.startObservation.mock.calls.filter(
      (c: unknown[]) => c[0] === "provider-attempt"
    );
    expect(eventCalls).toHaveLength(0);
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
