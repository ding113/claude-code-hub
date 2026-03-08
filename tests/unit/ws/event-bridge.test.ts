import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock: logger
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

import {
  WsEventBridge,
  type SettlementResult,
  type SettlementStatus,
  type EventBridgeOptions,
} from "@/app/v1/_lib/ws/event-bridge";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WS_OPEN = 1;
const WS_CLOSED = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockWs(readyState = WS_OPEN) {
  return {
    readyState,
    OPEN: WS_OPEN,
    send: vi.fn(),
  } as any;
}

function makeNonTerminalEvent(type = "response.output_text.delta") {
  const data = { type, delta: "hello", item_id: "item_1", output_index: 0, content_index: 0 };
  return {
    eventData: { type, data },
    rawJson: JSON.stringify(data),
  };
}

function makeCreatedEvent() {
  const type = "response.created";
  const data = { type, response: { id: "resp_123", status: "in_progress" } };
  return {
    eventData: { type, data },
    rawJson: JSON.stringify(data),
  };
}

function makeTerminalEvent(
  status: "completed" | "failed" | "incomplete" = "completed",
  responseOverrides?: Record<string, unknown>
) {
  const type = `response.${status}`;
  const response = {
    id: "resp_123",
    status,
    model: "gpt-4o",
    service_tier: "default",
    prompt_cache_key: "cache-key-001",
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
    },
    ...responseOverrides,
  };
  const data = { type, response };
  return {
    eventData: { type, data },
    rawJson: JSON.stringify(data),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WsEventBridge", () => {
  let bridge: WsEventBridge;

  beforeEach(() => {
    bridge = new WsEventBridge();
  });

  // =========================================================================
  // relayEvent: forwarding
  // =========================================================================

  describe("relayEvent forwarding", () => {
    it("forwards raw JSON to client WS when OPEN", () => {
      const ws = createMockWs(WS_OPEN);
      const { eventData, rawJson } = makeNonTerminalEvent();

      bridge.relayEvent(ws, eventData, rawJson);

      expect(ws.send).toHaveBeenCalledOnce();
      expect(ws.send).toHaveBeenCalledWith(rawJson);
    });

    it("does NOT send when client WS is not OPEN", () => {
      const ws = createMockWs(WS_CLOSED);
      const { eventData, rawJson } = makeNonTerminalEvent();

      bridge.relayEvent(ws, eventData, rawJson);

      expect(ws.send).not.toHaveBeenCalled();
    });

    it("forwards raw JSON unchanged (no re-serialization)", () => {
      const ws = createMockWs(WS_OPEN);
      const customRawJson = '{"type":"response.created","response":{"id":"resp_abc"}}';
      const eventData = { type: "response.created", data: JSON.parse(customRawJson) };

      bridge.relayEvent(ws, eventData, customRawJson);

      expect(ws.send).toHaveBeenCalledWith(customRawJson);
    });
  });

  // =========================================================================
  // Ring buffer: bounded behavior
  // =========================================================================

  describe("ring buffer bounded behavior", () => {
    it("stays bounded at maxBufferSize under burst", () => {
      const smallBridge = new WsEventBridge({ maxBufferSize: 50 });
      const ws = createMockWs();

      // Send 200 events into a buffer of size 50
      for (let i = 0; i < 200; i++) {
        const { eventData, rawJson } = makeNonTerminalEvent(`event_${i}`);
        smallBridge.relayEvent(ws, eventData, rawJson);
      }

      const recent = smallBridge.getRecentEvents();
      expect(recent).toHaveLength(50);
      expect(smallBridge.totalEvents).toBe(200);
    });

    it("overwrites oldest entries correctly (verify chronological order)", () => {
      const tinyBridge = new WsEventBridge({ maxBufferSize: 3 });
      const ws = createMockWs();

      // Send 5 events, buffer size 3 => should keep last 3
      for (let i = 0; i < 5; i++) {
        const { eventData, rawJson } = makeNonTerminalEvent(`event_${i}`);
        tinyBridge.relayEvent(ws, eventData, rawJson);
      }

      const recent = tinyBridge.getRecentEvents();
      expect(recent).toHaveLength(3);
      // Should be in chronological order: event_2, event_3, event_4
      expect(recent[0].type).toBe("event_2");
      expect(recent[1].type).toBe("event_3");
      expect(recent[2].type).toBe("event_4");
    });

    it("getRecentEvents returns events in chronological order when buffer not full", () => {
      const ws = createMockWs();

      bridge.relayEvent(ws, { type: "a", data: { type: "a" } }, '{"type":"a"}');
      bridge.relayEvent(ws, { type: "b", data: { type: "b" } }, '{"type":"b"}');

      const recent = bridge.getRecentEvents();
      expect(recent).toHaveLength(2);
      expect(recent[0].type).toBe("a");
      expect(recent[1].type).toBe("b");
    });

    it("getRecentEvents returns empty array before any events", () => {
      const recent = bridge.getRecentEvents();
      expect(recent).toHaveLength(0);
    });

    it("uses default maxBufferSize of 100", () => {
      const ws = createMockWs();

      for (let i = 0; i < 150; i++) {
        const { eventData, rawJson } = makeNonTerminalEvent(`ev_${i}`);
        bridge.relayEvent(ws, eventData, rawJson);
      }

      const recent = bridge.getRecentEvents();
      expect(recent).toHaveLength(100);
    });
  });

  // =========================================================================
  // Terminal event detection and settlement
  // =========================================================================

  describe("terminal event detection", () => {
    it.each([
      { status: "completed" as const, expectedStatus: "completed" },
      { status: "failed" as const, expectedStatus: "failed" },
      { status: "incomplete" as const, expectedStatus: "incomplete" },
    ])("response.$status terminal event extracts settlement data (status=$expectedStatus)", ({
      status,
      expectedStatus,
    }) => {
      const ws = createMockWs();
      const { eventData, rawJson } = makeTerminalEvent(status);

      const isTerminal = bridge.relayEvent(ws, eventData, rawJson);

      expect(isTerminal).toBe(true);
      const settlement = bridge.getSettlement();
      expect(settlement).not.toBeNull();
      expect(settlement!.status).toBe(expectedStatus);
    });

    it("response.completed terminal event extracts usage, model, serviceTier, promptCacheKey", () => {
      const ws = createMockWs();
      const { eventData, rawJson } = makeTerminalEvent("completed");

      bridge.relayEvent(ws, eventData, rawJson);

      const settlement = bridge.getSettlement()!;
      expect(settlement.status).toBe("completed");
      expect(settlement.usage).toEqual({
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
      });
      expect(settlement.model).toBe("gpt-4o");
      expect(settlement.serviceTier).toBe("default");
      expect(settlement.promptCacheKey).toBe("cache-key-001");
      expect(settlement.terminalType).toBe("response.completed");
    });

    it("response.failed terminal event sets status to failed", () => {
      const ws = createMockWs();
      const { eventData, rawJson } = makeTerminalEvent("failed");

      bridge.relayEvent(ws, eventData, rawJson);

      const settlement = bridge.getSettlement()!;
      expect(settlement.status).toBe("failed");
      expect(settlement.terminalType).toBe("response.failed");
    });

    it("response.incomplete terminal event sets status to incomplete", () => {
      const ws = createMockWs();
      const { eventData, rawJson } = makeTerminalEvent("incomplete");

      bridge.relayEvent(ws, eventData, rawJson);

      const settlement = bridge.getSettlement()!;
      expect(settlement.status).toBe("incomplete");
      expect(settlement.terminalType).toBe("response.incomplete");
    });

    it("relayEvent returns true for terminal events, false otherwise", () => {
      const ws = createMockWs();

      // Non-terminal
      const delta = makeNonTerminalEvent();
      expect(bridge.relayEvent(ws, delta.eventData, delta.rawJson)).toBe(false);

      const created = makeCreatedEvent();
      expect(bridge.relayEvent(ws, created.eventData, created.rawJson)).toBe(false);

      // Terminal
      const terminal = makeTerminalEvent("completed");
      expect(bridge.relayEvent(ws, terminal.eventData, terminal.rawJson)).toBe(true);
    });

    it("usage is ONLY extracted from terminal events, not from deltas", () => {
      const ws = createMockWs();

      // Send a non-terminal event that happens to have usage-like data
      const fakeUsageEvent = {
        type: "response.created",
        data: {
          type: "response.created",
          response: {
            id: "resp_1",
            status: "in_progress",
            usage: { input_tokens: 999, output_tokens: 999 },
          },
        },
      };
      bridge.relayEvent(ws, fakeUsageEvent, JSON.stringify(fakeUsageEvent.data));

      // No settlement yet
      expect(bridge.getSettlement()).toBeNull();
      expect(bridge.isSettled).toBe(false);

      // Now send terminal event with real usage
      const { eventData, rawJson } = makeTerminalEvent("completed");
      bridge.relayEvent(ws, eventData, rawJson);

      const settlement = bridge.getSettlement()!;
      expect(settlement.usage!.input_tokens).toBe(100);
      expect(settlement.usage!.output_tokens).toBe(50);
    });

    it("handles terminal event without usage gracefully", () => {
      const ws = createMockWs();
      const { eventData, rawJson } = makeTerminalEvent("completed", { usage: undefined });

      bridge.relayEvent(ws, eventData, rawJson);

      const settlement = bridge.getSettlement()!;
      expect(settlement.status).toBe("completed");
      expect(settlement.usage).toBeUndefined();
    });

    it("handles malformed terminal event data (parse error)", () => {
      const ws = createMockWs();
      // A terminal event type but with bad response structure
      const badData = { type: "response.completed", response: "not-an-object" };
      const eventData = { type: "response.completed", data: badData };

      bridge.relayEvent(ws, eventData, JSON.stringify(badData));

      const settlement = bridge.getSettlement()!;
      expect(settlement.status).toBe("error");
      expect(settlement.errorMessage).toContain("Terminal event parse error");
      expect(settlement.terminalType).toBe("response.completed");
    });
  });

  // =========================================================================
  // settleError
  // =========================================================================

  describe("settleError", () => {
    it("records disconnection when no terminal event", () => {
      bridge.settleError("WebSocket closed unexpectedly", "disconnected");

      const settlement = bridge.getSettlement()!;
      expect(settlement.status).toBe("disconnected");
      expect(settlement.errorMessage).toBe("WebSocket closed unexpectedly");
      expect(settlement.eventCount).toBe(0);
    });

    it("records error with default status", () => {
      bridge.settleError("Something went wrong");

      const settlement = bridge.getSettlement()!;
      expect(settlement.status).toBe("error");
      expect(settlement.errorMessage).toBe("Something went wrong");
    });

    it("does not overwrite existing settlement", () => {
      const ws = createMockWs();
      const { eventData, rawJson } = makeTerminalEvent("completed");

      // Settle via terminal event first
      bridge.relayEvent(ws, eventData, rawJson);
      expect(bridge.getSettlement()!.status).toBe("completed");

      // Attempt to overwrite with error
      bridge.settleError("late error");

      // Original settlement preserved
      expect(bridge.getSettlement()!.status).toBe("completed");
    });

    it("includes duration from first event when available", () => {
      const ws = createMockWs();
      const { eventData, rawJson } = makeNonTerminalEvent();

      // Send an event to set startTime
      bridge.relayEvent(ws, eventData, rawJson);

      bridge.settleError("disconnect");

      const settlement = bridge.getSettlement()!;
      expect(settlement.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("durationMs is 0 when no events were received", () => {
      bridge.settleError("immediate disconnect");

      const settlement = bridge.getSettlement()!;
      expect(settlement.durationMs).toBe(0);
    });
  });

  // =========================================================================
  // getSettlement
  // =========================================================================

  describe("getSettlement", () => {
    it("returns null before any terminal event or error", () => {
      expect(bridge.getSettlement()).toBeNull();
    });

    it("returns settlement after terminal event", () => {
      const ws = createMockWs();
      const { eventData, rawJson } = makeTerminalEvent("completed");

      bridge.relayEvent(ws, eventData, rawJson);

      expect(bridge.getSettlement()).not.toBeNull();
    });
  });

  // =========================================================================
  // isSettled
  // =========================================================================

  describe("isSettled", () => {
    it("is false before terminal event", () => {
      expect(bridge.isSettled).toBe(false);
    });

    it("is false after only non-terminal events", () => {
      const ws = createMockWs();
      const { eventData, rawJson } = makeNonTerminalEvent();

      bridge.relayEvent(ws, eventData, rawJson);

      expect(bridge.isSettled).toBe(false);
    });

    it("is true after terminal event", () => {
      const ws = createMockWs();
      const { eventData, rawJson } = makeTerminalEvent("completed");

      bridge.relayEvent(ws, eventData, rawJson);

      expect(bridge.isSettled).toBe(true);
    });

    it("is true after settleError", () => {
      bridge.settleError("error");

      expect(bridge.isSettled).toBe(true);
    });
  });

  // =========================================================================
  // totalEvents
  // =========================================================================

  describe("totalEvents", () => {
    it("counts all events including non-terminal", () => {
      const ws = createMockWs();

      bridge.relayEvent(ws, makeCreatedEvent().eventData, makeCreatedEvent().rawJson);
      bridge.relayEvent(ws, makeNonTerminalEvent().eventData, makeNonTerminalEvent().rawJson);
      bridge.relayEvent(
        ws,
        makeNonTerminalEvent("response.output_text.done").eventData,
        makeNonTerminalEvent("response.output_text.done").rawJson
      );
      bridge.relayEvent(
        ws,
        makeTerminalEvent("completed").eventData,
        makeTerminalEvent("completed").rawJson
      );

      expect(bridge.totalEvents).toBe(4);
    });

    it("starts at zero", () => {
      expect(bridge.totalEvents).toBe(0);
    });
  });

  // =========================================================================
  // durationMs
  // =========================================================================

  describe("durationMs", () => {
    it("measures from first event to terminal", () => {
      const ws = createMockWs();

      // First event
      const { eventData: ev1, rawJson: rj1 } = makeNonTerminalEvent();
      bridge.relayEvent(ws, ev1, rj1);

      // Terminal event
      const { eventData: ev2, rawJson: rj2 } = makeTerminalEvent("completed");
      bridge.relayEvent(ws, ev2, rj2);

      const settlement = bridge.getSettlement()!;
      // durationMs should be >= 0 (nearly instant in test)
      expect(settlement.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("durationMs is measured from first event even when terminal is the only event", () => {
      const ws = createMockWs();
      const { eventData, rawJson } = makeTerminalEvent("completed");

      bridge.relayEvent(ws, eventData, rawJson);

      const settlement = bridge.getSettlement()!;
      expect(settlement.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // =========================================================================
  // reset
  // =========================================================================

  describe("reset", () => {
    it("clears all state for sequential turn reuse", () => {
      const ws = createMockWs();

      // First turn: send events and settle
      bridge.relayEvent(ws, makeNonTerminalEvent().eventData, makeNonTerminalEvent().rawJson);
      bridge.relayEvent(
        ws,
        makeTerminalEvent("completed").eventData,
        makeTerminalEvent("completed").rawJson
      );

      expect(bridge.isSettled).toBe(true);
      expect(bridge.totalEvents).toBe(2);
      expect(bridge.getRecentEvents()).toHaveLength(2);

      // Reset
      bridge.reset();

      // All state cleared
      expect(bridge.isSettled).toBe(false);
      expect(bridge.totalEvents).toBe(0);
      expect(bridge.getSettlement()).toBeNull();
      expect(bridge.getRecentEvents()).toHaveLength(0);
    });

    it("allows new events after reset", () => {
      const ws = createMockWs();

      // First turn
      bridge.relayEvent(
        ws,
        makeTerminalEvent("completed").eventData,
        makeTerminalEvent("completed").rawJson
      );
      expect(bridge.isSettled).toBe(true);

      // Reset and new turn
      bridge.reset();

      const { eventData, rawJson } = makeTerminalEvent("failed");
      bridge.relayEvent(ws, eventData, rawJson);

      expect(bridge.isSettled).toBe(true);
      expect(bridge.getSettlement()!.status).toBe("failed");
      expect(bridge.totalEvents).toBe(1);
    });
  });

  // =========================================================================
  // eventCount in settlement
  // =========================================================================

  describe("settlement eventCount", () => {
    it("includes all events in settlement eventCount", () => {
      const ws = createMockWs();

      for (let i = 0; i < 10; i++) {
        const { eventData, rawJson } = makeNonTerminalEvent(`delta_${i}`);
        bridge.relayEvent(ws, eventData, rawJson);
      }

      const { eventData, rawJson } = makeTerminalEvent("completed");
      bridge.relayEvent(ws, eventData, rawJson);

      expect(bridge.getSettlement()!.eventCount).toBe(11);
    });
  });

  // =========================================================================
  // Custom options
  // =========================================================================

  describe("custom options", () => {
    it("respects custom maxBufferSize", () => {
      const customBridge = new WsEventBridge({ maxBufferSize: 10 });
      const ws = createMockWs();

      for (let i = 0; i < 25; i++) {
        const { eventData, rawJson } = makeNonTerminalEvent(`ev_${i}`);
        customBridge.relayEvent(ws, eventData, rawJson);
      }

      expect(customBridge.getRecentEvents()).toHaveLength(10);
      expect(customBridge.totalEvents).toBe(25);
    });
  });
});
