/**
 * WebSocket Provider Probe
 *
 * Tests whether a provider supports Responses WebSocket transport
 * by attempting a minimal response.create turn via OutboundWsAdapter.
 *
 * Design:
 * - Wraps OutboundWsAdapter with probe-appropriate timeouts
 * - Builds request payload from cx_base preset (or custom preset)
 * - Interprets the turn result into a WsProbeResult
 * - Handshake failures are reported as "unsupported", not errors
 * - Self-contained: does not modify existing HTTP test paths
 */

import {
  type OutboundAdapterOptions,
  type OutboundTurnResult,
  OutboundWsAdapter,
} from "@/app/v1/_lib/ws/outbound-adapter";
import { getPreset, getPresetPayload } from "./presets";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default handshake timeout for probe (ms) */
const PROBE_HANDSHAKE_TIMEOUT_MS = 10_000;

/** Default idle timeout for probe (ms) - shorter than production */
const PROBE_IDLE_TIMEOUT_MS = 30_000;

/** Default preset for WS probe */
const DEFAULT_PROBE_PRESET = "cx_base";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for a WebSocket probe request
 */
export interface WsProbeConfig {
  /** Provider base URL (https://) - will be converted to wss:// internally */
  providerUrl: string;
  /** API key for Bearer token authentication */
  apiKey: string;
  /** Model to test (defaults to preset default model) */
  model?: string;
  /** Overall timeout in ms (controls handshake + idle timeouts) */
  timeoutMs?: number;
  /** Preset ID for request payload (default: "cx_base") */
  preset?: string;
}

/**
 * Result of a WebSocket probe against a provider.
 *
 * Extends the existing test result concept with WS-specific fields.
 * Designed to be merged into ProviderTestResult by the caller.
 */
export interface WsProbeResult {
  /** Whether the provider supports WebSocket transport */
  wsSupported: boolean;
  /** Transport classification: what was actually used / detected */
  wsTransport: "websocket" | "http_fallback" | "unsupported";
  /** WebSocket handshake latency in ms (set only if handshake succeeded) */
  wsHandshakeMs?: number;
  /** Number of server events received during the turn */
  wsEventCount?: number;
  /** Why WS was not usable (set when wsSupported is false or turn failed) */
  wsFallbackReason?: string;
  /** Model string from the terminal event response */
  wsTerminalModel?: string;
  /** Usage object from the terminal event response */
  wsTerminalUsage?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Probe a provider's WebSocket support by attempting a minimal response.create turn.
 *
 * Flow:
 * 1. Build a test payload from the preset (defaults to cx_base)
 * 2. Create an OutboundWsAdapter with probe-appropriate timeouts
 * 3. Execute a single turn via WebSocket
 * 4. Interpret the result:
 *    - handshakeMs present + completed  -> wsSupported=true, wsTransport="websocket"
 *    - handshakeMs present + not completed -> wsSupported=true (WS works, but turn errored)
 *    - handshakeMs absent -> wsSupported=false, wsTransport="unsupported"
 *
 * If the adapter throws (unexpected crash), the probe catches it
 * and reports unsupported with the error message.
 */
export async function probeProviderWebSocket(config: WsProbeConfig): Promise<WsProbeResult> {
  // Resolve preset and model
  const presetId = config.preset ?? DEFAULT_PROBE_PRESET;
  const presetConfig = getPreset(presetId);
  const model = config.model ?? presetConfig?.defaultModel;

  // Build request payload
  let payload: Record<string, unknown>;
  if (presetConfig) {
    payload = getPresetPayload(presetId, model);
  } else {
    // Fallback: minimal payload if preset not found
    payload = { model: model ?? "gpt-4o", input: [] };
  }

  // Calculate timeouts from config
  const handshakeTimeoutMs = config.timeoutMs
    ? Math.min(config.timeoutMs, PROBE_HANDSHAKE_TIMEOUT_MS)
    : PROBE_HANDSHAKE_TIMEOUT_MS;
  const idleTimeoutMs = config.timeoutMs ?? PROBE_IDLE_TIMEOUT_MS;

  // Create adapter
  const adapterOptions: OutboundAdapterOptions = {
    providerBaseUrl: config.providerUrl,
    apiKey: config.apiKey,
    handshakeTimeoutMs,
    idleTimeoutMs,
  };

  const adapter = new OutboundWsAdapter(adapterOptions);

  try {
    const turnResult = await adapter.executeTurn(payload);
    return interpretTurnResult(turnResult);
  } catch (error) {
    // Unexpected error (adapter.executeTurn is designed to always resolve,
    // but we guard against edge cases)
    adapter.close();
    return {
      wsSupported: false,
      wsTransport: "unsupported",
      wsFallbackReason: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Interpret an OutboundTurnResult into a WsProbeResult.
 *
 * Classification logic:
 * - handshakeMs present = handshake succeeded = provider supports WS
 * - completed = terminal event received = full success
 * - error after handshake = WS works but turn had issues (still wsSupported=true)
 * - no handshakeMs = handshake failed = provider does not support WS
 */
function interpretTurnResult(result: OutboundTurnResult): WsProbeResult {
  const handshakeSucceeded = result.handshakeMs !== undefined;

  if (handshakeSucceeded && result.completed) {
    // Best case: WS handshake + turn completed successfully
    return {
      wsSupported: true,
      wsTransport: "websocket",
      wsHandshakeMs: result.handshakeMs,
      wsEventCount: result.events.length,
      wsTerminalModel: result.model,
      wsTerminalUsage: result.usage as Record<string, unknown> | undefined,
    };
  }

  if (handshakeSucceeded && !result.completed) {
    // Handshake succeeded but turn failed (server error frame, idle timeout, etc.)
    // Provider supports WS, but something went wrong during the turn
    return {
      wsSupported: true,
      wsTransport: "websocket",
      wsHandshakeMs: result.handshakeMs,
      wsEventCount: result.events.length,
      wsFallbackReason: formatError(result.error),
    };
  }

  // Handshake never completed - provider does not support WS
  return {
    wsSupported: false,
    wsTransport: "unsupported",
    wsFallbackReason: formatError(result.error),
  };
}

/**
 * Format an error from OutboundTurnResult into a human-readable string.
 */
function formatError(error: OutboundTurnResult["error"]): string {
  if (!error) return "Unknown error";
  if (error instanceof Error) return error.message;
  // ServerErrorFrame shape: { error: { type, message, ... } }
  if ("error" in error && typeof error.error === "object" && error.error !== null) {
    const serverErr = error.error as { message?: string; type?: string };
    return serverErr.message ?? serverErr.type ?? JSON.stringify(error);
  }
  return JSON.stringify(error);
}
