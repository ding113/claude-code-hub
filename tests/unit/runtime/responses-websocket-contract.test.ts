import { describe, expect, test } from "vitest";
import {
  parseResponsesWebSocketClientFrame,
  ResponsesWebSocketProtocolError,
  ResponsesWebSocketRequestQueue,
  type ResponsesWebSocketProtocolErrorCode,
} from "@/server/responses-websocket-protocol";

const requestUrl = "ws://localhost/v1/responses?model=query-model";

function createInput(text = "Ping") {
  return [
    {
      role: "user" as const,
      content: [{ type: "input_text" as const, text }],
    },
  ];
}

function textFrame(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

function responseCreateFrame(body: Record<string, unknown>): string {
  return textFrame({ type: "response.create", body });
}

function expectProtocolError(
  action: () => unknown,
  expectedCode: ResponsesWebSocketProtocolErrorCode
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ResponsesWebSocketProtocolError);
    expect((error as ResponsesWebSocketProtocolError).code).toBe(expectedCode);
    return;
  }

  throw new Error(`Expected ResponsesWebSocketProtocolError with code ${expectedCode}`);
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Responses WebSocket client protocol contract", () => {
  test("parses response.create JSON text frames into Responses create upstream payloads", () => {
    const body = {
      model: "gpt-5.3-codex",
      input: createInput(),
      instructions: "Answer briefly.",
      max_output_tokens: 256,
      metadata: { trace: "contract-test" },
      parallel_tool_calls: false,
      previous_response_id: "resp_previous",
      reasoning: { effort: "minimal", summary: "auto" },
      store: false,
      temperature: 0.2,
      tool_choice: "auto",
      tools: [
        {
          type: "function",
          function: {
            name: "lookup",
            description: "Lookup local data",
            parameters: { type: "object", properties: {} },
            strict: true,
          },
        },
      ],
      top_p: 0.9,
      truncation: "auto",
      user: "user_123",
      service_tier: "auto",
    };

    const parsed = parseResponsesWebSocketClientFrame(responseCreateFrame(body), { requestUrl });

    expect(parsed).toEqual({
      type: "response.create",
      upstreamBody: body,
      transport: {},
      modelSource: "body",
    });
  });

  test("parses plan-style top-level response.create frames into the same upstream payload", () => {
    const parsed = parseResponsesWebSocketClientFrame(
      textFrame({
        type: "response.create",
        model: "top-level-model",
        input: createInput("top-level body"),
        metadata: { trace: "top-level-contract" },
        stream: true,
        background: false,
      }),
      { requestUrl }
    );

    expect(parsed).toEqual({
      type: "response.create",
      upstreamBody: {
        model: "top-level-model",
        input: createInput("top-level body"),
        metadata: { trace: "top-level-contract" },
      },
      transport: { stream: true, background: false },
      modelSource: "body",
    });
  });

  test("tolerates stream and background inbound but strips them from upstream payload", () => {
    const parsed = parseResponsesWebSocketClientFrame(
      responseCreateFrame({
        model: "gpt-5.3-codex",
        input: createInput(),
        stream: true,
        background: true,
      }),
      { requestUrl }
    );

    expect(parsed.transport).toEqual({ stream: true, background: true });
    expect(parsed.upstreamBody).not.toHaveProperty("stream");
    expect(parsed.upstreamBody).not.toHaveProperty("background");
    expect(parsed.upstreamBody).toMatchObject({
      model: "gpt-5.3-codex",
      input: createInput(),
    });
  });

  test("uses body.model before query model and query fallback only when body model is absent", () => {
    const bodyModel = parseResponsesWebSocketClientFrame(
      responseCreateFrame({ model: "body-model", input: createInput("body wins") }),
      { requestUrl: "ws://localhost/v1/responses?model=query-model" }
    );
    const queryFallback = parseResponsesWebSocketClientFrame(
      responseCreateFrame({ input: createInput("query fallback") }),
      { requestUrl: "ws://localhost/v1/responses?model=query-model" }
    );

    expect(bodyModel.upstreamBody.model).toBe("body-model");
    expect(bodyModel.modelSource).toBe("body");
    expect(queryFallback.upstreamBody.model).toBe("query-model");
    expect(queryFallback.modelSource).toBe("query");
  });

  test("uses query model fallback from Node upgrade-style relative request URLs", () => {
    const queryFallback = parseResponsesWebSocketClientFrame(
      responseCreateFrame({ input: createInput("relative query fallback") }),
      { requestUrl: "/v1/responses?model=query-model" }
    );
    const bodyModel = parseResponsesWebSocketClientFrame(
      responseCreateFrame({ model: "body-model", input: createInput("relative body wins") }),
      { requestUrl: "/v1/responses?model=query-model" }
    );

    expect(queryFallback.upstreamBody.model).toBe("query-model");
    expect(queryFallback.modelSource).toBe("query");
    expect(bodyModel.upstreamBody.model).toBe("body-model");
    expect(bodyModel.modelSource).toBe("body");
  });

  test("rejects unsupported client event types instead of accepting Realtime API events", () => {
    expectProtocolError(
      () =>
        parseResponsesWebSocketClientFrame(
          textFrame({ type: "session.update", session: { modalities: ["text"] } }),
          { requestUrl }
        ),
      "unsupported_event_type"
    );
  });

  test("rejects invalid JSON text frames", () => {
    expectProtocolError(
      () => parseResponsesWebSocketClientFrame('{"type":"response.create",', { requestUrl }),
      "invalid_json"
    );
  });

  test("rejects binary frames", () => {
    expectProtocolError(
      () => parseResponsesWebSocketClientFrame(new Uint8Array([0, 1, 2, 3]), { requestUrl }),
      "binary_frame_not_supported"
    );
  });

  test("serializes response.create frames FIFO with only one in-flight request", async () => {
    const firstGate = deferred();
    const secondGate = deferred();
    const starts: string[] = [];
    const queue = new ResponsesWebSocketRequestQueue(async (request) => {
      starts.push(request.id);
      await (request.id === "first" ? firstGate.promise : secondGate.promise);
      return { id: request.id, type: "response.completed" as const };
    });

    const first = queue.enqueue({
      id: "first",
      frame: responseCreateFrame({ model: "gpt-5.3-codex", input: createInput("first") }),
      requestUrl,
    });
    const second = queue.enqueue({
      id: "second",
      frame: responseCreateFrame({ model: "gpt-5.3-codex", input: createInput("second") }),
      requestUrl,
    });

    await flushMicrotasks();
    expect(starts).toEqual(["first"]);
    expect(queue.inFlightCount).toBe(1);
    expect(queue.pendingCount).toBe(1);

    firstGate.resolve();
    await expect(first).resolves.toEqual({ id: "first", type: "response.completed" });
    await flushMicrotasks();

    expect(starts).toEqual(["first", "second"]);
    expect(queue.inFlightCount).toBe(1);
    expect(queue.pendingCount).toBe(0);

    secondGate.resolve();
    await expect(second).resolves.toEqual({ id: "second", type: "response.completed" });
    expect(queue.inFlightCount).toBe(0);
  });
});
