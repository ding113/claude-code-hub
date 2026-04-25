import { describe, expect, test, vi } from "vitest";
import {
  bridgeResponsesHttpFallbackToWebSocketEvents,
  streamResponsesWebSocketEventsWithHttpFallback,
} from "@/server/responses-websocket-fallback-bridge";
import type { ResponsesWebSocketJsonEvent } from "@/server/responses-websocket-protocol";
import {
  ResponsesWebSocketUnsupportedError,
  ResponsesWebSocketUpstreamError,
  type ResponsesWebSocketUpstreamAdapterResult,
} from "@/server/responses-websocket-upstream-adapter";

describe("Responses WebSocket HTTP fallback bridge", () => {
  test("falls back from upstream WS unsupported to HTTP SSE and emits JSON response events", async () => {
    const fallbackResponse = createSseResponse([
      { type: "response.created", response: { id: "resp_sse", status: "in_progress" } },
      { type: "response.output_text.delta", delta: "Hello" },
      {
        type: "response.completed",
        response: { id: "resp_sse", status: "completed", model: "gpt-4.1" },
      },
    ]);
    const httpFallback = vi.fn(async () => fallbackResponse);

    const events = await collectEvents(
      streamResponsesWebSocketEventsWithHttpFallback({
        requestId: "request-sse",
        upstream: createUnsupportedUpstream(),
        httpFallback,
      })
    );

    expect(httpFallback).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      { type: "response.created", response: { id: "resp_sse", status: "in_progress" } },
      { type: "response.output_text.delta", delta: "Hello" },
      {
        type: "response.completed",
        response: { id: "resp_sse", status: "completed", model: "gpt-4.1" },
      },
    ]);
    expect(events).not.toContain("event: response.created");
    expect(events).not.toContain("data:");
  });

  test("does not call HTTP fallback after upstream WS has emitted a client event", async () => {
    const httpFallback = vi.fn(async () => createSseResponse([]));
    const events = await collectEvents(
      streamResponsesWebSocketEventsWithHttpFallback({
        requestId: "request-partial",
        upstream: createPartialFailureUpstream(),
        httpFallback,
      })
    );

    expect(httpFallback).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: "response.created", response: { id: "resp_partial", status: "in_progress" } },
      {
        type: "response.failed",
        response: {
          id: "resp_partial",
          status: "failed",
          error: {
            type: "upstream_ws_error",
            code: "upstream_ws_error",
            message: "Upstream closed after first event",
          },
        },
        error: {
          type: "upstream_ws_error",
          code: "upstream_ws_error",
          message: "Upstream closed after first event",
        },
      },
    ]);
  });

  test("bridges HTTP non-stream JSON as a terminal response.completed event", async () => {
    const finalResponse = {
      id: "resp_json",
      object: "response",
      status: "completed",
      model: "gpt-4.1",
      usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 },
      output: [{ type: "message", content: [{ type: "output_text", text: "Done" }] }],
    };

    const events = await collectEvents(
      bridgeResponsesHttpFallbackToWebSocketEvents(
        new Response(JSON.stringify(finalResponse), {
          headers: { "content-type": "application/json" },
        }),
        { requestId: "request-json" }
      )
    );

    expect(events).toEqual([{ type: "response.completed", response: finalResponse }]);
  });
});

function createUnsupportedUpstream(): ResponsesWebSocketUpstreamAdapterResult {
  return {
    type: "connected",
    upstreamUrl: "ws://upstream.test/v1/responses",
    events: {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<ResponsesWebSocketJsonEvent>> {
            throw new ResponsesWebSocketUnsupportedError(
              "Upstream WebSocket unsupported",
              "handshake_status_426"
            );
          },
        };
      },
    },
  };
}

function createPartialFailureUpstream(): ResponsesWebSocketUpstreamAdapterResult {
  return {
    type: "connected",
    upstreamUrl: "ws://upstream.test/v1/responses",
    events: (async function* () {
      yield { type: "response.created", response: { id: "resp_partial", status: "in_progress" } };
      throw new ResponsesWebSocketUpstreamError("Upstream closed after first event");
    })(),
  };
}

function createSseResponse(events: ResponsesWebSocketJsonEvent[]): Response {
  const body = [
    ...events.flatMap((event) => [`event: ${event.type}`, `data: ${JSON.stringify(event)}`, ""]),
    "data: [DONE]",
    "",
  ].join("\n");

  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

async function collectEvents(
  events: AsyncIterable<ResponsesWebSocketJsonEvent>
): Promise<ResponsesWebSocketJsonEvent[]> {
  const collected: ResponsesWebSocketJsonEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}
