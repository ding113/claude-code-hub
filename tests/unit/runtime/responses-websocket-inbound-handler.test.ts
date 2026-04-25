import { describe, expect, test, vi } from "vitest";
import {
  ResponsesWebSocketInboundHandler,
  type ResponsesWebSocketExecutorInput,
  type ResponsesWebSocketJsonEvent,
} from "@/server/responses-websocket-protocol";

const requestUrl = "ws://localhost/v1/responses?model=query-model";

function createInput(text = "Ping") {
  return [{ role: "user" as const, content: [{ type: "input_text" as const, text }] }];
}

function responseCreateFrame(body: Record<string, unknown>): string {
  return JSON.stringify({ type: "response.create", body });
}

describe("Responses WebSocket inbound handler", () => {
  test("enqueues a valid client frame, executes parsed request once, and emits JSON events", async () => {
    const received: ResponsesWebSocketJsonEvent[] = [];
    const mockedEvents: ResponsesWebSocketJsonEvent[] = [
      { type: "response.created", response: { id: "resp_1", status: "in_progress" } },
      { type: "response.completed", response: { id: "resp_1", status: "completed" } },
    ];
    const executorInputs: ResponsesWebSocketExecutorInput[] = [];
    const executor = vi.fn(async (input: ResponsesWebSocketExecutorInput) => {
      executorInputs.push(input);
      return mockedEvents;
    });
    const handler = new ResponsesWebSocketInboundHandler({
      requestUrl,
      executor,
      eventSink: (event) => received.push(event),
      createRequestId: () => "request-1",
      executionContext: {
        requestUrl,
        headers: new Headers({ authorization: "Bearer test-key" }),
        clientAbortSignal: null,
      },
    });

    const events = await handler.handleFrame(
      responseCreateFrame({
        input: createInput("handler valid"),
        stream: true,
        background: true,
      })
    );

    expect(executor).toHaveBeenCalledTimes(1);
    expect(executorInputs[0]).toMatchObject({
      id: "request-1",
      upstreamBody: {
        model: "query-model",
        input: createInput("handler valid"),
      },
      transport: { stream: true, background: true },
      modelSource: "query",
    });
    expect(executorInputs[0]?.upstreamBody).not.toHaveProperty("stream");
    expect(executorInputs[0]?.upstreamBody).not.toHaveProperty("background");
    expect(executorInputs[0]?.executionContext.headers?.get("authorization")).toBe(
      "Bearer test-key"
    );
    expect(events).toEqual(mockedEvents);
    expect(received).toEqual(mockedEvents);
  });

  test("uses query model fallback when handler receives a relative upgrade URL", async () => {
    const executorInputs: ResponsesWebSocketExecutorInput[] = [];
    const executor = vi.fn(async (input: ResponsesWebSocketExecutorInput) => {
      executorInputs.push(input);
      return { type: "response.completed", response: { id: "resp_relative" } };
    });
    const handler = new ResponsesWebSocketInboundHandler({
      requestUrl: "/v1/responses?model=query-model",
      executor,
      createRequestId: () => "relative-request",
    });

    await handler.handleFrame(responseCreateFrame({ input: createInput("relative handler") }));

    expect(executor).toHaveBeenCalledTimes(1);
    expect(executorInputs[0]?.upstreamBody.model).toBe("query-model");
    expect(executorInputs[0]?.modelSource).toBe("query");
    expect(executorInputs[0]?.requestUrl).toBe("/v1/responses?model=query-model");
  });

  test("emits JSON protocol errors without crashing and stays usable for later valid frames", async () => {
    const received: ResponsesWebSocketJsonEvent[] = [];
    const executor = vi.fn(async () => [
      { type: "response.completed", response: { id: "resp_after_error", status: "completed" } },
    ]);
    const handler = new ResponsesWebSocketInboundHandler({
      requestUrl,
      executor,
      eventSink: (event) => received.push(event),
      createRequestId: () => "stable-request-id",
    });

    const invalidJson = await handler.handleFrame('{"type":"response.create",');
    const unsupportedType = await handler.handleFrame(
      JSON.stringify({ type: "session.update", session: {} })
    );
    const binary = await handler.handleFrame(new Uint8Array([0, 1, 2]));
    const valid = await handler.handleFrame(
      responseCreateFrame({ model: "body-model", input: createInput("after errors") })
    );

    expect(invalidJson[0]).toMatchObject({
      type: "error",
      error: { code: "invalid_json" },
    });
    expect(unsupportedType[0]).toMatchObject({
      type: "error",
      error: { code: "unsupported_event_type" },
    });
    expect(binary[0]).toMatchObject({
      type: "error",
      error: { code: "binary_frame_not_supported" },
    });
    expect(valid).toEqual([
      { type: "response.completed", response: { id: "resp_after_error", status: "completed" } },
    ]);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(received.map((event) => event.type)).toEqual([
      "error",
      "error",
      "error",
      "response.completed",
    ]);
  });
});
