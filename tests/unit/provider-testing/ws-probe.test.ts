/**
 * WebSocket Provider Probe Tests
 *
 * Tests probeProviderWebSocket which wraps OutboundWsAdapter
 * to test whether a provider supports Responses WebSocket mode.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock state (survives vitest mockReset)
// ---------------------------------------------------------------------------

const { getLastAdapter, setLastAdapter, resetAdapter, getCtorArgs, resetCtorArgs } = vi.hoisted(
  () => {
    type MockAdapter = {
      executeTurn: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
    let adapter: MockAdapter | null = null;
    let ctorArgs: unknown[] = [];

    return {
      getLastAdapter: (): MockAdapter | null => adapter,
      setLastAdapter: (a: MockAdapter) => {
        adapter = a;
      },
      resetAdapter: () => {
        adapter = {
          executeTurn: vi.fn(),
          close: vi.fn(),
        };
      },
      getCtorArgs: () => ctorArgs,
      resetCtorArgs: () => {
        ctorArgs = [];
      },
    };
  }
);

// ---------------------------------------------------------------------------
// Mock: OutboundWsAdapter (class-based, resilient to mockReset)
// ---------------------------------------------------------------------------

vi.mock("@/app/v1/_lib/ws/outbound-adapter", () => {
  class MockOutboundWsAdapter {
    executeTurn: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;

    constructor(options: unknown) {
      getCtorArgs().push(options);
      const mock = getLastAdapter()!;
      this.executeTurn = mock.executeTurn;
      this.close = mock.close;
      setLastAdapter(mock);
    }
  }

  return { OutboundWsAdapter: MockOutboundWsAdapter };
});

// ---------------------------------------------------------------------------
// Mock: transport-classifier (has "server-only" import)
// ---------------------------------------------------------------------------

vi.mock("@/app/v1/_lib/proxy/transport-classifier", () => ({
  toWebSocketUrl: (url: string) =>
    `${url.replace("https://", "wss://").replace(/\/$/, "")}/v1/responses`,
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
  },
}));

// ---------------------------------------------------------------------------
// Import SUT (after all mocks)
// ---------------------------------------------------------------------------

import {
  probeProviderWebSocket,
  type WsProbeConfig,
  type WsProbeResult,
} from "@/lib/provider-testing/ws-probe";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultConfig(overrides?: Partial<WsProbeConfig>): WsProbeConfig {
  return {
    providerUrl: "https://api.openai.com",
    apiKey: "sk-test-123",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("probeProviderWebSocket", () => {
  beforeEach(() => {
    resetAdapter();
    resetCtorArgs();
  });

  // =========================================================================
  // 1. Success case
  // =========================================================================

  it("reports success when WS handshake and terminal event succeed", async () => {
    getLastAdapter()!.executeTurn.mockResolvedValueOnce({
      completed: true,
      terminalType: "response.completed",
      handshakeMs: 42,
      events: [
        { type: "response.output_text.delta", data: {} },
        { type: "response.completed", data: {} },
      ],
      model: "gpt-4o",
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    });

    const result = await probeProviderWebSocket(defaultConfig());

    expect(result.wsSupported).toBe(true);
    expect(result.wsTransport).toBe("websocket");
    expect(result.wsHandshakeMs).toBe(42);
    expect(result.wsEventCount).toBe(2);
    expect(result.wsTerminalModel).toBe("gpt-4o");
    expect(result.wsTerminalUsage).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
    });
  });

  // =========================================================================
  // 2. Handshake rejected (non-101)
  // =========================================================================

  it("reports 'unsupported' when WS handshake is rejected (non-101 response)", async () => {
    getLastAdapter()!.executeTurn.mockResolvedValueOnce({
      completed: false,
      events: [],
      // No handshakeMs -> handshake never completed
      error: new Error("Unexpected server response: 403"),
    });

    const result = await probeProviderWebSocket(defaultConfig());

    expect(result.wsSupported).toBe(false);
    expect(result.wsTransport).toBe("unsupported");
    expect(result.wsFallbackReason).toContain("403");
  });

  // =========================================================================
  // 3. Handshake timeout
  // =========================================================================

  it("reports 'unsupported' when WS handshake times out", async () => {
    getLastAdapter()!.executeTurn.mockResolvedValueOnce({
      completed: false,
      events: [],
      // No handshakeMs -> handshake never completed
      error: new Error("Handshake timeout: 10000ms"),
    });

    const result = await probeProviderWebSocket(defaultConfig());

    expect(result.wsSupported).toBe(false);
    expect(result.wsTransport).toBe("unsupported");
    expect(result.wsFallbackReason).toContain("Handshake timeout");
  });

  // =========================================================================
  // 4. Captures handshake latency, event count, terminal model
  // =========================================================================

  it("captures handshake latency, event count, terminal model", async () => {
    getLastAdapter()!.executeTurn.mockResolvedValueOnce({
      completed: true,
      terminalType: "response.completed",
      handshakeMs: 87,
      events: [
        { type: "response.output_text.delta", data: {} },
        { type: "response.output_text.delta", data: {} },
        { type: "response.output_text.delta", data: {} },
        { type: "response.completed", data: {} },
      ],
      model: "gpt-5-codex",
      usage: { input_tokens: 200, output_tokens: 100, total_tokens: 300 },
    });

    const result = await probeProviderWebSocket(defaultConfig());

    expect(result.wsHandshakeMs).toBe(87);
    expect(result.wsEventCount).toBe(4);
    expect(result.wsTerminalModel).toBe("gpt-5-codex");
  });

  // =========================================================================
  // 5. Captures usage from terminal event
  // =========================================================================

  it("captures usage from terminal event", async () => {
    const usage = {
      input_tokens: 500,
      output_tokens: 200,
      total_tokens: 700,
      output_tokens_details: { reasoning_tokens: 50 },
    };

    getLastAdapter()!.executeTurn.mockResolvedValueOnce({
      completed: true,
      terminalType: "response.completed",
      handshakeMs: 50,
      events: [{ type: "response.completed", data: {} }],
      model: "gpt-4o",
      usage,
    });

    const result = await probeProviderWebSocket(defaultConfig());

    expect(result.wsTerminalUsage).toEqual(usage);
  });

  // =========================================================================
  // 6. Reports fallback reason when WS fails with recoverable error
  // =========================================================================

  it("reports fallback reason when WS fails with recoverable error", async () => {
    // Handshake succeeded (handshakeMs present) but server returned an error frame
    getLastAdapter()!.executeTurn.mockResolvedValueOnce({
      completed: false,
      handshakeMs: 30,
      events: [{ type: "error", data: {} }],
      error: {
        error: {
          type: "invalid_request_error",
          message: "Model not found",
          code: "invalid_model",
        },
      },
    });

    const result = await probeProviderWebSocket(defaultConfig());

    // Handshake succeeded -> provider supports WS
    expect(result.wsSupported).toBe(true);
    expect(result.wsTransport).toBe("websocket");
    expect(result.wsFallbackReason).toBeDefined();
    expect(result.wsHandshakeMs).toBe(30);
    expect(result.wsEventCount).toBe(1);
  });

  // =========================================================================
  // 7. WsProbeResult type has all required fields
  // =========================================================================

  it("WsProbeResult type has all required fields", () => {
    // Compile-time verification: this must compile without errors
    const successResult: WsProbeResult = {
      wsSupported: true,
      wsTransport: "websocket",
      wsHandshakeMs: 100,
      wsEventCount: 5,
      wsFallbackReason: undefined,
      wsTerminalModel: "gpt-4o",
      wsTerminalUsage: { input_tokens: 10, output_tokens: 5 },
    };

    const unsupportedResult: WsProbeResult = {
      wsSupported: false,
      wsTransport: "unsupported",
      wsFallbackReason: "Connection refused",
    };

    const fallbackResult: WsProbeResult = {
      wsSupported: false,
      wsTransport: "http_fallback",
      wsFallbackReason: "Provider does not support WS",
    };

    // Runtime check: all required fields exist
    expect(successResult).toHaveProperty("wsSupported");
    expect(successResult).toHaveProperty("wsTransport");
    expect(successResult).toHaveProperty("wsHandshakeMs");
    expect(successResult).toHaveProperty("wsEventCount");
    expect(successResult).toHaveProperty("wsTerminalModel");
    expect(successResult).toHaveProperty("wsTerminalUsage");

    expect(unsupportedResult).toHaveProperty("wsSupported");
    expect(unsupportedResult).toHaveProperty("wsTransport");
    expect(unsupportedResult).toHaveProperty("wsFallbackReason");

    // Transport enum values
    expect(["websocket", "http_fallback", "unsupported"]).toContain(successResult.wsTransport);
    expect(["websocket", "http_fallback", "unsupported"]).toContain(unsupportedResult.wsTransport);
    expect(["websocket", "http_fallback", "unsupported"]).toContain(fallbackResult.wsTransport);
  });

  // =========================================================================
  // 8. Works with cx_base preset data
  // =========================================================================

  it("works with cx_base preset data (model extraction, input formatting)", async () => {
    getLastAdapter()!.executeTurn.mockResolvedValueOnce({
      completed: true,
      terminalType: "response.completed",
      handshakeMs: 60,
      events: [{ type: "response.completed", data: {} }],
      model: "gpt-5-codex",
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
    });

    const result = await probeProviderWebSocket(defaultConfig({ preset: "cx_base" }));

    // Verify the adapter was created with correct options
    const ctorArgs = getCtorArgs();
    expect(ctorArgs[0]).toEqual(
      expect.objectContaining({
        providerBaseUrl: "https://api.openai.com",
        apiKey: "sk-test-123",
      })
    );

    // Verify executeTurn was called with preset payload
    const adapter = getLastAdapter()!;
    const payload = adapter.executeTurn.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.model).toBe("gpt-5-codex"); // cx_base default model
    expect(payload).toHaveProperty("input");
    expect(payload).toHaveProperty("instructions");

    // Verify result
    expect(result.wsSupported).toBe(true);
    expect(result.wsTerminalModel).toBe("gpt-5-codex");
  });

  // =========================================================================
  // Additional edge cases
  // =========================================================================

  it("uses custom model when provided with preset", async () => {
    getLastAdapter()!.executeTurn.mockResolvedValueOnce({
      completed: true,
      terminalType: "response.completed",
      handshakeMs: 50,
      events: [{ type: "response.completed", data: {} }],
      model: "o4-mini",
      usage: { input_tokens: 50, output_tokens: 10, total_tokens: 60 },
    });

    await probeProviderWebSocket(defaultConfig({ preset: "cx_base", model: "o4-mini" }));

    const payload = getLastAdapter()!.executeTurn.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.model).toBe("o4-mini");
  });

  it("handles connection refused error as unsupported", async () => {
    getLastAdapter()!.executeTurn.mockResolvedValueOnce({
      completed: false,
      events: [],
      error: new Error("connect ECONNREFUSED 127.0.0.1:443"),
    });

    const result = await probeProviderWebSocket(defaultConfig());

    expect(result.wsSupported).toBe(false);
    expect(result.wsTransport).toBe("unsupported");
    expect(result.wsFallbackReason).toContain("ECONNREFUSED");
  });

  it("handles executeTurn rejection gracefully", async () => {
    const adapter = getLastAdapter()!;
    adapter.executeTurn.mockRejectedValueOnce(new Error("Unexpected internal error"));

    const result = await probeProviderWebSocket(defaultConfig());

    expect(result.wsSupported).toBe(false);
    expect(result.wsTransport).toBe("unsupported");
    expect(result.wsFallbackReason).toContain("Unexpected internal error");
    // Adapter should be closed on error
    expect(adapter.close).toHaveBeenCalled();
  });

  it("handles completed turn with no usage gracefully", async () => {
    getLastAdapter()!.executeTurn.mockResolvedValueOnce({
      completed: true,
      terminalType: "response.completed",
      handshakeMs: 100,
      events: [{ type: "response.completed", data: {} }],
      model: "gpt-4o",
      // No usage field
    });

    const result = await probeProviderWebSocket(defaultConfig());

    expect(result.wsSupported).toBe(true);
    expect(result.wsTransport).toBe("websocket");
    expect(result.wsTerminalModel).toBe("gpt-4o");
    expect(result.wsTerminalUsage).toBeUndefined();
  });

  it("defaults to cx_base preset when none specified", async () => {
    getLastAdapter()!.executeTurn.mockResolvedValueOnce({
      completed: true,
      terminalType: "response.completed",
      handshakeMs: 50,
      events: [{ type: "response.completed", data: {} }],
      model: "gpt-5-codex",
    });

    await probeProviderWebSocket(defaultConfig());

    const payload = getLastAdapter()!.executeTurn.mock.calls[0][0] as Record<string, unknown>;
    // cx_base default model
    expect(payload.model).toBe("gpt-5-codex");
    // cx_base has instructions field
    expect(payload).toHaveProperty("instructions");
  });

  it("passes timeout config to adapter options", async () => {
    getLastAdapter()!.executeTurn.mockResolvedValueOnce({
      completed: true,
      terminalType: "response.completed",
      handshakeMs: 50,
      events: [{ type: "response.completed", data: {} }],
      model: "gpt-4o",
    });

    await probeProviderWebSocket(defaultConfig({ timeoutMs: 5000 }));

    // Verify adapter was configured with timeout-derived values
    const ctorArgs = getCtorArgs();
    const options = ctorArgs[0] as Record<string, unknown>;
    expect(options).toHaveProperty("handshakeTimeoutMs");
    expect(options).toHaveProperty("idleTimeoutMs");
    expect(options.handshakeTimeoutMs).toBeLessThanOrEqual(5000);
    expect(options.idleTimeoutMs).toBe(5000);
  });
});
