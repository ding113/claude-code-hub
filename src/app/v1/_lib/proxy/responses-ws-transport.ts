import { isResponsesWebSocketEnabled } from "@/lib/config";
import type { ProviderChainItem } from "@/types/message";
import type { Provider } from "@/types/provider";
import type { ResponsesWebSocketTransportSpecialSetting } from "@/types/special-settings";
import { sanitizeUrl } from "./errors";

export type ResponsesTransportKind = "http" | "responses_websocket";

export type ResponsesWsFallbackReason =
  | "disabled"
  | "unsupported_provider_type"
  | "unsupported_protocol"
  | "unsupported_endpoint"
  | "proxy_incompatible"
  | "transport_setup_failed"
  | "handshake_failed"
  | "handshake_timeout"
  | "first_event_timeout"
  | "upstream_request_started";

export interface ResponsesWsTransportDecision {
  requestedTransport: "responses_websocket";
  effectiveTransport: ResponsesTransportKind;
  websocketUrl: string | null;
  fallbackReason: ResponsesWsFallbackReason | null;
  specialSetting: ResponsesWebSocketTransportSpecialSetting;
}

export interface ResponsesWsFallbackClassification {
  allowHttpFallback: boolean;
  countsTowardCircuitBreaker: boolean;
  fallbackReason: ResponsesWsFallbackReason | null;
  providerChainReason: ProviderChainItem["reason"] | null;
}

export interface EvaluateResponsesWsTransportParams {
  enableResponsesWebSocket: boolean;
  provider: Pick<Provider, "id" | "name" | "providerType" | "proxyUrl">;
  upstreamUrl: string;
}

export interface ClassifyResponsesWsFallbackParams {
  failure:
    | "unsupported_endpoint"
    | "proxy_incompatible"
    | "transport_setup_failed"
    | "handshake_failed"
    | "handshake_timeout"
    | "first_event_timeout"
    | "upstream_http_4xx"
    | "upstream_http_5xx";
  upstreamRequestEstablished: boolean;
}

export function toResponsesWebSocketUrl(upstreamUrl: string): string | null {
  try {
    const url = new URL(upstreamUrl);
    if (url.protocol === "http:") {
      url.protocol = "ws:";
    } else if (url.protocol === "https:") {
      url.protocol = "wss:";
    } else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      return null;
    }

    if (!url.pathname.includes("/responses")) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

export function buildResponsesWsTransportSpecialSetting(
  params: EvaluateResponsesWsTransportParams,
  result: Pick<
    ResponsesWsTransportDecision,
    "effectiveTransport" | "websocketUrl" | "fallbackReason"
  >
): ResponsesWebSocketTransportSpecialSetting {
  return {
    type: "responses_websocket_transport",
    scope: "request",
    hit: true,
    providerId: params.provider.id,
    providerName: params.provider.name,
    requestedTransport: "responses_websocket",
    effectiveTransport: result.effectiveTransport,
    attempted: result.effectiveTransport === "responses_websocket",
    websocketUrl: result.websocketUrl ? sanitizeUrl(result.websocketUrl) : null,
    fallbackReason: result.fallbackReason,
  };
}

export function evaluateResponsesWsTransport(
  params: EvaluateResponsesWsTransportParams
): ResponsesWsTransportDecision {
  const baseDecision = {
    requestedTransport: "responses_websocket" as const,
    effectiveTransport: "http" as const,
    websocketUrl: null,
    fallbackReason: null as ResponsesWsFallbackReason | null,
  };

  if (!params.enableResponsesWebSocket) {
    const result = { ...baseDecision, fallbackReason: "disabled" as const };
    return {
      ...result,
      specialSetting: buildResponsesWsTransportSpecialSetting(params, result),
    };
  }

  if (params.provider.providerType !== "codex") {
    const result = { ...baseDecision, fallbackReason: "unsupported_provider_type" as const };
    return {
      ...result,
      specialSetting: buildResponsesWsTransportSpecialSetting(params, result),
    };
  }

  if (params.provider.proxyUrl) {
    const result = { ...baseDecision, fallbackReason: "proxy_incompatible" as const };
    return {
      ...result,
      specialSetting: buildResponsesWsTransportSpecialSetting(params, result),
    };
  }

  const websocketUrl = toResponsesWebSocketUrl(params.upstreamUrl);
  if (!websocketUrl) {
    const fallbackReason =
      params.upstreamUrl.startsWith("http://") || params.upstreamUrl.startsWith("https://")
        ? ("unsupported_endpoint" as const)
        : ("unsupported_protocol" as const);
    const result = { ...baseDecision, fallbackReason };
    return {
      ...result,
      specialSetting: buildResponsesWsTransportSpecialSetting(params, result),
    };
  }

  const result = {
    requestedTransport: "responses_websocket" as const,
    effectiveTransport: "responses_websocket" as const,
    websocketUrl,
    fallbackReason: null,
  };
  return {
    ...result,
    specialSetting: buildResponsesWsTransportSpecialSetting(params, result),
  };
}

export async function selectResponsesWsTransport(
  params: Omit<EvaluateResponsesWsTransportParams, "enableResponsesWebSocket">
): Promise<ResponsesWsTransportDecision> {
  const enableResponsesWebSocket = await isResponsesWebSocketEnabled();
  return evaluateResponsesWsTransport({
    ...params,
    enableResponsesWebSocket,
  });
}

export function classifyResponsesWsFallback(
  params: ClassifyResponsesWsFallbackParams
): ResponsesWsFallbackClassification {
  if (params.upstreamRequestEstablished) {
    return {
      allowHttpFallback: false,
      countsTowardCircuitBreaker: false,
      fallbackReason: "upstream_request_started",
      providerChainReason: null,
    };
  }

  if (params.failure === "upstream_http_4xx" || params.failure === "upstream_http_5xx") {
    return {
      allowHttpFallback: false,
      countsTowardCircuitBreaker: false,
      fallbackReason: null,
      providerChainReason: null,
    };
  }

  const fallbackReason = params.failure;
  return {
    allowHttpFallback: true,
    countsTowardCircuitBreaker: false,
    fallbackReason,
    providerChainReason: "responses_websocket_fallback",
  };
}
