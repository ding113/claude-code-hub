import { describe, expect, test } from "vitest";
import {
  formatResponsesWebSocketProtocolErrorEvent,
  parseResponsesWebSocketClientFrame,
  ResponsesWebSocketProtocolError,
  ResponsesWebSocketRequestQueue,
} from "@/server/responses-websocket-protocol";

const requestUrl = "ws://localhost/v1/responses?model=query-model";

function responseCreateFrame(text: string): string {
  return JSON.stringify({
    type: "response.create",
    model: "gpt-5.3-codex",
    input: [{ role: "user", content: [{ type: "input_text", text }] }],
  });
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Responses WebSocket inbound protocol errors", () => {
  test("formats parser failures as JSON Responses error events, not SSE wrappers", () => {
    let protocolError: ResponsesWebSocketProtocolError | undefined;

    try {
      parseResponsesWebSocketClientFrame('{"type":"response.create",', { requestUrl });
    } catch (error) {
      protocolError = error as ResponsesWebSocketProtocolError;
    }

    expect(protocolError).toBeInstanceOf(ResponsesWebSocketProtocolError);
    expect(formatResponsesWebSocketProtocolErrorEvent(protocolError!)).toEqual({
      type: "error",
      error: {
        type: "invalid_json",
        code: "invalid_json",
        message: "Invalid JSON text frame",
      },
    });
    expect(formatResponsesWebSocketProtocolErrorEvent(protocolError!)).not.toHaveProperty("event");
    expect(formatResponsesWebSocketProtocolErrorEvent(protocolError!)).not.toHaveProperty("data");
  });

  test("continues FIFO queue processing after a protocol error rejects one frame", async () => {
    const starts: string[] = [];
    const queue = new ResponsesWebSocketRequestQueue(async (request) => {
      starts.push(request.id);
      parseResponsesWebSocketClientFrame(request.frame, { requestUrl: request.requestUrl });
      return { id: request.id, type: "response.completed" as const };
    });

    const invalid = queue.enqueue({
      id: "invalid",
      frame: '{"type":"response.create",',
      requestUrl,
    });
    const valid = queue.enqueue({
      id: "valid",
      frame: responseCreateFrame("valid after error"),
      requestUrl,
    });

    await expect(invalid).rejects.toMatchObject({ code: "invalid_json" });
    await flushMicrotasks();

    expect(starts).toEqual(["invalid", "valid"]);
    expect(queue.pendingCount).toBe(0);
    await expect(valid).resolves.toEqual({ id: "valid", type: "response.completed" });
    expect(queue.inFlightCount).toBe(0);
  });
});
