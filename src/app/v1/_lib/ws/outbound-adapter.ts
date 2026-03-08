import WebSocket from "ws";
import { logger } from "@/lib/logger";
import { isTerminalEvent, parseServerError, parseTerminalEvent } from "@/lib/ws/frame-parser";
import type { ResponseUsage, ServerErrorFrame, TerminalEvent } from "@/lib/ws/frames";
import { toWebSocketUrl } from "../proxy/transport-classifier";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface OutboundAdapterOptions {
  /** Provider base URL (https://) - will be converted to wss:// */
  providerBaseUrl: string;
  /** Bearer token for Authorization header */
  apiKey: string;
  /** Handshake timeout in ms (default: 10_000) */
  handshakeTimeoutMs?: number;
  /** Idle timeout after last event in ms (default: 60_000, flex: 300_000) */
  idleTimeoutMs?: number;
  /** Custom headers to include in upgrade request */
  extraHeaders?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface OutboundTurnResult {
  /** Whether the turn completed with a terminal event */
  completed: boolean;
  /** Terminal event type if completed */
  terminalType?: string;
  /** Terminal event data */
  terminalEvent?: TerminalEvent;
  /** Usage from terminal event */
  usage?: ResponseUsage;
  /** Model from terminal response */
  model?: string;
  /** Service tier from terminal response */
  serviceTier?: string;
  /** Prompt cache key from terminal response */
  promptCacheKey?: string;
  /** Error if failed */
  error?: ServerErrorFrame | Error;
  /** All server events received (for relay to client) */
  events: Array<{ type: string; data: unknown }>;
  /** Handshake latency in ms */
  handshakeMs?: number;
}

// ---------------------------------------------------------------------------
// Internal resolved options (all fields required)
// ---------------------------------------------------------------------------

interface ResolvedOptions {
  providerBaseUrl: string;
  apiKey: string;
  handshakeTimeoutMs: number;
  idleTimeoutMs: number;
  extraHeaders: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Request-scoped outbound WebSocket adapter for OpenAI Responses API.
 *
 * One adapter instance per proxy request. NOT pooled or reused.
 * Opens wss:// connection, sends response.create, collects events
 * until terminal event or error.
 */
export class OutboundWsAdapter {
  private ws: WebSocket | null = null;
  private opts: ResolvedOptions;

  constructor(options: OutboundAdapterOptions) {
    this.opts = {
      providerBaseUrl: options.providerBaseUrl,
      apiKey: options.apiKey,
      handshakeTimeoutMs: options.handshakeTimeoutMs ?? 10_000,
      idleTimeoutMs: options.idleTimeoutMs ?? 60_000,
      extraHeaders: options.extraHeaders ?? {},
    };
  }

  /**
   * Execute a single response turn over WebSocket.
   *
   * 1. Connect to wss://provider/v1/responses
   * 2. Send response.create frame
   * 3. Collect events until terminal (completed/failed/incomplete) or error
   * 4. Close connection
   * 5. Return result with usage/model/events
   */
  async executeTurn(requestBody: Record<string, unknown>): Promise<OutboundTurnResult> {
    const events: Array<{ type: string; data: unknown }> = [];
    const wsUrl = toWebSocketUrl(this.opts.providerBaseUrl);

    return new Promise<OutboundTurnResult>((resolve) => {
      const handshakeStart = Date.now();
      let handshakeMs: number | undefined;
      let resolved = false;
      let idleTimer: NodeJS.Timeout | null = null;

      // ------------------------------------------------------------------
      // finish: single exit point (guards against double resolution)
      // ------------------------------------------------------------------
      const finish = (partial: Partial<OutboundTurnResult>) => {
        if (resolved) return;
        resolved = true;
        if (idleTimer) clearTimeout(idleTimer);
        if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
          this.ws.close(1000);
        }
        resolve({
          completed: false,
          events,
          handshakeMs,
          ...partial,
        });
      };

      // ------------------------------------------------------------------
      // Idle timer: reset on every incoming event
      // ------------------------------------------------------------------
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          finish({
            error: new Error(`Idle timeout: no events for ${this.opts.idleTimeoutMs}ms`),
          });
        }, this.opts.idleTimeoutMs);
      };

      // ------------------------------------------------------------------
      // Handshake timer
      // ------------------------------------------------------------------
      const handshakeTimer = setTimeout(() => {
        finish({
          error: new Error(`Handshake timeout: ${this.opts.handshakeTimeoutMs}ms`),
        });
      }, this.opts.handshakeTimeoutMs);

      // ------------------------------------------------------------------
      // Open WS connection
      // ------------------------------------------------------------------
      try {
        this.ws = new WebSocket(wsUrl, {
          headers: {
            Authorization: `Bearer ${this.opts.apiKey}`,
            ...this.opts.extraHeaders,
          },
          handshakeTimeout: this.opts.handshakeTimeoutMs,
        });

        this.ws.on("open", () => {
          clearTimeout(handshakeTimer);
          handshakeMs = Date.now() - handshakeStart;

          // Send response.create frame
          const frame = {
            type: "response.create",
            response: requestBody,
          };
          this.ws!.send(JSON.stringify(frame));

          // Start idle timer
          resetIdleTimer();
        });

        this.ws.on("message", (data: Buffer | string) => {
          resetIdleTimer();

          const raw = typeof data === "string" ? data : data.toString("utf-8");
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(raw);
          } catch {
            logger.warn("[OutboundWsAdapter] Non-JSON message received");
            return;
          }

          const eventType = parsed.type as string;
          events.push({ type: eventType, data: parsed });

          // Check for error frame
          if (eventType === "error") {
            const errorResult = parseServerError(parsed);
            finish({
              error: errorResult.ok ? errorResult.data : new Error("Unknown server error"),
            });
            return;
          }

          // Check for terminal event
          if (isTerminalEvent(eventType)) {
            const terminalResult = parseTerminalEvent(parsed);
            if (terminalResult.ok) {
              const te = terminalResult.data;
              finish({
                completed: true,
                terminalType: eventType,
                terminalEvent: te,
                usage: te.response.usage ?? undefined,
                model: te.response.model ?? undefined,
                serviceTier: te.response.service_tier ?? undefined,
                promptCacheKey: te.response.prompt_cache_key ?? undefined,
              });
            } else {
              finish({
                completed: true,
                terminalType: eventType,
                error: new Error(`Terminal event parse error: ${terminalResult.error}`),
              });
            }
            return;
          }
        });

        this.ws.on("error", (err: Error) => {
          clearTimeout(handshakeTimer);
          finish({ error: err });
        });

        this.ws.on("close", (code: number, reason: Buffer) => {
          clearTimeout(handshakeTimer);
          if (!resolved) {
            finish({
              error: new Error(`WebSocket closed unexpectedly: ${code} ${reason.toString()}`),
            });
          }
        });
      } catch (err) {
        clearTimeout(handshakeTimer);
        finish({
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    });
  }

  /** Force close the connection */
  close(): void {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.close(1000);
    }
  }
}
