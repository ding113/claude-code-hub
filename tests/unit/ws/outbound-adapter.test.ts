import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted helpers (accessible inside vi.mock factories)
// ---------------------------------------------------------------------------

const { getMockInstance, setMockInstance, resetMockInstance } = vi.hoisted(() => {
  let instance: MockWsType | null = null;

  // Minimal type for the mock instance (full definition below)
  interface MockWsType {
    url: string;
    options?: Record<string, unknown>;
    readyState: number;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    on: (event: string, fn: (...args: unknown[]) => void) => MockWsType;
    emit: (event: string, ...args: unknown[]) => void;
  }

  return {
    getMockInstance: (): MockWsType | null => instance,
    setMockInstance: (i: MockWsType) => {
      instance = i;
    },
    resetMockInstance: () => {
      instance = null;
    },
  };
});

// ---------------------------------------------------------------------------
// Mock: ws
// ---------------------------------------------------------------------------

vi.mock("ws", () => {
  type ListenerFn = (...args: unknown[]) => void;

  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState = 1; // OPEN
    send = vi.fn();
    close = vi.fn(() => {
      this.readyState = 3; // CLOSED
    });

    url: string;
    options?: Record<string, unknown>;

    private _listeners: Record<string, ListenerFn[]> = {};

    constructor(url: string, options?: Record<string, unknown>) {
      this.url = url;
      this.options = options;
      setMockInstance(this as unknown as Parameters<typeof setMockInstance>[0]);
    }

    on(event: string, fn: ListenerFn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      for (const fn of this._listeners[event] ?? []) {
        fn(...args);
      }
    }
  }

  return { default: MockWebSocket };
});

// ---------------------------------------------------------------------------
// Mock: transport-classifier (has "server-only" import)
// ---------------------------------------------------------------------------

vi.mock("@/app/v1/_lib/proxy/transport-classifier", () => ({
  toWebSocketUrl: (url: string) =>
    url.replace("https://", "wss://").replace(/\/$/, "") + "/v1/responses",
}));

// ---------------------------------------------------------------------------
// Mock: logger
// ---------------------------------------------------------------------------

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import SUT (after all mocks)
// ---------------------------------------------------------------------------

import { OutboundWsAdapter, type OutboundAdapterOptions } from "@/app/v1/_lib/ws/outbound-adapter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultOptions(overrides?: Partial<OutboundAdapterOptions>): OutboundAdapterOptions {
  return {
    providerBaseUrl: "https://api.openai.com",
    apiKey: "sk-test-key-123",
    ...overrides,
  };
}

function makeCompletedEvent(overrides?: Record<string, unknown>) {
  return JSON.stringify({
    type: "response.completed",
    response: {
      id: "resp_abc123",
      status: "completed",
      model: "gpt-4o",
      service_tier: "default",
      prompt_cache_key: "cache-key-001",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
      },
      output: [],
      ...overrides,
    },
  });
}

function makeFailedEvent(overrides?: Record<string, unknown>) {
  return JSON.stringify({
    type: "response.failed",
    response: {
      id: "resp_fail123",
      status: "failed",
      ...overrides,
    },
  });
}

function makeIncompleteEvent(overrides?: Record<string, unknown>) {
  return JSON.stringify({
    type: "response.incomplete",
    response: {
      id: "resp_inc123",
      status: "incomplete",
      ...overrides,
    },
  });
}

function makeErrorFrame(overrides?: Record<string, unknown>) {
  return JSON.stringify({
    type: "error",
    error: {
      type: "invalid_request_error",
      code: "invalid_model",
      message: "Model not found",
      ...overrides,
    },
  });
}

function makeDeltaEvent(text: string) {
  return JSON.stringify({
    type: "response.output_text.delta",
    delta: text,
    item_id: "item_001",
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OutboundWsAdapter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockInstance();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // Connection & Frame
  // =========================================================================

  it("sends response.create frame on open with correct Authorization header", async () => {
    const adapter = new OutboundWsAdapter(defaultOptions());
    const requestBody = { model: "gpt-4o", input: [] };
    const turnPromise = adapter.executeTurn(requestBody);

    const ws = getMockInstance()!;
    expect(ws).toBeTruthy();

    // Verify WS URL
    expect(ws.url).toBe("wss://api.openai.com/v1/responses");

    // Verify Authorization header
    const headers = (ws.options as Record<string, unknown>).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test-key-123");

    // Simulate open -> adapter sends frame
    ws.emit("open");

    expect(ws.send).toHaveBeenCalledOnce();
    const sentFrame = JSON.parse(ws.send.mock.calls[0][0] as string);
    expect(sentFrame.type).toBe("response.create");
    expect(sentFrame.response).toEqual(requestBody);

    // Complete the turn
    ws.emit("message", makeCompletedEvent());

    const result = await turnPromise;
    expect(result.completed).toBe(true);
  });

  it("preserves model, service_tier, reasoning, previous_response_id, parallel_tool_calls in the frame", async () => {
    const adapter = new OutboundWsAdapter(defaultOptions());
    const requestBody = {
      model: "gpt-5-codex",
      input: [{ type: "message", role: "user", content: "hello" }],
      service_tier: "flex",
      reasoning: { effort: "high", summary: "auto", encrypted_content: "abc123" },
      previous_response_id: "resp_prev_001",
      parallel_tool_calls: true,
      prompt_cache_key: "019b82ff-08ff-75a3",
    };

    const turnPromise = adapter.executeTurn(requestBody);

    const ws = getMockInstance()!;
    ws.emit("open");

    const sentFrame = JSON.parse(ws.send.mock.calls[0][0] as string);
    expect(sentFrame.response.model).toBe("gpt-5-codex");
    expect(sentFrame.response.service_tier).toBe("flex");
    expect(sentFrame.response.reasoning).toEqual({
      effort: "high",
      summary: "auto",
      encrypted_content: "abc123",
    });
    expect(sentFrame.response.previous_response_id).toBe("resp_prev_001");
    expect(sentFrame.response.parallel_tool_calls).toBe(true);
    expect(sentFrame.response.prompt_cache_key).toBe("019b82ff-08ff-75a3");

    ws.emit("message", makeCompletedEvent());
    await turnPromise;
  });

  it("passes stream:false (generate:false) through in the frame", async () => {
    const adapter = new OutboundWsAdapter(defaultOptions());
    const requestBody = { model: "gpt-4o", input: [], stream: false };

    const turnPromise = adapter.executeTurn(requestBody);

    const ws = getMockInstance()!;
    ws.emit("open");

    const sentFrame = JSON.parse(ws.send.mock.calls[0][0] as string);
    expect(sentFrame.response.stream).toBe(false);

    ws.emit("message", makeCompletedEvent());
    await turnPromise;
  });

  it("passes extra headers to WebSocket constructor", async () => {
    const adapter = new OutboundWsAdapter(
      defaultOptions({
        extraHeaders: {
          "X-Custom-Header": "custom-value",
          "OpenAI-Beta": "realtime=v1",
        },
      })
    );

    const turnPromise = adapter.executeTurn({ model: "gpt-4o", input: [] });

    const ws = getMockInstance()!;
    const headers = (ws.options as Record<string, unknown>).headers as Record<string, string>;
    expect(headers["X-Custom-Header"]).toBe("custom-value");
    expect(headers["OpenAI-Beta"]).toBe("realtime=v1");
    expect(headers.Authorization).toBe("Bearer sk-test-key-123");

    ws.emit("open");
    ws.emit("message", makeCompletedEvent());
    await turnPromise;
  });

  // =========================================================================
  // Event Collection
  // =========================================================================

  it("collects delta events and returns them in events array", async () => {
    const adapter = new OutboundWsAdapter(defaultOptions());
    const turnPromise = adapter.executeTurn({ model: "gpt-4o", input: [] });

    const ws = getMockInstance()!;
    ws.emit("open");

    ws.emit("message", makeDeltaEvent("Hello"));
    ws.emit("message", makeDeltaEvent(" world"));
    ws.emit("message", makeDeltaEvent("!"));

    ws.emit("message", makeCompletedEvent());

    const result = await turnPromise;
    expect(result.events).toHaveLength(4); // 3 deltas + 1 terminal
    expect(result.events[0].type).toBe("response.output_text.delta");
    expect(result.events[1].type).toBe("response.output_text.delta");
    expect(result.events[2].type).toBe("response.output_text.delta");
    expect(result.events[3].type).toBe("response.completed");
  });

  // =========================================================================
  // Terminal Events
  // =========================================================================

  it("resolves on response.completed with usage extraction", async () => {
    const adapter = new OutboundWsAdapter(defaultOptions());
    const turnPromise = adapter.executeTurn({ model: "gpt-4o", input: [] });

    const ws = getMockInstance()!;
    ws.emit("open");
    ws.emit("message", makeCompletedEvent());

    const result = await turnPromise;
    expect(result.completed).toBe(true);
    expect(result.terminalType).toBe("response.completed");
    expect(result.usage).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
    });
    expect(result.model).toBe("gpt-4o");
    expect(result.serviceTier).toBe("default");
    expect(result.promptCacheKey).toBe("cache-key-001");
    expect(result.error).toBeUndefined();
  });

  it("resolves on response.failed without fake success", async () => {
    const adapter = new OutboundWsAdapter(defaultOptions());
    const turnPromise = adapter.executeTurn({ model: "gpt-4o", input: [] });

    const ws = getMockInstance()!;
    ws.emit("open");
    ws.emit("message", makeFailedEvent());

    const result = await turnPromise;
    expect(result.completed).toBe(true);
    expect(result.terminalType).toBe("response.failed");
    expect(result.terminalEvent?.response.status).toBe("failed");
  });

  it("resolves on response.incomplete terminal event", async () => {
    const adapter = new OutboundWsAdapter(defaultOptions());
    const turnPromise = adapter.executeTurn({ model: "gpt-4o", input: [] });

    const ws = getMockInstance()!;
    ws.emit("open");
    ws.emit("message", makeIncompleteEvent());

    const result = await turnPromise;
    expect(result.completed).toBe(true);
    expect(result.terminalType).toBe("response.incomplete");
  });

  // =========================================================================
  // Timeouts
  // =========================================================================

  it("fires handshake timeout when server does not respond", async () => {
    const adapter = new OutboundWsAdapter(defaultOptions({ handshakeTimeoutMs: 500 }));
    const turnPromise = adapter.executeTurn({ model: "gpt-4o", input: [] });

    // Do NOT emit "open" - let handshake timeout fire
    vi.advanceTimersByTime(500);

    const result = await turnPromise;
    expect(result.completed).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toContain("Handshake timeout");
    expect((result.error as Error).message).toContain("500");
  });

  it("fires idle timeout when no events received after open", async () => {
    const adapter = new OutboundWsAdapter(defaultOptions({ idleTimeoutMs: 1000 }));
    const turnPromise = adapter.executeTurn({ model: "gpt-4o", input: [] });

    const ws = getMockInstance()!;
    ws.emit("open");

    // Advance past idle timeout
    vi.advanceTimersByTime(1000);

    const result = await turnPromise;
    expect(result.completed).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toContain("Idle timeout");
  });

  it("allows caller to configure longer idle timeout for flex tier", async () => {
    // The adapter itself does not auto-detect flex; caller sets the timeout
    const adapter = new OutboundWsAdapter(defaultOptions({ idleTimeoutMs: 300_000 }));
    const turnPromise = adapter.executeTurn({
      model: "gpt-4o",
      input: [],
      service_tier: "flex",
    });

    const ws = getMockInstance()!;
    ws.emit("open");

    // 60s would trigger default 60s timeout, but we configured 300s
    vi.advanceTimersByTime(60_000);

    // Emit a delta to prove adapter is still listening
    ws.emit("message", makeDeltaEvent("still going"));

    // Complete the turn
    ws.emit("message", makeCompletedEvent());

    const result = await turnPromise;
    expect(result.completed).toBe(true);
    expect(result.events).toHaveLength(2); // delta + completed
  });

  // =========================================================================
  // Error Handling
  // =========================================================================

  it("resolves with parsed error on server error frame", async () => {
    const adapter = new OutboundWsAdapter(defaultOptions());
    const turnPromise = adapter.executeTurn({ model: "gpt-4o", input: [] });

    const ws = getMockInstance()!;
    ws.emit("open");
    ws.emit("message", makeErrorFrame());

    const result = await turnPromise;
    expect(result.completed).toBe(false);
    expect(result.error).toBeDefined();
    // Server error frame is parsed as ServerErrorFrame (not Error instance)
    if (!(result.error instanceof Error)) {
      expect(result.error!.error.message).toBe("Model not found");
      expect(result.error!.error.type).toBe("invalid_request_error");
    }
  });

  it("resolves with error on unexpected WebSocket close", async () => {
    const adapter = new OutboundWsAdapter(defaultOptions());
    const turnPromise = adapter.executeTurn({ model: "gpt-4o", input: [] });

    const ws = getMockInstance()!;
    ws.emit("open");

    // Server closes unexpectedly
    ws.readyState = 3;
    ws.emit("close", 1006, Buffer.from("abnormal closure"));

    const result = await turnPromise;
    expect(result.completed).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toContain("WebSocket closed unexpectedly");
    expect((result.error as Error).message).toContain("1006");
  });

  it("resolves with error on WebSocket error event", async () => {
    const adapter = new OutboundWsAdapter(defaultOptions());
    const turnPromise = adapter.executeTurn({ model: "gpt-4o", input: [] });

    const ws = getMockInstance()!;
    // Error before open (e.g. DNS failure)
    ws.emit("error", new Error("ECONNREFUSED"));

    const result = await turnPromise;
    expect(result.completed).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toBe("ECONNREFUSED");
  });

  // =========================================================================
  // close()
  // =========================================================================

  it("close() terminates the connection", async () => {
    const adapter = new OutboundWsAdapter(defaultOptions());
    const turnPromise = adapter.executeTurn({ model: "gpt-4o", input: [] });

    const ws = getMockInstance()!;
    ws.emit("open");

    adapter.close();
    expect(ws.close).toHaveBeenCalledWith(1000);

    // Simulate the close event that follows
    ws.emit("close", 1000, Buffer.from(""));

    const result = await turnPromise;
    expect(result.completed).toBe(false);
  });

  // =========================================================================
  // Handshake Latency
  // =========================================================================

  it("records handshakeMs correctly", async () => {
    const adapter = new OutboundWsAdapter(defaultOptions());
    const turnPromise = adapter.executeTurn({ model: "gpt-4o", input: [] });

    const ws = getMockInstance()!;

    // Advance 150ms before open fires
    vi.advanceTimersByTime(150);
    ws.emit("open");

    ws.emit("message", makeCompletedEvent());

    const result = await turnPromise;
    expect(result.handshakeMs).toBeGreaterThanOrEqual(150);
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================

  it("ignores non-JSON messages without breaking", async () => {
    const adapter = new OutboundWsAdapter(defaultOptions());
    const turnPromise = adapter.executeTurn({ model: "gpt-4o", input: [] });

    const ws = getMockInstance()!;
    ws.emit("open");

    // Non-JSON message
    ws.emit("message", "not json at all");

    // Terminal event still works
    ws.emit("message", makeCompletedEvent());

    const result = await turnPromise;
    expect(result.completed).toBe(true);
    // Non-JSON message should NOT appear in events
    expect(result.events).toHaveLength(1);
  });

  it("does not resolve twice on error + close sequence", async () => {
    const adapter = new OutboundWsAdapter(defaultOptions());
    const turnPromise = adapter.executeTurn({ model: "gpt-4o", input: [] });

    const ws = getMockInstance()!;
    ws.emit("open");

    // Error frame followed by close
    ws.emit("message", makeErrorFrame());
    ws.emit("close", 1000, Buffer.from(""));

    const result = await turnPromise;
    // Should only resolve once with the error frame result
    expect(result.completed).toBe(false);
    expect(result.error).toBeDefined();
  });
});
