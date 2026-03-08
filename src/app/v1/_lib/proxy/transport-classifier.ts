import "server-only";

import { isResponsesWebSocketEnabled } from "@/lib/config/system-settings-cache";
import type { Provider } from "@/types/provider";

import type { ProxySession } from "./session";

export type TransportType = "http" | "websocket";

export interface TransportDecision {
  transport: TransportType;
  /** Why this transport was chosen */
  reason: string;
}

/**
 * Classify whether a request should use WebSocket or HTTP transport.
 *
 * WebSocket is eligible when ALL conditions are met:
 * 1. Global enableResponsesWebSocket toggle is ON
 * 2. The request targets /v1/responses endpoint
 * 3. The provider type is "codex" (Responses API providers)
 * 4. The provider URL supports wss:// (https:// base URL)
 * 5. No proxy is configured (WS through HTTP proxy is unreliable in v1)
 *
 * If any condition fails, HTTP is used with no penalty.
 */
export async function classifyTransport(
  session: ProxySession,
  provider: Provider
): Promise<TransportDecision> {
  // 1. Global toggle
  const wsEnabled = await isResponsesWebSocketEnabled();
  if (!wsEnabled) {
    return { transport: "http", reason: "websocket_disabled" };
  }

  // 2. Endpoint check - must be /v1/responses
  const pathname = session.requestUrl.pathname;
  if (!pathname.endsWith("/responses")) {
    return { transport: "http", reason: "not_responses_endpoint" };
  }

  // 3. Provider type must be codex
  if (provider.providerType !== "codex") {
    return { transport: "http", reason: "provider_type_not_codex" };
  }

  // 4. Provider URL must be HTTPS (for wss://)
  if (!provider.url || !provider.url.startsWith("https://")) {
    return { transport: "http", reason: "provider_url_not_https" };
  }

  // 5. No proxy configured (v1 limitation)
  if (provider.proxyUrl) {
    return { transport: "http", reason: "proxy_configured" };
  }

  return { transport: "websocket", reason: "all_conditions_met" };
}

/**
 * Convert an HTTPS provider URL to WSS URL for Responses WebSocket.
 * Example: https://api.openai.com -> wss://api.openai.com/v1/responses
 */
export function toWebSocketUrl(providerBaseUrl: string): string {
  const url = new URL(providerBaseUrl);
  url.protocol = "wss:";
  // Ensure path ends with /v1/responses
  if (!url.pathname.endsWith("/v1/responses")) {
    url.pathname = url.pathname.replace(/\/$/, "") + "/v1/responses";
  }
  return url.toString();
}
