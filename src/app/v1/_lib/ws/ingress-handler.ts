import type { IncomingMessage } from "node:http";
import type WebSocket from "ws";

import { isResponsesWebSocketEnabled } from "@/lib/config/system-settings-cache";
import { logger } from "@/lib/logger";
import { parseClientFrame } from "@/lib/ws/frame-parser";
import type { ResponseCreateFrame } from "@/lib/ws/frames";
import { validateApiKeyAndGetUser } from "@/repository/key";
import { updateMessageRequestCost, updateMessageRequestDetails } from "@/repository/message";
import type { Key } from "@/types/key";
import type { Provider } from "@/types/provider";
import type { User } from "@/types/user";

import { extractApiKeyFromHeaders } from "../proxy/auth-guard";
import { GuardPipelineBuilder } from "../proxy/guard-pipeline";
import { ProxySession } from "../proxy/session";
import { classifyTransport } from "../proxy/transport-classifier";
import { buildWsTraceMetadata, settleWsTurnBilling } from "./billing-parity";
import { type SettlementResult, WsEventBridge } from "./event-bridge";
import { OutboundWsAdapter } from "./outbound-adapter";
import { createWsTurnContext, updateSessionFromTerminal } from "./session-continuity";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Connection lifecycle state */
export type ConnectionState = "waiting" | "processing" | "closed";

/** Authenticated identity from upgrade-time validation */
export interface WsAuthContext {
  user: User;
  key: Key;
  apiKey: string;
}

/** Per-turn metadata extracted from response.create */
export interface TurnMeta {
  model: string;
  serviceTier: string | undefined;
  previousResponseId: string | undefined;
  frame: ResponseCreateFrame;
}

export interface IngressHandlerOptions {
  /** Max non-create frames to buffer before closing (default: 5) */
  maxBufferedFrames?: number;
  /** Max time to wait for first response.create in ms (default: 30000) */
  firstFrameTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// WsIngressHandler
// ---------------------------------------------------------------------------

/**
 * Handle a single WebSocket connection on /v1/responses.
 *
 * Lifecycle:
 * 1. Connection accepted, auth validated (upgrade-time)
 * 2. Wait for first response.create frame (state: waiting)
 * 3. Extract model/service_tier/previous_response_id (delayed bridging)
 * 4. Bridge to upstream via outbound adapter (state: processing)
 * 5. Relay events to client until terminal event
 * 6. Return to waiting state for sequential turns
 *
 * Invariants:
 * - Only ONE in-flight response at a time per socket
 * - Auth runs at upgrade time, provider selection deferred to first frame
 * - Guard pipeline runs AFTER first frame (delayed bridging)
 */
export class WsIngressHandler {
  private state: ConnectionState = "waiting";
  private options: Required<IngressHandlerOptions>;
  private turnCount = 0;
  private currentMeta: TurnMeta | null = null;
  private auth: WsAuthContext | null = null;
  private ip: string;
  private activeAdapter: OutboundWsAdapter | null = null;

  constructor(
    private ws: WebSocket,
    private req: IncomingMessage,
    options?: IngressHandlerOptions
  ) {
    this.options = {
      maxBufferedFrames: options?.maxBufferedFrames ?? 5,
      firstFrameTimeoutMs: options?.firstFrameTimeoutMs ?? 30000,
    };
    this.ip = extractClientIp(req);
  }

  /**
   * Initialize the handler: check toggle, authenticate, set up listeners.
   * Returns true if the connection is ready to accept frames.
   * Returns false if the connection was rejected (socket closed).
   */
  async start(): Promise<boolean> {
    // 1. Check global toggle
    const wsEnabled = await isResponsesWebSocketEnabled();
    if (!wsEnabled) {
      logger.debug("[WsIngress] Responses WebSocket disabled by system toggle");
      this.ws.close(4003, "Responses WebSocket is disabled");
      this.state = "closed";
      return false;
    }

    // 2. Authenticate using request headers
    const apiKey = extractApiKeyFromHeaders({
      authorization: this.req.headers.authorization ?? null,
      "x-api-key": (this.req.headers["x-api-key"] as string) ?? null,
      "x-goog-api-key": (this.req.headers["x-goog-api-key"] as string) ?? null,
    });

    if (!apiKey) {
      logger.debug("[WsIngress] No auth credentials in upgrade request");
      this.ws.close(4001, "No auth credentials provided");
      this.state = "closed";
      return false;
    }

    const authResult = await validateApiKeyAndGetUser(apiKey);
    if (!authResult) {
      logger.debug("[WsIngress] API key validation failed");
      this.ws.close(4001, "API key invalid or expired");
      this.state = "closed";
      return false;
    }

    // Check user enabled
    if (!authResult.user.isEnabled) {
      logger.debug("[WsIngress] User disabled", { userId: authResult.user.id });
      this.ws.close(4001, "User account disabled");
      this.state = "closed";
      return false;
    }

    this.auth = {
      user: authResult.user,
      key: authResult.key,
      apiKey,
    };

    logger.debug("[WsIngress] Authenticated", {
      userId: authResult.user.id,
      userName: authResult.user.name,
      clientIp: this.ip,
    });

    // 3. Set up message/close/error listeners
    this.setupListeners();
    return true;
  }

  private setupListeners(): void {
    let firstFrameTimer: ReturnType<typeof setTimeout> | null = null;
    let bufferedNonCreateCount = 0;

    // First-frame timeout
    firstFrameTimer = setTimeout(() => {
      if (this.state === "waiting") {
        this.sendError("timeout", "No response.create received within timeout");
        this.ws.close(1000);
        this.state = "closed";
      }
    }, this.options.firstFrameTimeoutMs);

    // Message handler is intentionally NOT async.
    // handleTurn is dispatched via .catch()/.finally() so that
    // state transitions for concurrent rejection are synchronous.
    this.ws.on("message", (data: Buffer | string) => {
      if (this.state === "closed") return;

      const raw = typeof data === "string" ? data : data.toString("utf-8");
      const parseResult = parseClientFrame(raw);

      if (!parseResult.ok) {
        this.sendError("invalid_request_error", parseResult.error);
        return;
      }

      const frame = parseResult.data;

      if (frame.type === "response.create") {
        // Clear first-frame timer
        if (firstFrameTimer) {
          clearTimeout(firstFrameTimer);
          firstFrameTimer = null;
        }

        if (this.state === "processing") {
          this.sendError(
            "conflict",
            "A response is already in progress. Wait for the current response to complete before sending another request."
          );
          return;
        }

        this.state = "processing";
        this.turnCount++;

        this.currentMeta = {
          model: frame.response.model,
          serviceTier: frame.response.service_tier,
          previousResponseId: frame.response.previous_response_id,
          frame,
        };

        logger.debug("[WsIngress] Processing turn", {
          turn: this.turnCount,
          model: this.currentMeta.model,
          previousResponseId: this.currentMeta.previousResponseId ? "[set]" : undefined,
          serviceTier: this.currentMeta.serviceTier,
        });

        // Dispatch async handleTurn - state is managed by finally
        this.handleTurn(frame)
          .catch((err) => {
            logger.error("[WsIngress] Turn failed", { error: err, turn: this.turnCount });
            this.sendError(
              "server_error",
              err instanceof Error ? err.message : "Internal server error"
            );
          })
          .finally(() => {
            if (this.state !== "closed") {
              this.state = "waiting";
              this.currentMeta = null;
            }
          });
        return;
      }

      if (frame.type === "response.cancel") {
        if (this.state === "processing") {
          logger.debug("[WsIngress] Cancel received for active turn", { turn: this.turnCount });
          if (this.activeAdapter) {
            this.activeAdapter.close();
            this.activeAdapter = null;
          }
          this.state = "waiting";
          this.currentMeta = null;
        } else {
          logger.debug("[WsIngress] Cancel received while idle (ignored)");
        }
        return;
      }

      // Unknown valid frame type while waiting - count toward buffer limit
      bufferedNonCreateCount++;
      if (bufferedNonCreateCount > this.options.maxBufferedFrames) {
        this.sendError("invalid_request_error", "Too many frames before response.create");
        this.ws.close(1000);
        this.state = "closed";
      }
    });

    this.ws.on("close", () => {
      if (firstFrameTimer) clearTimeout(firstFrameTimer);
      this.state = "closed";
      this.currentMeta = null;
      logger.debug("[WsIngress] Connection closed", { turns: this.turnCount });
    });

    this.ws.on("error", (err: Error) => {
      if (firstFrameTimer) clearTimeout(firstFrameTimer);
      this.state = "closed";
      this.currentMeta = null;
      logger.error("[WsIngress] Connection error", { error: err.message });
    });
  }

  /**
   * Handle a single response turn (delayed bridging).
   *
   * State management: the caller (.finally()) sets state back to "waiting".
   * handleTurn does NOT manage connection state.
   *
   * Pipeline:
   *  1. Create synthetic ProxySession from WS upgrade request + auth
   *  2. Run deferred guard pipeline (model, provider, messageContext)
   *  3. Classify transport (must be WS-eligible)
   *  4. Execute turn via OutboundWsAdapter
   *  5. Relay events to client via WsEventBridge
   *  6. Settle billing + session continuity
   */
  async handleTurn(frame: ResponseCreateFrame): Promise<void> {
    if (!this.auth) {
      throw new Error("Not authenticated");
    }

    // Capture meta early -- cancel can clear this.currentMeta mid-turn
    const turnMeta = this.currentMeta!;

    // 1. Create synthetic ProxySession
    const session = ProxySession.fromWebSocket({
      req: this.req,
      auth: this.auth,
      model: frame.response.model,
      requestBody: frame.response as Record<string, unknown>,
    });

    // 2. Run deferred guard pipeline (model validation, provider selection, billing record)
    const pipeline = GuardPipelineBuilder.build({
      steps: ["model", "provider", "messageContext"],
    });
    const guardResponse = await pipeline.run(session);
    if (guardResponse) {
      let errorType = "guard_error";
      let errorMessage = `Request rejected (${guardResponse.status})`;
      try {
        const body = await guardResponse.text();
        const parsed = JSON.parse(body) as {
          error?: { type?: string; message?: string };
        };
        if (parsed.error?.type) errorType = parsed.error.type;
        if (parsed.error?.message) errorMessage = parsed.error.message;
      } catch {
        // Use defaults
      }
      this.sendError(errorType, errorMessage);
      return;
    }

    // 3. Verify provider selected
    const provider = session.provider;
    if (!provider) {
      this.sendError("server_error", "No provider available for the requested model");
      return;
    }

    // 4. Classify transport
    const decision = await classifyTransport(session, provider);
    if (decision.transport !== "websocket") {
      this.sendError(
        "invalid_request_error",
        `WebSocket transport not available for this provider (${decision.reason}); use the HTTP endpoint instead`
      );
      return;
    }

    // 5. Execute turn via outbound adapter
    const adapter = new OutboundWsAdapter({
      providerBaseUrl: provider.url,
      apiKey: provider.key,
    });
    this.activeAdapter = adapter;

    try {
      const turnResult = await adapter.executeTurn(frame.response as Record<string, unknown>);

      // 6. Relay all events to client via event bridge
      const bridge = new WsEventBridge();
      for (const event of turnResult.events) {
        bridge.relayEvent(
          this.ws,
          event as { type: string; data: unknown },
          JSON.stringify(event.data)
        );
      }

      // Settle error if bridge didn't receive a terminal event
      if (!bridge.isSettled) {
        if (turnResult.error) {
          const msg =
            turnResult.error instanceof Error ? turnResult.error.message : "Upstream error";
          bridge.settleError(msg);
          // Network errors weren't in the event stream; notify client
          if (turnResult.error instanceof Error) {
            this.sendError("server_error", msg);
          }
        } else {
          bridge.settleError("Turn ended without terminal event");
        }
      }

      // 7. Billing settlement
      const settlement = bridge.getSettlement();
      if (settlement && session.messageContext) {
        await this.settleBilling(session, settlement, provider, turnMeta, turnResult.handshakeMs);
      }
    } finally {
      this.activeAdapter = null;
    }
  }

  /**
   * Settle billing, persist cost/details, update session binding.
   * Best-effort: errors are logged but do not fail the turn.
   */
  private async settleBilling(
    session: ProxySession,
    settlement: SettlementResult,
    provider: Provider,
    turnMeta: TurnMeta,
    handshakeMs?: number
  ): Promise<void> {
    try {
      const turnContext = createWsTurnContext(this.auth!, turnMeta);

      const priceData = await session.getCachedPriceDataByBillingSource(provider);
      const billingResult = settleWsTurnBilling({
        usage: settlement.usage,
        serviceTier: settlement.serviceTier,
        requestedServiceTier: turnMeta.serviceTier,
        priceData: priceData ?? undefined,
        costMultiplier: provider.costMultiplier ?? 1.0,
      });

      await updateMessageRequestCost(session.messageContext!.id, billingResult.costUsd);

      const statusCode =
        settlement.status === "completed" || settlement.status === "incomplete" ? 200 : 500;

      await updateMessageRequestDetails(session.messageContext!.id, {
        statusCode,
        inputTokens: billingResult.inputTokens,
        outputTokens: billingResult.outputTokens,
        cacheCreationInputTokens: billingResult.cacheCreationInputTokens,
        cacheReadInputTokens: billingResult.cacheReadInputTokens,
        model: settlement.model ?? turnMeta.model,
        providerId: provider.id,
        providerChain: session.getProviderChain(),
      });

      await updateSessionFromTerminal(turnContext, settlement, session.sessionId, provider.id);

      // Best-effort trace metadata (non-blocking)
      try {
        buildWsTraceMetadata({
          handshakeMs,
          eventCount: settlement.eventCount,
          terminalType: settlement.terminalType,
          model: settlement.model,
          serviceTier: settlement.serviceTier,
          durationMs: settlement.durationMs,
          statusCode,
          errorMessage: settlement.errorMessage,
        });
      } catch {
        // Best-effort, swallow errors
      }
    } catch (error) {
      logger.error("[WsIngress] Billing settlement failed", {
        error,
        turn: this.turnCount,
      });
    }
  }

  /** Send an error frame to the client */
  private sendError(type: string, message: string): void {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "error",
          error: { type, message },
        })
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Public accessors (for T7/T8/T9 integration and testing)
  // ---------------------------------------------------------------------------

  /** Current connection state */
  get connectionState(): ConnectionState {
    return this.state;
  }

  /** Number of completed turns */
  get completedTurns(): number {
    return this.turnCount;
  }

  /** Current turn metadata (null when idle) */
  get currentTurnMeta(): TurnMeta | null {
    return this.currentMeta;
  }

  /** Authenticated identity (null before start()) */
  get authContext(): WsAuthContext | null {
    return this.auth;
  }

  /** Client IP address */
  get clientIp(): string {
    return this.ip;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractClientIp(req: IncomingMessage): string {
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) return realIp.trim();

  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const ips = forwarded
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ips.length > 0) return ips[ips.length - 1];
  }

  return req.socket?.remoteAddress ?? "unknown";
}

// ---------------------------------------------------------------------------
// Factory: register with WsManager
// ---------------------------------------------------------------------------

/**
 * Register the ingress handler with WsManager.
 * Call during server startup to replace the placeholder handler.
 */
export function registerIngressHandler(
  wsManager: import("@/server/ws-manager").WsManager,
  options?: IngressHandlerOptions
): void {
  wsManager.onConnection(async (ws, req) => {
    const handler = new WsIngressHandler(ws, req, options);
    const ok = await handler.start();
    if (!ok) {
      logger.debug("[WsIngress] Connection rejected during init");
    }
  });
}
