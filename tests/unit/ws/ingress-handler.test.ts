import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock dependencies - factories return vi.fn() stubs.
// mockReset:true resets them between tests; beforeEach re-sets defaults.
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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { extractApiKeyFromHeaders } from "@/app/v1/_lib/proxy/auth-guard";
import {
  WsIngressHandler,
  registerIngressHandler,
  type ConnectionState,
} from "@/app/v1/_lib/ws/ingress-handler";
import { isResponsesWebSocketEnabled } from "@/lib/config/system-settings-cache";
import { validateApiKeyAndGetUser } from "@/repository/key";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const validUser = { id: 1, name: "test-user", isEnabled: true, role: "user" };
const validKey = { id: 10, name: "test-key", userId: 1, isEnabled: true };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WS_OPEN = 1;
const WS_CLOSED = 3;

function createMockWs(readyState = WS_OPEN) {
  const ws = new EventEmitter() as EventEmitter & {
    readyState: number;
    OPEN: number;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  ws.readyState = readyState;
  ws.OPEN = WS_OPEN;
  ws.send = vi.fn();
  ws.close = vi.fn();
  return ws;
}

function createMockReq(
  headers: Record<string, string> = {},
  remoteAddress = "127.0.0.1"
): IncomingMessage {
  return {
    url: "/v1/responses",
    headers: {
      host: "localhost:13500",
      authorization: "Bearer test-key",
      ...headers,
    },
    socket: { remoteAddress },
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

/** Flush the microtask queue (3 levels covers promise chains) */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

/** Parse the last sent JSON from ws.send */
function lastSentJson(ws: ReturnType<typeof createMockWs>): Record<string, unknown> | null {
  const calls = ws.send.mock.calls;
  if (calls.length === 0) return null;
  return JSON.parse(calls[calls.length - 1][0] as string) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.mocked(isResponsesWebSocketEnabled).mockResolvedValue(true);
  vi.mocked(extractApiKeyFromHeaders).mockReturnValue("test-api-key");
  vi.mocked(validateApiKeyAndGetUser).mockResolvedValue({
    user: validUser as any,
    key: validKey as any,
  });
});

// ===========================================================================
// WsIngressHandler
// ===========================================================================

describe("WsIngressHandler", () => {
  // -------------------------------------------------------------------------
  // Auth and toggle
  // -------------------------------------------------------------------------

  describe("auth and toggle", () => {
    test("authenticates at start time and sets up listeners", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      const ok = await handler.start();

      expect(ok).toBe(true);
      expect(handler.connectionState).toBe("waiting" satisfies ConnectionState);
      expect(handler.authContext).toBeTruthy();
      expect(handler.authContext!.user.id).toBe(1);
      expect(handler.authContext!.key.id).toBe(10);
    });

    test("closes with 4001 when no API key provided", async () => {
      vi.mocked(extractApiKeyFromHeaders).mockReturnValue(null);
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      const ok = await handler.start();

      expect(ok).toBe(false);
      expect(ws.close).toHaveBeenCalledWith(4001, expect.stringContaining("credentials"));
      expect(handler.connectionState).toBe("closed");
    });

    test("closes with 4001 when API key validation fails", async () => {
      vi.mocked(validateApiKeyAndGetUser).mockResolvedValue(null);
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      const ok = await handler.start();

      expect(ok).toBe(false);
      expect(ws.close).toHaveBeenCalledWith(4001, expect.stringContaining("invalid"));
      expect(handler.connectionState).toBe("closed");
    });

    test("closes with 4001 when user is disabled", async () => {
      vi.mocked(validateApiKeyAndGetUser).mockResolvedValue({
        user: { ...validUser, isEnabled: false } as any,
        key: validKey as any,
      });
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      const ok = await handler.start();

      expect(ok).toBe(false);
      expect(ws.close).toHaveBeenCalledWith(4001, expect.stringContaining("disabled"));
    });

    test("closes with 4003 when WS toggle is disabled", async () => {
      vi.mocked(isResponsesWebSocketEnabled).mockResolvedValue(false);
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      const ok = await handler.start();

      expect(ok).toBe(false);
      expect(ws.close).toHaveBeenCalledWith(4003, expect.stringContaining("disabled"));
    });

    test("exposes client IP from socket remote address", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq({}, "10.0.0.5"));
      await handler.start();

      expect(handler.clientIp).toBe("10.0.0.5");
    });

    test("prefers x-real-ip for client IP", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(
        ws as any,
        createMockReq({ "x-real-ip": "203.0.113.50" })
      );
      await handler.start();

      expect(handler.clientIp).toBe("203.0.113.50");
    });
  });

  // -------------------------------------------------------------------------
  // State transitions
  // -------------------------------------------------------------------------

  describe("state transitions", () => {
    test("transitions to processing on valid response.create", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame());

      // Synchronously in processing state
      expect(handler.connectionState).toBe("processing");
    });

    test("extracts model from response.create", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame("o3-pro"));

      expect(handler.currentTurnMeta?.model).toBe("o3-pro");
    });

    test("extracts service_tier from response.create", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame("o3-pro", { service_tier: "flex" }));

      expect(handler.currentTurnMeta?.serviceTier).toBe("flex");
    });

    test("extracts previous_response_id from response.create", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame("o3-pro", { previous_response_id: "resp_abc" }));

      expect(handler.currentTurnMeta?.previousResponseId).toBe("resp_abc");
    });

    test("returns to waiting after handleTurn completes", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame());
      expect(handler.connectionState).toBe("processing");

      await flush();

      expect(handler.connectionState).toBe("waiting");
      expect(handler.completedTurns).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Concurrent in-flight rejection
  // -------------------------------------------------------------------------

  describe("concurrent in-flight rejection", () => {
    test("rejects second response.create while processing", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      // First creates -> processing (synchronous)
      ws.emit("message", makeCreateFrame());
      expect(handler.connectionState).toBe("processing");

      // Second create while processing -> conflict error
      ws.emit("message", makeCreateFrame("o3-mini"));

      const calls = ws.send.mock.calls;
      const conflictMsg = calls.find((c: unknown[]) => {
        const parsed = JSON.parse(c[0] as string) as Record<string, unknown>;
        return (parsed.error as Record<string, unknown>)?.type === "conflict";
      });
      expect(conflictMsg).toBeDefined();
    });

    test("does not close socket on concurrent rejection (recoverable)", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame());
      ws.emit("message", makeCreateFrame());

      expect(ws.close).not.toHaveBeenCalled();
      expect(handler.connectionState).toBe("processing");
    });
  });

  // -------------------------------------------------------------------------
  // Sequential turns
  // -------------------------------------------------------------------------

  describe("sequential turns", () => {
    test("allows new response.create after turn completes", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      // Turn 1
      ws.emit("message", makeCreateFrame("o3-pro"));
      await flush();
      expect(handler.connectionState).toBe("waiting");
      expect(handler.completedTurns).toBe(1);

      // Turn 2
      ws.emit("message", makeCreateFrame("o3-mini"));
      await flush();
      expect(handler.connectionState).toBe("waiting");
      expect(handler.completedTurns).toBe(2);
    });

    test("clears turn metadata between turns", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame("o3-pro", { service_tier: "flex" }));
      await flush();

      expect(handler.currentTurnMeta).toBeNull();

      ws.emit("message", makeCreateFrame("o3-mini"));
      expect(handler.currentTurnMeta?.model).toBe("o3-mini");
      expect(handler.currentTurnMeta?.serviceTier).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // response.cancel
  // -------------------------------------------------------------------------

  describe("response.cancel", () => {
    test("transitions from processing to waiting on cancel", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCreateFrame());
      expect(handler.connectionState).toBe("processing");

      ws.emit("message", makeCancelFrame());
      expect(handler.connectionState).toBe("waiting");
      expect(handler.currentTurnMeta).toBeNull();
    });

    test("cancel while idle is silently ignored (no error)", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", makeCancelFrame());

      expect(handler.connectionState).toBe("waiting");
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Invalid frames
  // -------------------------------------------------------------------------

  describe("invalid frame handling", () => {
    test("sends error on invalid JSON", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", "not valid json{{{");

      expect(handler.connectionState).toBe("waiting");
      expect(ws.close).not.toHaveBeenCalled();
      const sent = lastSentJson(ws);
      expect(sent?.type).toBe("error");
      expect((sent?.error as Record<string, unknown>)?.type).toBe("invalid_request_error");
    });

    test("sends error on missing model in response.create", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", JSON.stringify({ type: "response.create", response: {} }));

      expect(handler.connectionState).toBe("waiting");
      const sent = lastSentJson(ws);
      expect(sent?.type).toBe("error");
      expect((sent?.error as Record<string, unknown>)?.type).toBe("invalid_request_error");
    });

    test("sends error on unknown frame type", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", JSON.stringify({ type: "session.update" }));

      const sent = lastSentJson(ws);
      expect(sent?.type).toBe("error");
      expect((sent?.error as Record<string, unknown>)?.type).toBe("invalid_request_error");
    });
  });

  // -------------------------------------------------------------------------
  // Socket lifecycle
  // -------------------------------------------------------------------------

  describe("socket lifecycle", () => {
    test("connection close sets state to closed", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("close");

      expect(handler.connectionState).toBe("closed");
    });

    test("connection error sets state to closed", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("error", new Error("socket hang up"));

      expect(handler.connectionState).toBe("closed");
    });

    test("messages received after close are ignored", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("close");
      ws.emit("message", makeCreateFrame());
      await flush();

      expect(handler.completedTurns).toBe(0);
    });

    test("sendError skips when readyState is not OPEN", async () => {
      const ws = createMockWs(WS_CLOSED);
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      ws.emit("message", "bad json");
      await flush();

      expect(ws.send).not.toHaveBeenCalled();
    });

    test("handleTurn error sends server_error and returns to waiting", async () => {
      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq());
      await handler.start();

      // Override handleTurn to throw
      handler.handleTurn = async () => {
        throw new Error("upstream exploded");
      };

      ws.emit("message", makeCreateFrame());
      await flush();

      expect(handler.connectionState).toBe("waiting");
      const calls = ws.send.mock.calls;
      const errorMsg = calls.find((c: unknown[]) => {
        const parsed = JSON.parse(c[0] as string) as Record<string, unknown>;
        return (
          (parsed.error as Record<string, unknown>)?.type === "server_error" &&
          ((parsed.error as Record<string, unknown>)?.message as string)?.includes(
            "upstream exploded"
          )
        );
      });
      expect(errorMsg).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // First-frame timeout
  // -------------------------------------------------------------------------

  describe("first-frame timeout", () => {
    test("fires when no response.create received", async () => {
      vi.useFakeTimers();

      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq(), {
        firstFrameTimeoutMs: 5000,
      });
      await handler.start();

      vi.advanceTimersByTime(5001);

      expect(handler.connectionState).toBe("closed");
      expect(ws.close).toHaveBeenCalledWith(1000);
      const sent = lastSentJson(ws);
      expect(sent?.type).toBe("error");
      expect((sent?.error as Record<string, unknown>)?.type).toBe("timeout");

      vi.useRealTimers();
    });

    test("is cleared when response.create arrives in time", async () => {
      vi.useFakeTimers();

      const ws = createMockWs();
      const handler = new WsIngressHandler(ws as any, createMockReq(), {
        firstFrameTimeoutMs: 5000,
      });
      await handler.start();

      ws.emit("message", makeCreateFrame());
      // Advance well past the timeout
      vi.advanceTimersByTime(10000);

      // State should not be closed (timer was cleared)
      expect(handler.connectionState).not.toBe("closed");
      expect(ws.close).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});

// ===========================================================================
// registerIngressHandler
// ===========================================================================

describe("registerIngressHandler", () => {
  test("wires handler to WsManager onConnection", async () => {
    let capturedHandler: ((ws: any, req: any) => Promise<void>) | null = null;
    const mockManager = {
      onConnection: vi.fn((handler: (ws: any, req: any) => Promise<void>) => {
        capturedHandler = handler;
      }),
    };

    registerIngressHandler(mockManager as any);

    expect(mockManager.onConnection).toHaveBeenCalledOnce();
    expect(capturedHandler).toBeTypeOf("function");

    // Call the handler - should create WsIngressHandler and start it
    const ws = createMockWs();
    await capturedHandler!(ws, createMockReq());

    // After successful start(), listeners should be set up
    expect(ws.listenerCount("message")).toBeGreaterThan(0);
    expect(ws.listenerCount("close")).toBeGreaterThan(0);
    expect(ws.listenerCount("error")).toBeGreaterThan(0);
  });

  test("rejected connection does not set up listeners", async () => {
    vi.mocked(isResponsesWebSocketEnabled).mockResolvedValue(false);

    let capturedHandler: ((ws: any, req: any) => Promise<void>) | null = null;
    const mockManager = {
      onConnection: vi.fn((handler: (ws: any, req: any) => Promise<void>) => {
        capturedHandler = handler;
      }),
    };

    registerIngressHandler(mockManager as any);

    const ws = createMockWs();
    await capturedHandler!(ws, createMockReq());

    // No message listeners - connection was rejected
    expect(ws.listenerCount("message")).toBe(0);
    expect(ws.close).toHaveBeenCalledWith(4003, expect.any(String));
  });
});
