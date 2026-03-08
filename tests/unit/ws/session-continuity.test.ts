import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks (must be declared before imports that depend on them)
// ---------------------------------------------------------------------------

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  },
}));

const mockUpdateSessionWithCodexCacheKey = vi.fn();

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    updateSessionWithCodexCacheKey: (...args: unknown[]) =>
      mockUpdateSessionWithCodexCacheKey(...args),
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  createWsTurnContext,
  updateSessionFromTerminal,
  classifyDisconnect,
  isNeutralFallback,
  type WsTurnContext,
  type TurnPhase,
  type DisconnectClassification,
} from "@/app/v1/_lib/ws/session-continuity";
import type { SettlementResult } from "@/app/v1/_lib/ws/event-bridge";
import type { TurnMeta, WsAuthContext } from "@/app/v1/_lib/ws/ingress-handler";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockAuth(overrides?: Partial<WsAuthContext>): WsAuthContext {
  return {
    user: { id: 42, name: "test-user", isEnabled: true } as any,
    key: { id: 7, name: "test-key" } as any,
    apiKey: "sk-test-key-12345",
    ...overrides,
  };
}

function createMockTurnMeta(overrides?: Partial<TurnMeta>): TurnMeta {
  return {
    model: "gpt-4o",
    serviceTier: "default",
    previousResponseId: undefined,
    frame: {
      type: "response.create" as const,
      response: { model: "gpt-4o" },
    } as any,
    ...overrides,
  };
}

function createMockSettlement(overrides?: Partial<SettlementResult>): SettlementResult {
  return {
    status: "completed",
    eventCount: 10,
    durationMs: 1500,
    model: "gpt-4o",
    serviceTier: "default",
    promptCacheKey: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("session-continuity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // createWsTurnContext
  // =========================================================================

  describe("createWsTurnContext", () => {
    it("creates proper context from auth and turn meta", () => {
      const auth = createMockAuth();
      const turnMeta = createMockTurnMeta({ model: "o3-pro" });

      const ctx = createWsTurnContext(auth, turnMeta);

      expect(ctx.model).toBe("o3-pro");
      expect(ctx.previousResponseId).toBeUndefined();
      expect(ctx.promptCacheKey).toBeUndefined();
      expect(ctx.transport).toBe("websocket");
      expect(ctx.keyId).toBe(7);
      expect(ctx.userId).toBe(42);
      expect(ctx.startedAt).toBeGreaterThan(0);
    });

    it("preserves previousResponseId from turn meta", () => {
      const auth = createMockAuth();
      const turnMeta = createMockTurnMeta({
        previousResponseId: "resp_abc123def456789012345",
      });

      const ctx = createWsTurnContext(auth, turnMeta);

      expect(ctx.previousResponseId).toBe("resp_abc123def456789012345");
    });

    it("extracts keyId and userId from auth context", () => {
      const auth = createMockAuth({
        user: { id: 99, name: "admin", isEnabled: true } as any,
        key: { id: 15, name: "admin-key" } as any,
      });
      const turnMeta = createMockTurnMeta();

      const ctx = createWsTurnContext(auth, turnMeta);

      expect(ctx.keyId).toBe(15);
      expect(ctx.userId).toBe(99);
    });

    it("always sets transport to websocket", () => {
      const ctx = createWsTurnContext(createMockAuth(), createMockTurnMeta());
      expect(ctx.transport).toBe("websocket");
    });
  });

  // =========================================================================
  // updateSessionFromTerminal
  // =========================================================================

  describe("updateSessionFromTerminal", () => {
    it("extracts prompt_cache_key from settlement and updates session binding", async () => {
      mockUpdateSessionWithCodexCacheKey.mockResolvedValue({
        sessionId: "codex_cache-key-001",
        updated: true,
      });

      const ctx = createWsTurnContext(createMockAuth(), createMockTurnMeta());
      const settlement = createMockSettlement({
        promptCacheKey: "cache-key-001",
      });

      const result = await updateSessionFromTerminal(ctx, settlement, "session-123", 5);

      expect(result.sessionUpdated).toBe(true);
      expect(result.turnContext.promptCacheKey).toBe("cache-key-001");
      expect(mockUpdateSessionWithCodexCacheKey).toHaveBeenCalledWith(
        "session-123",
        "cache-key-001",
        5
      );
    });

    it("returns sessionUpdated=false when no prompt_cache_key in settlement", async () => {
      const ctx = createWsTurnContext(createMockAuth(), createMockTurnMeta());
      const settlement = createMockSettlement({ promptCacheKey: undefined });

      const result = await updateSessionFromTerminal(ctx, settlement, "session-123", 5);

      expect(result.sessionUpdated).toBe(false);
      expect(result.turnContext.promptCacheKey).toBeUndefined();
      expect(mockUpdateSessionWithCodexCacheKey).not.toHaveBeenCalled();
    });

    it("populates turnContext.promptCacheKey even when sessionId is null", async () => {
      const ctx = createWsTurnContext(createMockAuth(), createMockTurnMeta());
      const settlement = createMockSettlement({
        promptCacheKey: "cache-key-002",
      });

      const result = await updateSessionFromTerminal(ctx, settlement, null, 5);

      expect(result.sessionUpdated).toBe(false);
      expect(result.turnContext.promptCacheKey).toBe("cache-key-002");
      expect(mockUpdateSessionWithCodexCacheKey).not.toHaveBeenCalled();
    });

    it("populates turnContext.promptCacheKey even when providerId is null", async () => {
      const ctx = createWsTurnContext(createMockAuth(), createMockTurnMeta());
      const settlement = createMockSettlement({
        promptCacheKey: "cache-key-003",
      });

      const result = await updateSessionFromTerminal(ctx, settlement, "session-123", null);

      expect(result.sessionUpdated).toBe(false);
      expect(result.turnContext.promptCacheKey).toBe("cache-key-003");
      expect(mockUpdateSessionWithCodexCacheKey).not.toHaveBeenCalled();
    });

    it("handles SessionManager errors gracefully without throwing", async () => {
      mockUpdateSessionWithCodexCacheKey.mockRejectedValue(new Error("Redis connection failed"));

      const ctx = createWsTurnContext(createMockAuth(), createMockTurnMeta());
      const settlement = createMockSettlement({
        promptCacheKey: "cache-key-004",
      });

      const result = await updateSessionFromTerminal(ctx, settlement, "session-123", 5);

      expect(result.sessionUpdated).toBe(false);
      expect(result.turnContext.promptCacheKey).toBe("cache-key-004");
    });

    it("returns sessionUpdated=false when SessionManager reports no update", async () => {
      mockUpdateSessionWithCodexCacheKey.mockResolvedValue({
        sessionId: "codex_existing-key",
        updated: false,
      });

      const ctx = createWsTurnContext(createMockAuth(), createMockTurnMeta());
      const settlement = createMockSettlement({
        promptCacheKey: "existing-key",
      });

      const result = await updateSessionFromTerminal(ctx, settlement, "session-123", 5);

      expect(result.sessionUpdated).toBe(false);
      expect(result.turnContext.promptCacheKey).toBe("existing-key");
    });
  });

  // =========================================================================
  // classifyDisconnect
  // =========================================================================

  describe("classifyDisconnect", () => {
    it('returns "retryable" for setup phase (pre-stream) errors', () => {
      expect(classifyDisconnect("setup")).toBe("retryable");
    });

    it('returns "retryable" for setup phase with generic transport error', () => {
      expect(classifyDisconnect("setup", "ECONNREFUSED")).toBe("retryable");
    });

    it('returns "terminal" for streaming phase (mid-stream breaks)', () => {
      expect(classifyDisconnect("streaming")).toBe("terminal");
    });

    it('returns "terminal" for settled phase', () => {
      expect(classifyDisconnect("settled")).toBe("terminal");
    });

    it('returns "terminal" for previous_response_not_found regardless of phase', () => {
      // This error must be surfaced as explicit protocol error, never silently retried
      expect(classifyDisconnect("setup", "previous_response_not_found")).toBe("terminal");
      expect(classifyDisconnect("streaming", "previous_response_not_found")).toBe("terminal");
      expect(classifyDisconnect("settled", "previous_response_not_found")).toBe("terminal");
    });

    it('returns "terminal" for websocket_connection_limit_reached regardless of phase', () => {
      // This error must be surfaced as explicit protocol error
      expect(classifyDisconnect("setup", "websocket_connection_limit_reached")).toBe("terminal");
      expect(classifyDisconnect("streaming", "websocket_connection_limit_reached")).toBe(
        "terminal"
      );
      expect(classifyDisconnect("settled", "websocket_connection_limit_reached")).toBe("terminal");
    });

    it("does NOT silently retry mid-stream disconnects (no hidden HTTP replay)", () => {
      // Critical invariant: once upstream has started streaming events,
      // a disconnect MUST fail the turn explicitly.
      const midStreamErrors = ["ECONNRESET", "ETIMEDOUT", "EPIPE", undefined];
      for (const code of midStreamErrors) {
        const result = classifyDisconnect("streaming", code);
        expect(result).toBe("terminal");
      }
    });

    it("handles undefined errorCode gracefully", () => {
      expect(classifyDisconnect("setup", undefined)).toBe("retryable");
      expect(classifyDisconnect("streaming", undefined)).toBe("terminal");
    });
  });

  // =========================================================================
  // isNeutralFallback
  // =========================================================================

  describe("isNeutralFallback", () => {
    // --- Transport/setup failures: should be neutral ---

    it("identifies ECONNREFUSED as neutral fallback", () => {
      expect(isNeutralFallback(new Error("connect ECONNREFUSED 127.0.0.1:443"))).toBe(true);
    });

    it("identifies ECONNRESET as neutral fallback", () => {
      expect(isNeutralFallback(new Error("read ECONNRESET"))).toBe(true);
    });

    it("identifies ETIMEDOUT as neutral fallback", () => {
      expect(isNeutralFallback(new Error("connect ETIMEDOUT"))).toBe(true);
    });

    it("identifies EHOSTUNREACH as neutral fallback", () => {
      expect(isNeutralFallback(new Error("connect EHOSTUNREACH"))).toBe(true);
    });

    it("identifies ENOTFOUND as neutral fallback", () => {
      expect(isNeutralFallback(new Error("getaddrinfo ENOTFOUND api.example.com"))).toBe(true);
    });

    it("identifies handshake timeout as neutral fallback", () => {
      expect(isNeutralFallback(new Error("WebSocket handshake timeout"))).toBe(true);
    });

    it("identifies WebSocket upgrade rejection as neutral fallback", () => {
      expect(isNeutralFallback(new Error("WebSocket upgrade rejected"))).toBe(true);
    });

    it("identifies socket hang up as neutral fallback", () => {
      expect(isNeutralFallback(new Error("socket hang up"))).toBe(true);
    });

    // --- Explicit protocol errors: NOT neutral ---

    it("does NOT identify previous_response_not_found as neutral (by code)", () => {
      expect(isNeutralFallback({ code: "previous_response_not_found", message: "Not found" })).toBe(
        false
      );
    });

    it("does NOT identify previous_response_not_found as neutral (by type)", () => {
      expect(
        isNeutralFallback({
          type: "previous_response_not_found",
          message: "Previous response not found",
        })
      ).toBe(false);
    });

    it("does NOT identify previous_response_not_found as neutral (by message)", () => {
      expect(isNeutralFallback(new Error("previous_response_not_found: resp_abc not found"))).toBe(
        false
      );
    });

    it("does NOT identify websocket_connection_limit_reached as neutral (by code)", () => {
      expect(
        isNeutralFallback({
          code: "websocket_connection_limit_reached",
          message: "Connection limit reached",
        })
      ).toBe(false);
    });

    it("does NOT identify websocket_connection_limit_reached as neutral (by type)", () => {
      expect(
        isNeutralFallback({
          type: "websocket_connection_limit_reached",
          message: "Limit reached",
        })
      ).toBe(false);
    });

    it("does NOT identify websocket_connection_limit_reached as neutral (by message)", () => {
      // Even though message contains "websocket", the explicit error name takes precedence
      expect(
        isNeutralFallback(new Error("websocket_connection_limit_reached: too many connections"))
      ).toBe(false);
    });

    // --- Generic API errors: NOT neutral ---

    it("does NOT identify rate limit errors as neutral", () => {
      expect(isNeutralFallback(new Error("Rate limit exceeded"))).toBe(false);
    });

    it("does NOT identify internal server errors as neutral", () => {
      expect(isNeutralFallback(new Error("Internal server error"))).toBe(false);
    });

    it("does NOT identify authentication errors as neutral", () => {
      expect(isNeutralFallback(new Error("Invalid API key"))).toBe(false);
    });

    it("does NOT identify model errors as neutral", () => {
      expect(isNeutralFallback(new Error("Model not found: o3-pro"))).toBe(false);
    });
  });
});
