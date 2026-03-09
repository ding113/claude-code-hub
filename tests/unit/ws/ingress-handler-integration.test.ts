/**
 * Integration tests for WsIngressHandler.handleTurn orchestration.
 *
 * Tests the full pipeline: ProxySession creation -> guard pipeline ->
 * transport classification -> outbound adapter -> event bridge relay ->
 * billing settlement -> session continuity.
 *
 * All external dependencies are mocked; these tests verify orchestration
 * logic rather than individual component behavior.
 */

import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock instances (vi.hoisted ensures these exist before vi.mock factories run)
// ---------------------------------------------------------------------------

const {
  mockPipelineRun,
  mockExecuteTurn,
  mockAdapterClose,
  mockRelayEvent,
  mockSettleError,
  mockGetSettlement,
  mockBridgeReset,
  mockBridgeIsSettledRef,
} = vi.hoisted(() => ({
  mockPipelineRun: vi.fn(),
  mockExecuteTurn: vi.fn(),
  mockAdapterClose: vi.fn(),
  mockRelayEvent: vi.fn().mockReturnValue(false),
  mockSettleError: vi.fn(),
  mockGetSettlement: vi.fn().mockReturnValue(null),
  mockBridgeReset: vi.fn(),
  mockBridgeIsSettledRef: { value: false },
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/repository/key", () => ({
  validateApiKeyAndGetUser: vi.fn(),
}));

vi.mock("@/lib/config/system-settings-cache", () => ({
  isResponsesWebSocketEnabled: vi.fn(),
}));

vi.mock("@/app/v1/_lib/proxy/auth-guard", () => ({
  extractApiKeyFromHeaders: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("@/app/v1/_lib/proxy/session", () => ({
  ProxySession: {
    fromWebSocket: vi.fn(),
  },
}));

vi.mock("@/app/v1/_lib/proxy/guard-pipeline", () => ({
  GuardPipelineBuilder: {
    build: vi.fn(),
  },
}));

vi.mock("@/app/v1/_lib/proxy/transport-classifier", () => ({
  classifyTransport: vi.fn(),
}));

vi.mock("@/app/v1/_lib/ws/outbound-adapter", () => ({
  OutboundWsAdapter: vi.fn(),
}));

vi.mock("@/app/v1/_lib/ws/event-bridge", () => ({
  WsEventBridge: vi.fn(),
}));

vi.mock("@/app/v1/_lib/ws/billing-parity", () => ({
  settleWsTurnBilling: vi.fn(),
  buildWsTraceMetadata: vi.fn(),
}));

vi.mock("@/app/v1/_lib/ws/session-continuity", () => ({
  createWsTurnContext: vi.fn(),
  updateSessionFromTerminal: vi.fn(),
}));

vi.mock("@/repository/message", () => ({
  updateMessageRequestCost: vi.fn(),
  updateMessageRequestDetails: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { ProxySession } from "@/app/v1/_lib/proxy/session";
import { GuardPipelineBuilder } from "@/app/v1/_lib/proxy/guard-pipeline";
import { classifyTransport } from "@/app/v1/_lib/proxy/transport-classifier";
import { OutboundWsAdapter } from "@/app/v1/_lib/ws/outbound-adapter";
import { WsEventBridge } from "@/app/v1/_lib/ws/event-bridge";
import { settleWsTurnBilling, buildWsTraceMetadata } from "@/app/v1/_lib/ws/billing-parity";
import {
  createWsTurnContext,
  updateSessionFromTerminal,
} from "@/app/v1/_lib/ws/session-continuity";
import { updateMessageRequestCost, updateMessageRequestDetails } from "@/repository/message";
import { WsIngressHandler } from "@/app/v1/_lib/ws/ingress-handler";
import { extractApiKeyFromHeaders } from "@/app/v1/_lib/proxy/auth-guard";
import { isResponsesWebSocketEnabled } from "@/lib/config/system-settings-cache";
import { validateApiKeyAndGetUser } from "@/repository/key";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const validUser = { id: 1, name: "test-user", isEnabled: true, role: "user" };
const validKey = { id: 10, name: "test-key", userId: 1, isEnabled: true };
const validProvider = {
  id: 5,
  name: "test-provider",
  url: "https://api.openai.com",
  key: "sk-provider-key",
  providerType: "codex",
  costMultiplier: 1.0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WS_OPEN = 1;

function createMockWs() {
  const ws = new EventEmitter() as EventEmitter & {
    readyState: number;
    OPEN: number;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  ws.readyState = WS_OPEN;
  ws.OPEN = WS_OPEN;
  ws.send = vi.fn();
  ws.close = vi.fn();
  return ws;
}

function createMockReq(): IncomingMessage {
  return {
    url: "/v1/responses",
    headers: {
      host: "localhost:13500",
      authorization: "Bearer test-key",
    },
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as IncomingMessage;
}

function makeCreateFrame(model = "o3-pro", overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "response.create",
    response: { model, ...overrides },
  });
}

function makeCancelFrame(): string {
  return JSON.stringify({ type: "response.cancel" });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

function lastSentJson(ws: ReturnType<typeof createMockWs>): Record<string, unknown> | null {
  const calls = ws.send.mock.calls;
  if (calls.length === 0) return null;
  return JSON.parse(calls[calls.length - 1][0] as string) as Record<string, unknown>;
}

function createMockSession(provider: unknown = null) {
  return {
    provider,
    messageContext: provider
      ? { id: 42, createdAt: new Date(), user: validUser, key: validKey, apiKey: "test-key" }
      : null,
    sessionId: "sess-123",
    getProviderChain: vi.fn().mockReturnValue([]),
    getCachedPriceDataByBillingSource: vi.fn().mockResolvedValue(null),
    setAuthState: vi.fn(),
  } as unknown;
}

function makeCompletedSettlement(overrides: Record<string, unknown> = {}) {
  return {
    status: "completed",
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    model: "gpt-4o",
    serviceTier: "default",
    promptCacheKey: "cache-key-001",
    eventCount: 5,
    durationMs: 1200,
    terminalType: "response.completed",
    ...overrides,
  };
}

function makeCompletedTurnResult(overrides: Record<string, unknown> = {}) {
  return {
    completed: true,
    terminalType: "response.completed",
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    model: "gpt-4o",
    serviceTier: "default",
    events: [
      { type: "response.created", data: { type: "response.created" } },
      { type: "response.output_item.added", data: { type: "response.output_item.added" } },
      {
        type: "response.completed",
        data: {
          type: "response.completed",
          response: {
            status: "completed",
            usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
            model: "gpt-4o",
            service_tier: "default",
            prompt_cache_key: "cache-key-001",
          },
        },
      },
    ],
    handshakeMs: 45,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Auth mocks
  vi.mocked(isResponsesWebSocketEnabled).mockResolvedValue(true);
  vi.mocked(extractApiKeyFromHeaders).mockReturnValue("test-api-key");
  vi.mocked(validateApiKeyAndGetUser).mockResolvedValue({
    user: validUser as any,
    key: validKey as any,
  });

  // Pipeline mocks
  vi.mocked(ProxySession.fromWebSocket).mockReturnValue(createMockSession(validProvider) as any);
  vi.mocked(GuardPipelineBuilder.build).mockReturnValue({ run: mockPipelineRun });
  mockPipelineRun.mockResolvedValue(null); // No guard rejection

  // Transport
  vi.mocked(classifyTransport).mockResolvedValue({
    transport: "websocket",
    reason: "all_conditions_met",
  });

  // Adapter (configured here, not in vi.mock factory, to avoid hoisting issues)
  // biome-ignore lint/complexity/useArrowFunction: constructor mocks require function keyword
  vi.mocked(OutboundWsAdapter).mockImplementation(function () {
    return {
      executeTurn: mockExecuteTurn,
      close: mockAdapterClose,
    } as any;
  });
  mockExecuteTurn.mockResolvedValue(makeCompletedTurnResult());
  mockAdapterClose.mockReset();

  // Bridge (configured here, not in vi.mock factory, to avoid hoisting issues)
  // biome-ignore lint/complexity/useArrowFunction: constructor mocks require function keyword
  vi.mocked(WsEventBridge).mockImplementation(function () {
    const bridge = {
      relayEvent: mockRelayEvent,
      settleError: mockSettleError,
      getSettlement: mockGetSettlement,
      reset: mockBridgeReset,
    };
    Object.defineProperty(bridge, "isSettled", {
      get: () => mockBridgeIsSettledRef.value,
    });
    return bridge as any;
  });
  mockRelayEvent.mockReturnValue(false);
  mockBridgeIsSettledRef.value = true;
  mockGetSettlement.mockReturnValue(makeCompletedSettlement());
  mockSettleError.mockReset();
  mockBridgeReset.mockReset();

  // Billing
  vi.mocked(settleWsTurnBilling).mockReturnValue({
    usageMetrics: { input_tokens: 100, output_tokens: 50 },
    inputTokens: 100,
    outputTokens: 50,
    priorityServiceTierApplied: false,
    costUsd: "0.001500",
  } as any);
  vi.mocked(buildWsTraceMetadata).mockReturnValue({});

  // Session continuity
  vi.mocked(createWsTurnContext).mockReturnValue({
    model: "o3-pro",
    previousResponseId: undefined,
    promptCacheKey: undefined,
    transport: "websocket",
    startedAt: Date.now(),
    keyId: 10,
    userId: 1,
  });
  vi.mocked(updateSessionFromTerminal).mockResolvedValue({
    turnContext: {} as any,
    sessionUpdated: true,
  });

  // Message repo
  vi.mocked(updateMessageRequestCost).mockResolvedValue(undefined);
  vi.mocked(updateMessageRequestDetails).mockResolvedValue(undefined);
});

afterEach(() => {
  mockBridgeIsSettledRef.value = false;
});

// ===========================================================================
// handleTurn integration tests
// ===========================================================================

describe("WsIngressHandler handleTurn orchestration", () => {
  // -------------------------------------------------------------------------
  // Full successful turn
  // -------------------------------------------------------------------------

  describe("successful turn", () => {
    test("runs full pipeline: session -> guards -> adapter -> relay -> billing", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame("o3-pro"));
      await flush();

      // ProxySession created from WS context
      expect(ProxySession.fromWebSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "o3-pro",
        })
      );

      // Guard pipeline built with correct steps
      expect(GuardPipelineBuilder.build).toHaveBeenCalledWith({
        steps: ["model", "provider", "messageContext"],
      });

      // Pipeline ran
      expect(mockPipelineRun).toHaveBeenCalled();

      // Transport classified
      expect(classifyTransport).toHaveBeenCalled();

      // Adapter created and turn executed
      expect(OutboundWsAdapter).toHaveBeenCalledWith(
        expect.objectContaining({
          providerBaseUrl: "https://api.openai.com",
          apiKey: "sk-provider-key",
        })
      );
      expect(mockExecuteTurn).toHaveBeenCalled();

      // Billing settled
      expect(settleWsTurnBilling).toHaveBeenCalled();
      expect(updateMessageRequestCost).toHaveBeenCalledWith(42, "0.001500");
      expect(updateMessageRequestDetails).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          statusCode: 200,
          inputTokens: 100,
          outputTokens: 50,
          providerId: 5,
        })
      );

      // Session continuity
      expect(updateSessionFromTerminal).toHaveBeenCalled();

      // Trace metadata
      expect(buildWsTraceMetadata).toHaveBeenCalled();

      // State returned to waiting
      expect(handler.connectionState).toBe("waiting");
    });

    test("relays all events from adapter to client via bridge", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame());
      await flush();

      // 3 events in makeCompletedTurnResult
      expect(mockRelayEvent).toHaveBeenCalledTimes(3);
    });

    test("passes handshakeMs to trace metadata", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame());
      await flush();

      expect(buildWsTraceMetadata).toHaveBeenCalledWith(
        expect.objectContaining({ handshakeMs: 45 })
      );
    });
  });

  // -------------------------------------------------------------------------
  // Guard rejection
  // -------------------------------------------------------------------------

  describe("guard rejection", () => {
    test("sends error when model guard rejects", async () => {
      mockPipelineRun.mockResolvedValue(
        new Response(
          JSON.stringify({ error: { type: "forbidden", message: "Model o3-pro not allowed" } }),
          { status: 403 }
        )
      );

      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame("o3-pro"));
      await flush();

      // Error sent to client
      const sent = lastSentJson(ws);
      expect(sent?.type).toBe("error");
      expect((sent?.error as Record<string, unknown>)?.type).toBe("forbidden");
      expect((sent?.error as Record<string, unknown>)?.message).toBe("Model o3-pro not allowed");

      // No upstream call
      expect(mockExecuteTurn).not.toHaveBeenCalled();

      // No billing
      expect(settleWsTurnBilling).not.toHaveBeenCalled();
    });

    test("handles guard response with non-JSON body", async () => {
      mockPipelineRun.mockResolvedValue(new Response("plain text error", { status: 500 }));

      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame());
      await flush();

      const sent = lastSentJson(ws);
      expect(sent?.type).toBe("error");
      expect((sent?.error as Record<string, unknown>)?.type).toBe("guard_error");
      expect(mockExecuteTurn).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Provider failure
  // -------------------------------------------------------------------------

  describe("provider selection failure", () => {
    test("sends error when no provider is selected", async () => {
      vi.mocked(ProxySession.fromWebSocket).mockReturnValue(createMockSession(null) as any);

      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame());
      await flush();

      const sent = lastSentJson(ws);
      expect(sent?.type).toBe("error");
      expect((sent?.error as Record<string, unknown>)?.type).toBe("server_error");
      expect((sent?.error as Record<string, unknown>)?.message).toContain("No provider");

      expect(mockExecuteTurn).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Transport classified as HTTP
  // -------------------------------------------------------------------------

  describe("transport not websocket", () => {
    test("sends explicit error when transport is http", async () => {
      vi.mocked(classifyTransport).mockResolvedValue({
        transport: "http",
        reason: "provider_type_not_codex",
      });

      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame());
      await flush();

      const sent = lastSentJson(ws);
      expect(sent?.type).toBe("error");
      expect((sent?.error as Record<string, unknown>)?.type).toBe("invalid_request_error");
      expect((sent?.error as Record<string, unknown>)?.message as string).toContain(
        "WebSocket transport not available"
      );

      expect(mockExecuteTurn).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Outbound adapter error
  // -------------------------------------------------------------------------

  describe("outbound adapter error", () => {
    test("relays events and settles error on network failure", async () => {
      mockBridgeIsSettledRef.value = false;
      mockGetSettlement.mockReturnValue({
        status: "error",
        eventCount: 2,
        durationMs: 500,
        errorMessage: "Connection reset",
      });
      mockExecuteTurn.mockResolvedValue({
        completed: false,
        events: [
          { type: "response.created", data: { type: "response.created" } },
          { type: "response.output_item.added", data: { type: "response.output_item.added" } },
        ],
        error: new Error("Connection reset"),
      });

      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame());
      await flush();

      // Events relayed
      expect(mockRelayEvent).toHaveBeenCalledTimes(2);

      // Error settled on bridge
      expect(mockSettleError).toHaveBeenCalledWith("Connection reset");

      // Error sent to client (network error)
      const calls = ws.send.mock.calls;
      const errorFrame = calls.find((c: unknown[]) => {
        const parsed = JSON.parse(c[0] as string) as Record<string, unknown>;
        return (parsed.error as Record<string, unknown>)?.type === "server_error";
      });
      expect(errorFrame).toBeDefined();

      // Billing still runs (partial billing)
      expect(settleWsTurnBilling).toHaveBeenCalled();
    });

    test("does not double-send error for server error frames", async () => {
      mockBridgeIsSettledRef.value = false;
      const serverError = {
        type: "error",
        error: { type: "invalid_request_error", message: "Bad input" },
      };
      mockGetSettlement.mockReturnValue({
        status: "error",
        eventCount: 1,
        durationMs: 100,
        errorMessage: "Bad input",
      });
      mockExecuteTurn.mockResolvedValue({
        completed: false,
        events: [{ type: "error", data: serverError }],
        error: serverError, // ServerErrorFrame, not Error instance
      });

      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame());
      await flush();

      // Error settled
      expect(mockSettleError).toHaveBeenCalled();

      // No additional sendError (server error was already relayed via bridge)
      const sendCalls = ws.send.mock.calls;
      const serverErrors = sendCalls.filter((c: unknown[]) => {
        const parsed = JSON.parse(c[0] as string) as Record<string, unknown>;
        return (parsed.error as Record<string, unknown>)?.type === "server_error";
      });
      expect(serverErrors).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Cancel mid-stream
  // -------------------------------------------------------------------------

  describe("cancel mid-stream", () => {
    test("closes adapter on cancel during processing", async () => {
      // Make executeTurn hang indefinitely until cancelled
      let resolveTurn: (value: unknown) => void;
      mockExecuteTurn.mockReturnValue(
        new Promise((resolve) => {
          resolveTurn = resolve;
        })
      );

      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      // Start turn
      ws.emit("message", makeCreateFrame());
      expect(handler.connectionState).toBe("processing");

      // Let handleTurn advance past adapter creation (needs 2 microtask ticks:
      // pipeline.run + classifyTransport, then activeAdapter is set synchronously)
      for (let i = 0; i < 5; i++) await Promise.resolve();

      // Cancel mid-stream (activeAdapter is now set, executeTurn is hanging)
      ws.emit("message", makeCancelFrame());
      expect(handler.connectionState).toBe("waiting");
      expect(mockAdapterClose).toHaveBeenCalled();

      // Resolve the hanging turn to avoid unhandled promise
      resolveTurn!({
        completed: false,
        events: [],
        error: new Error("WebSocket closed unexpectedly: 1000 "),
      });
      await flush();
    });
  });

  // -------------------------------------------------------------------------
  // Terminal event settlement
  // -------------------------------------------------------------------------

  describe("billing settlement", () => {
    test("calculates cost with provider cost multiplier", async () => {
      const expensiveProvider = { ...validProvider, costMultiplier: 2.5 };
      vi.mocked(ProxySession.fromWebSocket).mockReturnValue(
        createMockSession(expensiveProvider) as any
      );

      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame());
      await flush();

      expect(settleWsTurnBilling).toHaveBeenCalledWith(
        expect.objectContaining({
          costMultiplier: 2.5,
        })
      );
    });

    test("maps incomplete status to 200", async () => {
      mockGetSettlement.mockReturnValue(makeCompletedSettlement({ status: "incomplete" }));

      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame());
      await flush();

      expect(updateMessageRequestDetails).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ statusCode: 200 })
      );
    });

    test("maps failed status to 500", async () => {
      mockGetSettlement.mockReturnValue(makeCompletedSettlement({ status: "failed" }));

      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame());
      await flush();

      expect(updateMessageRequestDetails).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ statusCode: 500 })
      );
    });

    test("skips billing when messageContext is null", async () => {
      const sessionNoContext = createMockSession(validProvider) as Record<string, unknown>;
      sessionNoContext.messageContext = null;
      vi.mocked(ProxySession.fromWebSocket).mockReturnValue(sessionNoContext as any);

      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame());
      await flush();

      expect(settleWsTurnBilling).not.toHaveBeenCalled();
      expect(updateMessageRequestCost).not.toHaveBeenCalled();
    });

    test("billing error does not fail the turn", async () => {
      vi.mocked(updateMessageRequestCost).mockRejectedValue(new Error("DB connection lost"));

      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame());
      await flush();

      // Turn still completes successfully
      expect(handler.connectionState).toBe("waiting");
      expect(handler.completedTurns).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Sequential turns
  // -------------------------------------------------------------------------

  describe("sequential turns", () => {
    test("second turn works after first settles", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      // Turn 1
      ws.emit("message", makeCreateFrame("gpt-4o"));
      await flush();
      expect(handler.connectionState).toBe("waiting");
      expect(handler.completedTurns).toBe(1);

      // Turn 2
      ws.emit("message", makeCreateFrame("o3-pro"));
      await flush();
      expect(handler.connectionState).toBe("waiting");
      expect(handler.completedTurns).toBe(2);

      // Both turns used the pipeline
      expect(mockPipelineRun).toHaveBeenCalledTimes(2);
      expect(mockExecuteTurn).toHaveBeenCalledTimes(2);
    });

    test("second turn after guard rejection works", async () => {
      // First turn: guard rejects
      mockPipelineRun.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { type: "forbidden", message: "Not allowed" } }), {
          status: 403,
        })
      );

      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame("bad-model"));
      await flush();
      expect(handler.connectionState).toBe("waiting");

      // Second turn: guard passes
      mockPipelineRun.mockResolvedValueOnce(null);
      ws.emit("message", makeCreateFrame("gpt-4o"));
      await flush();
      expect(handler.connectionState).toBe("waiting");
      expect(handler.completedTurns).toBe(2);
      expect(mockExecuteTurn).toHaveBeenCalledTimes(1); // Only second turn reached adapter
    });
  });

  // -------------------------------------------------------------------------
  // activeAdapter cleanup
  // -------------------------------------------------------------------------

  describe("activeAdapter lifecycle", () => {
    test("activeAdapter is cleared after successful turn", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame());
      await flush();

      // Cancel after turn completes should not call close (adapter already null)
      mockAdapterClose.mockClear();
      ws.emit("message", makeCancelFrame());
      expect(mockAdapterClose).not.toHaveBeenCalled();
    });

    test("activeAdapter is cleared even on error", async () => {
      mockExecuteTurn.mockRejectedValue(new Error("unexpected error"));

      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame());
      await flush();

      // Adapter should be cleaned up via finally
      mockAdapterClose.mockClear();
      ws.emit("message", makeCancelFrame());
      expect(mockAdapterClose).not.toHaveBeenCalled();
    });
  });
});
