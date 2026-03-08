import type WebSocket from "ws";
import { logger } from "@/lib/logger";
import { isTerminalEvent, parseTerminalEvent } from "@/lib/ws/frame-parser";
import type { ResponseUsage } from "@/lib/ws/frames";

/** Maximum events retained in ring buffer for debugging */
const MAX_RING_BUFFER_SIZE = 100;

export interface EventBridgeOptions {
  /** Max events in ring buffer (default: 100) */
  maxBufferSize?: number;
}

export type SettlementStatus = "completed" | "failed" | "incomplete" | "error" | "disconnected";

export interface SettlementResult {
  status: SettlementStatus;
  /** Usage from terminal event (only present on completed/failed/incomplete) */
  usage?: ResponseUsage;
  /** Model from terminal response */
  model?: string;
  /** Service tier from terminal response */
  serviceTier?: string;
  /** Prompt cache key from terminal response */
  promptCacheKey?: string;
  /** Total events relayed */
  eventCount: number;
  /** Duration from first event to terminal in ms */
  durationMs: number;
  /** Error message if status is error/disconnected */
  errorMessage?: string;
  /** Terminal event type */
  terminalType?: string;
}

/**
 * Bidirectional event bridge between upstream WS and client WS.
 *
 * Uses a bounded ring buffer - only retains the last N events for
 * debugging/logging. Does NOT accumulate all events in memory.
 *
 * Usage is extracted ONLY from terminal events (response.completed,
 * response.failed, response.incomplete), never from intermediate deltas.
 */
export class WsEventBridge {
  private ringBuffer: Array<{ type: string; timestamp: number }>;
  private bufferIndex = 0;
  private eventCount = 0;
  private startTime: number | null = null;
  private settlement: SettlementResult | null = null;
  private maxBufferSize: number;

  constructor(options?: EventBridgeOptions) {
    this.maxBufferSize = options?.maxBufferSize ?? MAX_RING_BUFFER_SIZE;
    this.ringBuffer = new Array(this.maxBufferSize);
  }

  /**
   * Relay an upstream server event to the client WebSocket.
   *
   * - Writes to ring buffer (bounded, overwrites oldest)
   * - Forwards raw JSON to client
   * - Checks for terminal events and extracts settlement data
   *
   * Returns true if the event was terminal (bridge should stop after).
   */
  relayEvent(
    clientWs: WebSocket,
    eventData: { type: string; data: unknown },
    rawJson: string
  ): boolean {
    if (this.startTime === null) {
      this.startTime = Date.now();
    }

    this.eventCount++;

    // Write to ring buffer (bounded)
    this.ringBuffer[this.bufferIndex % this.maxBufferSize] = {
      type: eventData.type,
      timestamp: Date.now(),
    };
    this.bufferIndex++;

    // Forward to client if socket is open
    if (clientWs.readyState === clientWs.OPEN) {
      clientWs.send(rawJson);
    }

    // Check for terminal event
    if (isTerminalEvent(eventData.type)) {
      const terminalResult = parseTerminalEvent(eventData.data);
      const durationMs = Date.now() - (this.startTime ?? Date.now());

      if (terminalResult.ok) {
        const te = terminalResult.data;
        this.settlement = {
          status: te.response.status as SettlementStatus,
          usage: te.response.usage ?? undefined,
          model: te.response.model ?? undefined,
          serviceTier: te.response.service_tier ?? undefined,
          promptCacheKey: te.response.prompt_cache_key ?? undefined,
          eventCount: this.eventCount,
          durationMs,
          terminalType: eventData.type,
        };
      } else {
        this.settlement = {
          status: "error",
          eventCount: this.eventCount,
          durationMs,
          errorMessage: `Terminal event parse error: ${terminalResult.error}`,
          terminalType: eventData.type,
        };
      }

      logger.debug("[EventBridge] Terminal event", {
        type: eventData.type,
        eventCount: this.eventCount,
        durationMs,
        status: this.settlement.status,
      });

      return true;
    }

    return false;
  }

  /**
   * Record a disconnection or error settlement (no terminal event received).
   */
  settleError(errorMessage: string, status: "error" | "disconnected" = "error"): void {
    if (this.settlement) return;
    this.settlement = {
      status,
      eventCount: this.eventCount,
      durationMs: this.startTime ? Date.now() - this.startTime : 0,
      errorMessage,
    };
  }

  /**
   * Get the settlement result. Only available after terminal event or error.
   */
  getSettlement(): SettlementResult | null {
    return this.settlement;
  }

  /** Whether this bridge has settled (terminal event received or error) */
  get isSettled(): boolean {
    return this.settlement !== null;
  }

  /** Total events processed */
  get totalEvents(): number {
    return this.eventCount;
  }

  /**
   * Get recent events from ring buffer (for debugging/logging).
   * Returns events in chronological order.
   */
  getRecentEvents(): Array<{ type: string; timestamp: number }> {
    const filled = Math.min(this.bufferIndex, this.maxBufferSize);
    const result: Array<{ type: string; timestamp: number }> = [];
    const startIdx =
      this.bufferIndex > this.maxBufferSize ? this.bufferIndex % this.maxBufferSize : 0;
    for (let i = 0; i < filled; i++) {
      const idx = (startIdx + i) % this.maxBufferSize;
      if (this.ringBuffer[idx]) {
        result.push(this.ringBuffer[idx]);
      }
    }
    return result;
  }

  /** Reset for a new turn (sequential turn reuse) */
  reset(): void {
    this.ringBuffer = new Array(this.maxBufferSize);
    this.bufferIndex = 0;
    this.eventCount = 0;
    this.startTime = null;
    this.settlement = null;
  }
}
