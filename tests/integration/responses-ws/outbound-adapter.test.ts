import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import {
  sendResponsesWsRequest,
  resolveResponsesWsTimeoutProfile,
} from "@/app/v1/_lib/proxy/responses-ws-adapter";

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate free port"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.on("error", reject);
  });
}

describe("responses websocket outbound adapter", () => {
  let wss: WebSocketServer | null = null;

  afterEach(async () => {
    if (wss) {
      await new Promise((resolve) => wss?.close(() => resolve(undefined)));
      wss = null;
    }
  });

  it("sends response.create and receives terminal event", async () => {
    const port = await getFreePort();
    let receivedFrame = null;
    wss = new WebSocketServer({ port, host: "127.0.0.1" });
    wss.on("connection", (socket) => {
      socket.once("message", (raw) => {
        receivedFrame = JSON.parse(raw.toString());
        socket.send(
          JSON.stringify({
            type: "response.created",
            response: {
              id: "resp_1",
              object: "response",
              created: 1,
              model: "gpt-5-codex",
              status: "in_progress",
              service_tier: "flex",
            },
          })
        );
        socket.send(
          JSON.stringify({
            type: "response.completed",
            response: {
              id: "resp_1",
              object: "response",
              created: 1,
              model: "gpt-5-codex",
              status: "completed",
              output: [],
              usage: {
                input_tokens: 11,
                output_tokens: 7,
                total_tokens: 18,
              },
              service_tier: "flex",
            },
          })
        );
      });
    });

    const response = await sendResponsesWsRequest({
      websocketUrl: `ws://127.0.0.1:${port}/v1/responses`,
      frame: {
        type: "response.create",
        response: {
          model: "gpt-5-codex",
          input: [{ role: "user", content: [{ type: "input_text", text: "ping" }] }],
          generate: false,
          service_tier: "flex",
          reasoning: {
            summary: "auto",
            encrypted_content: "enc_abc",
          },
          parallel_tool_calls: false,
          previous_response_id: "resp_prev",
        },
      },
      isStreaming: true,
      handshakeTimeoutMs: 1000,
      firstEventTimeoutMs: 1000,
    });

    const bodyText = await response.text();

    expect(receivedFrame).toMatchObject({
      type: "response.create",
      response: {
        model: "gpt-5-codex",
        generate: false,
        service_tier: "flex",
        previous_response_id: "resp_prev",
        parallel_tool_calls: false,
        reasoning: {
          summary: "auto",
          encrypted_content: "enc_abc",
        },
      },
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(bodyText).toContain("event: response.completed");
    expect(bodyText).toContain('"service_tier":"flex"');
    expect(bodyText).toContain('"input_tokens":11');
  });

  it("extends idle window for flex service tier", () => {
    const timeoutProfile = resolveResponsesWsTimeoutProfile({
      frame: {
        type: "response.create",
        response: {
          model: "gpt-5-codex",
          service_tier: "flex",
        },
      },
      handshakeTimeoutMs: 1000,
      firstEventTimeoutMs: 5000,
    });

    expect(timeoutProfile.handshakeTimeoutMs).toBe(1000);
    expect(timeoutProfile.firstEventTimeoutMs).toBeGreaterThan(5000);
  });
});
