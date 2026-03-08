import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { executeProviderTest } from "@/lib/provider-testing/test-service";

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

describe("responses websocket provider testing backend", () => {
  let wss: WebSocketServer | null = null;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    if (wss) {
      await new Promise((resolve) => wss?.close(() => resolve(undefined)));
      wss = null;
    }
  });

  it("reports websocket capability for codex provider", async () => {
    const port = await getFreePort();
    wss = new WebSocketServer({ port, host: "127.0.0.1" });
    wss.on("connection", (socket) => {
      socket.once("message", () => {
        socket.send(
          JSON.stringify({
            type: "response.created",
            response: {
              id: "resp_1",
              object: "response",
              created: 1,
              model: "gpt-5-codex",
              status: "in_progress",
            },
          })
        );
        socket.send(
          JSON.stringify({
            type: "response.output_text.delta",
            delta: "pong",
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
              output: [
                {
                  type: "message",
                  role: "assistant",
                  status: "completed",
                  content: [{ type: "output_text", text: "pong" }],
                },
              ],
              usage: {
                input_tokens: 4,
                output_tokens: 4,
                total_tokens: 8,
              },
            },
          })
        );
      });
    });

    const result = await executeProviderTest({
      providerUrl: `http://127.0.0.1:${port}`,
      apiKey: "sk-test",
      providerType: "codex",
      model: "gpt-5-codex",
      preset: "cx_base",
    });

    expect(result.success).toBe(true);
    expect(result.transportKind).toBe("responses_websocket");
    expect(result.websocketHandshakeMs).toBeTypeOf("number");
    expect(result.websocketEventCount).toBe(3);
    expect(result.model).toBe("gpt-5-codex");
    expect(result.usage).toMatchObject({ inputTokens: 4, outputTokens: 4 });
  });

  it("reports unsupported websocket without false positive", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ model: "gpt-5-codex", content: "pong" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      })
    );

    const result = await executeProviderTest({
      providerUrl: "https://api.example.com",
      apiKey: "sk-test",
      providerType: "codex",
      model: "gpt-5-codex",
      preset: "cx_base",
      proxyUrl: "http://proxy.internal:8080",
    });

    expect(result.transportKind).toBe("http");
    expect(result.websocketFallbackReason).toBe("proxy_incompatible");
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });
});
