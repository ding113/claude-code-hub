import { logger } from "@/lib/logger";
import { SessionManager } from "@/lib/session-manager";

import type { SettlementResult } from "./event-bridge";
import type { TurnMeta, WsAuthContext } from "./ingress-handler";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Phase of a WS turn lifecycle */
export type TurnPhase = "setup" | "streaming" | "settled";

/** Classification of a disconnect event */
export type DisconnectClassification = "retryable" | "terminal";

/**
 * Per-turn context for WS session tracking.
 *
 * Created when a response.create frame starts a new turn, updated
 * when the terminal event arrives with prompt_cache_key.
 */
export interface WsTurnContext {
  /** Model requested for this turn */
  model: string;
  /** Previous response ID from client request */
  previousResponseId: string | undefined;
  /** Prompt cache key (populated from terminal event) */
  promptCacheKey: string | undefined;
  /** Transport type (always "websocket" for WS turns) */
  transport: "websocket";
  /** Turn start timestamp */
  startedAt: number;
  /** Key ID from auth context */
  keyId: number;
  /** User ID from auth context */
  userId: number;
}

// ---------------------------------------------------------------------------
// Upstream error codes that are explicit protocol errors.
// These are NEVER silently retried -- surfaced directly to the client.
// ---------------------------------------------------------------------------

const EXPLICIT_PROTOCOL_ERRORS = new Set([
  "previous_response_not_found",
  "websocket_connection_limit_reached",
]);

// ---------------------------------------------------------------------------
// Transport / setup error patterns that qualify for neutral fallback.
// These indicate WS transport issues, NOT API-level errors.
// ---------------------------------------------------------------------------

const TRANSPORT_ERROR_PATTERNS = [
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ECONNABORTED",
  "handshake",
  "upgrade",
  "WebSocket",
  "websocket",
  "socket hang up",
] as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a turn-scoped context from auth and turn metadata.
 *
 * Called by the ingress handler when a response.create frame arrives
 * and a new turn begins.
 */
export function createWsTurnContext(auth: WsAuthContext, turnMeta: TurnMeta): WsTurnContext {
  return {
    model: turnMeta.model,
    previousResponseId: turnMeta.previousResponseId,
    promptCacheKey: undefined,
    transport: "websocket",
    startedAt: Date.now(),
    keyId: auth.key.id,
    userId: auth.user.id,
  };
}

/**
 * Update session binding from a terminal event settlement.
 *
 * Extracts prompt_cache_key from the settlement and delegates to
 * SessionManager.updateSessionWithCodexCacheKey() to create/refresh
 * the session binding in Redis.
 *
 * @param turnContext  - Mutable; promptCacheKey is written in-place.
 * @param settlement   - Terminal event settlement from event bridge.
 * @param sessionId    - Current proxy session ID (null if not yet determined).
 * @param providerId   - Provider ID used for this turn (null if not yet selected).
 */
export async function updateSessionFromTerminal(
  turnContext: WsTurnContext,
  settlement: SettlementResult,
  sessionId: string | null,
  providerId: number | null
): Promise<{ turnContext: WsTurnContext; sessionUpdated: boolean }> {
  const promptCacheKey = settlement.promptCacheKey;

  if (!promptCacheKey) {
    logger.debug("[SessionContinuity] No prompt_cache_key in settlement", {
      status: settlement.status,
      model: settlement.model,
    });
    return { turnContext, sessionUpdated: false };
  }

  // Always populate turn context regardless of session binding outcome
  turnContext.promptCacheKey = promptCacheKey;

  // Delegate to existing SessionManager for Redis binding
  if (sessionId && providerId != null) {
    try {
      const result = await SessionManager.updateSessionWithCodexCacheKey(
        sessionId,
        promptCacheKey,
        providerId
      );

      logger.debug("[SessionContinuity] Session binding updated from terminal", {
        promptCacheKey,
        sessionId: result.sessionId,
        updated: result.updated,
        providerId,
      });

      return { turnContext, sessionUpdated: result.updated };
    } catch (error) {
      logger.error("[SessionContinuity] Failed to update session from terminal", {
        error,
        promptCacheKey,
        sessionId,
        providerId,
      });
      return { turnContext, sessionUpdated: false };
    }
  }

  return { turnContext, sessionUpdated: false };
}

/**
 * Classify a disconnect based on the turn phase and optional error code.
 *
 * Boundary rules:
 * - "setup" phase (before upstream event stream starts):
 *   retryable -- MAY fall back to HTTP (neutral fallback).
 * - "streaming" phase (after upstream started sending events):
 *   terminal -- MUST fail with explicit error, no hidden HTTP replay.
 * - "settled" phase (terminal event already received):
 *   terminal -- turn already completed, nothing to retry.
 * - Explicit protocol errors (previous_response_not_found,
 *   websocket_connection_limit_reached): always terminal regardless
 *   of phase.
 */
export function classifyDisconnect(
  turnPhase: TurnPhase,
  errorCode?: string
): DisconnectClassification {
  // Explicit protocol errors are always terminal
  if (errorCode && EXPLICIT_PROTOCOL_ERRORS.has(errorCode)) {
    return "terminal";
  }

  // Pre-stream: transport failures can retry via HTTP
  if (turnPhase === "setup") {
    return "retryable";
  }

  // Mid-stream or settled: no hidden HTTP replay
  return "terminal";
}

/**
 * Check whether an error qualifies for neutral transport fallback.
 *
 * "Neutral" means the error is a transport/setup issue, not an API error.
 * Neutral fallback errors:
 * - Do NOT count against the circuit breaker
 * - MAY be retried transparently via HTTP
 * - Match the existing `ws_fallback` reason in the provider chain taxonomy
 *
 * Non-neutral errors (API errors, explicit protocol errors) are surfaced
 * directly to the client as protocol-level errors.
 */
export function isNeutralFallback(
  error: Error | { type?: string; code?: string; message?: string }
): boolean {
  const errorRecord = error as Record<string, unknown>;
  const code = typeof errorRecord.code === "string" ? errorRecord.code : undefined;
  const type = typeof errorRecord.type === "string" ? errorRecord.type : undefined;
  const message = error.message ?? "";

  // Explicit protocol errors are never neutral (check code, type, AND message)
  if (code && EXPLICIT_PROTOCOL_ERRORS.has(code)) {
    return false;
  }
  if (type && EXPLICIT_PROTOCOL_ERRORS.has(type)) {
    return false;
  }
  for (const explicitError of EXPLICIT_PROTOCOL_ERRORS) {
    if (message.includes(explicitError)) {
      return false;
    }
  }

  // Check message against transport/setup error patterns
  return TRANSPORT_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}
