import WebSocket from "ws";
import type { ResponsesWsCreateFrame, ResponsesWsServerEvent } from "./responses-ws-schema";
import { isResponsesWsTerminalEvent, parseResponsesWsServerEvent } from "./responses-ws-schema";
import {
  createResponsesWsTerminalCollector,
  normalizeResponsesWsTerminalEvent,
} from "./responses-ws-terminal-finalization";
import type { ResponsesWsFallbackReason } from "./responses-ws-transport";

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;
const DEFAULT_FIRST_EVENT_TIMEOUT_MS = 15_000;
const FLEX_FIRST_EVENT_TIMEOUT_MS = 60_000;

export class ResponsesWsTransportError extends Error {
  readonly fallbackReason: ResponsesWsFallbackReason;
  readonly allowHttpFallback: boolean;
  readonly upstreamRequestEstablished: boolean;

  constructor(
    message: string,
    options: {
      fallbackReason: ResponsesWsFallbackReason;
      allowHttpFallback: boolean;
      upstreamRequestEstablished: boolean;
    }
  ) {
    super(message);
    this.name = "ResponsesWsTransportError";
    this.fallbackReason = options.fallbackReason;
    this.allowHttpFallback = options.allowHttpFallback;
    this.upstreamRequestEstablished = options.upstreamRequestEstablished;
  }
}

export interface ResponsesWsTimeoutProfile {
  handshakeTimeoutMs: number;
  firstEventTimeoutMs: number;
}

export interface SendResponsesWsRequestParams {
  websocketUrl: string;
  frame: ResponsesWsCreateFrame;
  headers?: Record<string, string>;
  isStreaming: boolean;
  handshakeTimeoutMs?: number;
  firstEventTimeoutMs?: number;
  onOpen?: (handshakeLatencyMs: number) => void;
  onEvent?: (event: ResponsesWsServerEvent) => void;
}

function stripTypeField(event: ResponsesWsServerEvent): Record<string, unknown> {
  const payload = { ...event } as Record<string, unknown>;
  delete payload.type;
  return payload;
}

function toSseChunk(event: ResponsesWsServerEvent): Uint8Array {
  const payload = JSON.stringify(stripTypeField(event));
  return new TextEncoder().encode(`event: ${event.type}\ndata: ${payload}\n\n`);
}

function normalizeTerminalPayload(event: ResponsesWsServerEvent): Record<string, unknown> {
  const payload = stripTypeField(event);
  if (payload.response && typeof payload.response === "object") {
    return payload.response as Record<string, unknown>;
  }
  return payload;
}

export function resolveResponsesWsTimeoutProfile(
  params: Pick<SendResponsesWsRequestParams, "frame" | "handshakeTimeoutMs" | "firstEventTimeoutMs">
): ResponsesWsTimeoutProfile {
  const requestedServiceTier = params.frame.response.service_tier;
  const handshakeTimeoutMs = params.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  const requestedFirstEventTimeoutMs = params.firstEventTimeoutMs ?? DEFAULT_FIRST_EVENT_TIMEOUT_MS;
  const firstEventTimeoutMs =
    requestedServiceTier === "flex"
      ? Math.max(requestedFirstEventTimeoutMs, FLEX_FIRST_EVENT_TIMEOUT_MS)
      : requestedFirstEventTimeoutMs;

  return {
    handshakeTimeoutMs,
    firstEventTimeoutMs,
  };
}

export async function sendResponsesWsRequest(
  params: SendResponsesWsRequestParams
): Promise<Response> {
  const timeoutProfile = resolveResponsesWsTimeoutProfile(params);

  return new Promise<Response>((resolve, reject) => {
    const startedAt = Date.now();
    let requestEstablished = false;
    let responseResolved = false;
    let terminalSeen = false;
    let firstEventTimeoutId: NodeJS.Timeout | null = null;
    let handshakeTimeoutId: NodeJS.Timeout | null = null;
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const terminalCollector = createResponsesWsTerminalCollector();

    const stream = params.isStreaming
      ? new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
          },
          cancel() {
            socket.close();
          },
        })
      : null;

    const rejectTransport = (error: ResponsesWsTransportError) => {
      if (responseResolved) {
        if (streamController) {
          streamController.error(error);
        }
        return;
      }
      if (firstEventTimeoutId) clearTimeout(firstEventTimeoutId);
      if (handshakeTimeoutId) clearTimeout(handshakeTimeoutId);
      reject(error);
    };

    const maybeResolveStreamingResponse = () => {
      if (!params.isStreaming || responseResolved || !stream) {
        return;
      }
      responseResolved = true;
      resolve(
        new Response(stream, {
          status: 200,
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
          },
        })
      );
    };

    const maybeResolveNonStreamingResponse = (event: ResponsesWsServerEvent) => {
      if (params.isStreaming || responseResolved || !isResponsesWsTerminalEvent(event)) {
        return;
      }
      const normalizedTerminalEvent = normalizeResponsesWsTerminalEvent(event);
      responseResolved = true;
      resolve(
        new Response(
          JSON.stringify(
            normalizedTerminalEvent?.payload?.response ?? normalizeTerminalPayload(event)
          ),
          {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
          }
        )
      );
    };

    const socket = new WebSocket(params.websocketUrl, {
      headers: params.headers,
      handshakeTimeout: timeoutProfile.handshakeTimeoutMs,
    });

    handshakeTimeoutId = setTimeout(() => {
      socket.terminate();
      rejectTransport(
        new ResponsesWsTransportError("Responses WebSocket handshake timed out", {
          fallbackReason: "handshake_timeout",
          allowHttpFallback: true,
          upstreamRequestEstablished: false,
        })
      );
    }, timeoutProfile.handshakeTimeoutMs);

    socket.once("open", () => {
      if (handshakeTimeoutId) clearTimeout(handshakeTimeoutId);
      params.onOpen?.(Date.now() - startedAt);
      socket.send(JSON.stringify(params.frame));
      firstEventTimeoutId = setTimeout(() => {
        socket.terminate();
        rejectTransport(
          new ResponsesWsTransportError("Responses WebSocket first event timed out", {
            fallbackReason: "first_event_timeout",
            allowHttpFallback: !requestEstablished,
            upstreamRequestEstablished: requestEstablished,
          })
        );
      }, timeoutProfile.firstEventTimeoutMs);
    });

    socket.on("message", (raw: WebSocket.RawData) => {
      if (firstEventTimeoutId) clearTimeout(firstEventTimeoutId);
      let event: ResponsesWsServerEvent;
      try {
        event = parseResponsesWsServerEvent(JSON.parse(raw.toString()));
      } catch (error) {
        rejectTransport(
          new ResponsesWsTransportError(
            error instanceof Error ? error.message : "Invalid Responses WebSocket event",
            {
              fallbackReason: requestEstablished
                ? "upstream_request_started"
                : "transport_setup_failed",
              allowHttpFallback: !requestEstablished,
              upstreamRequestEstablished: requestEstablished,
            }
          )
        );
        return;
      }

      requestEstablished = true;
      params.onEvent?.(event);

      terminalCollector.push(event);

      if (params.isStreaming) {
        streamController?.enqueue(toSseChunk(event));
        maybeResolveStreamingResponse();
      }

      if (isResponsesWsTerminalEvent(event)) {
        terminalSeen = true;
        if (params.isStreaming) {
          streamController?.close();
        } else {
          maybeResolveNonStreamingResponse(event);
        }
        socket.close();
      }
    });

    socket.once("error", (error: Error) => {
      rejectTransport(
        new ResponsesWsTransportError(error.message || "Responses WebSocket transport failed", {
          fallbackReason: requestEstablished
            ? "upstream_request_started"
            : "transport_setup_failed",
          allowHttpFallback: !requestEstablished,
          upstreamRequestEstablished: requestEstablished,
        })
      );
    });

    socket.once("close", () => {
      if (handshakeTimeoutId) clearTimeout(handshakeTimeoutId);
      if (firstEventTimeoutId) clearTimeout(firstEventTimeoutId);

      if (terminalSeen) {
        return;
      }

      if (params.isStreaming && responseResolved) {
        streamController?.error(
          new ResponsesWsTransportError("Responses WebSocket closed before terminal event", {
            fallbackReason: "upstream_request_started",
            allowHttpFallback: false,
            upstreamRequestEstablished: true,
          })
        );
        return;
      }

      if (!responseResolved) {
        rejectTransport(
          new ResponsesWsTransportError("Responses WebSocket closed before first event", {
            fallbackReason: requestEstablished ? "upstream_request_started" : "handshake_failed",
            allowHttpFallback: !requestEstablished,
            upstreamRequestEstablished: requestEstablished,
          })
        );
      }
    });
  });
}
