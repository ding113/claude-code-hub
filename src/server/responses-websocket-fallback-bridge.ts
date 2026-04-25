import { isSSEText, parseSSEData } from "@/lib/utils/sse";
import type { ResponsesWebSocketJsonEvent } from "./responses-websocket-protocol";
import type { ResponsesWebSocketUpstreamAdapterResult } from "./responses-websocket-upstream-adapter";

export type ResponsesWebSocketHttpFallback = () => Response | Promise<Response>;

export type ResponsesWebSocketFallbackBridgeOptions = {
  requestId: string;
};

export type StreamResponsesWebSocketEventsWithHttpFallbackOptions =
  ResponsesWebSocketFallbackBridgeOptions & {
    upstream: ResponsesWebSocketUpstreamAdapterResult;
    httpFallback: ResponsesWebSocketHttpFallback;
  };

export async function* streamResponsesWebSocketEventsWithHttpFallback(
  options: StreamResponsesWebSocketEventsWithHttpFallbackOptions
): AsyncIterable<ResponsesWebSocketJsonEvent> {
  let emittedClientEvent = false;
  let lastResponseId: string | null = null;

  const fallback = async function* () {
    const response = await options.httpFallback();
    yield* bridgeResponsesHttpFallbackToWebSocketEvents(response, {
      requestId: options.requestId,
    });
  };

  if (options.upstream.type === "skipped") {
    yield* fallback();
    return;
  }

  try {
    for await (const event of options.upstream.events) {
      emittedClientEvent = true;
      lastResponseId = extractResponsesWebSocketResponseId(event) ?? lastResponseId;
      yield event;
    }
  } catch (error) {
    if (!emittedClientEvent) {
      yield* fallback();
      return;
    }

    yield createResponsesWebSocketFailedEvent(error, {
      requestId: options.requestId,
      responseId: lastResponseId,
    });
  }
}

export async function* bridgeResponsesHttpFallbackToWebSocketEvents(
  response: Response,
  options: ResponsesWebSocketFallbackBridgeOptions
): AsyncIterable<ResponsesWebSocketJsonEvent> {
  const responseText = await response.text();
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("text/event-stream") || isSSEText(responseText)) {
    yield* parseResponsesSseTextToWebSocketEvents(responseText);
    return;
  }

  yield parseResponsesJsonTextToTerminalEvent(responseText, options);
}

function* parseResponsesSseTextToWebSocketEvents(
  responseText: string
): Iterable<ResponsesWebSocketJsonEvent> {
  for (const event of parseSSEData(responseText)) {
    if (typeof event.data === "string" && event.data.trim() === "[DONE]") continue;

    const data = event.data;
    if (isResponsesWebSocketJsonEvent(data)) {
      yield data;
      continue;
    }

    if (event.event !== "message" && isRecord(data)) {
      yield { type: event.event, ...data };
    }
  }
}

function parseResponsesJsonTextToTerminalEvent(
  responseText: string,
  options: ResponsesWebSocketFallbackBridgeOptions
): ResponsesWebSocketJsonEvent {
  let parsed: unknown;
  try {
    parsed = responseText.trim() ? JSON.parse(responseText) : null;
  } catch (error) {
    return createResponsesWebSocketFailedEvent(error, {
      requestId: options.requestId,
      responseId: null,
    });
  }

  if (isResponsesWebSocketJsonEvent(parsed)) return parsed;

  if (isRecord(parsed) && isRecord(parsed.error)) {
    return {
      type: "error",
      error: normalizeResponsesWebSocketError(parsed.error, "http_fallback_error"),
    };
  }

  const response = isRecord(parsed) && isRecord(parsed.response) ? parsed.response : parsed;

  return {
    type: "response.completed",
    response: response ?? { id: options.requestId, status: "completed" },
  };
}

function createResponsesWebSocketFailedEvent(
  error: unknown,
  options: { requestId: string; responseId: string | null }
): ResponsesWebSocketJsonEvent {
  const normalized = normalizeResponsesWebSocketError(error, "upstream_ws_error");
  const responseId = options.responseId ?? options.requestId;

  return {
    type: "response.failed",
    response: {
      id: responseId,
      status: "failed",
      error: normalized,
    },
    error: normalized,
  };
}

function normalizeResponsesWebSocketError(
  error: unknown,
  fallbackCode: string
): { type: string; code: string; message: string } {
  if (isRecord(error)) {
    const code = stringOrFallback(error.code ?? error.type, fallbackCode);
    return {
      type: stringOrFallback(error.type ?? error.code, code),
      code,
      message: stringOrFallback(error.message, code),
    };
  }

  return {
    type: fallbackCode,
    code: fallbackCode,
    message: error instanceof Error ? error.message : "Responses WebSocket upstream failed",
  };
}

function extractResponsesWebSocketResponseId(event: ResponsesWebSocketJsonEvent): string | null {
  if (!isRecord(event.response)) return null;
  return typeof event.response.id === "string" ? event.response.id : null;
}

function isResponsesWebSocketJsonEvent(value: unknown): value is ResponsesWebSocketJsonEvent {
  return isRecord(value) && typeof value.type === "string";
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
