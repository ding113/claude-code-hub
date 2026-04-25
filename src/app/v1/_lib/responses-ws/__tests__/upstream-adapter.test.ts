import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import type { Provider } from "@/types/provider";
import { tryResponsesWebsocketUpstream } from "../upstream-adapter";

type ServerHandle = {
  wss: WebSocketServer;
  port: number;
  close: () => Promise<void>;
};

function startMockServer(
  handler: (socket: import("ws").WebSocket, req: import("http").IncomingMessage) => void
): Promise<ServerHandle> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: 0 });
    wss.on("error", reject);
    wss.on("listening", () => {
      const address = wss.address() as AddressInfo;
      wss.on("connection", handler);
      resolve({
        wss,
        port: address.port,
        close: () =>
          new Promise<void>((resolveClose) => {
            wss.close(() => resolveClose());
          }),
      });
    });
  });
}

function codexProvider(): Provider {
  return {
    id: 1,
    name: "mock-codex",
    providerType: "codex",
    baseUrl: "http://mock/",
    apiKey: "sk-mock",
    enabled: true,
    priority: 1,
    weight: 1,
    costMultiplier: 1,
    groupTag: null,
    providerVendorId: null,
  } as unknown as Provider;
}

async function collectSseBody(response: Response): Promise<string> {
  expect(response.body).toBeTruthy();
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

describe("tryResponsesWebsocketUpstream", () => {
  let server: ServerHandle | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it("yields SSE body with Responses events when upstream WS succeeds", async () => {
    server = await startMockServer((socket) => {
      socket.on("message", () => {
        socket.send(JSON.stringify({ type: "response.created", response: { id: "resp_1" } }));
        socket.send(JSON.stringify({ type: "response.output_text.delta", delta: "hi" }));
        socket.send(
          JSON.stringify({
            type: "response.completed",
            response: { id: "resp_1", usage: { input_tokens: 1, output_tokens: 1 } },
          })
        );
      });
    });

    const result = await tryResponsesWebsocketUpstream({
      provider: codexProvider(),
      upstreamUrl: `http://127.0.0.1:${server.port}/v1/responses`,
      upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
      body: { model: "gpt-5", input: [{ role: "user", content: "hi" }] },
    });

    expect("response" in result).toBe(true);
    if (!("response" in result)) return;
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("content-type")).toContain("text/event-stream");
    expect(result.response.headers.get("x-cch-upstream-transport")).toBe("websocket");

    const body = await collectSseBody(result.response);
    expect(body).toContain('"type":"response.created"');
    expect(body).toContain('"type":"response.output_text.delta"');
    expect(body).toContain('"type":"response.completed"');
  });

  it("returns failure when upstream rejects the WS upgrade", async () => {
    // Create a plain http server that returns 404 on /v1/responses to simulate
    // providers that don't speak WS on that path.
    const http = await import("node:http");
    const httpServer = http.createServer((_req, res) => {
      res.statusCode = 404;
      res.end("not found");
    });
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const addr = httpServer.address() as AddressInfo;

    try {
      const result = await tryResponsesWebsocketUpstream({
        provider: codexProvider(),
        upstreamUrl: `http://127.0.0.1:${addr.port}/v1/responses`,
        upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
        body: { model: "gpt-5", input: "hi" },
      });

      expect("failed" in result).toBe(true);
      if (!("failed" in result)) return;
      expect(result.reason).toBe("ws_upgrade_rejected");
    } finally {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  it("returns ws_closed_before_first_event when upstream accepts but closes immediately", async () => {
    server = await startMockServer((socket) => {
      socket.on("message", () => {
        socket.close(1011, "internal");
      });
    });

    const result = await tryResponsesWebsocketUpstream({
      provider: codexProvider(),
      upstreamUrl: `http://127.0.0.1:${server.port}/v1/responses`,
      upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
      body: { model: "gpt-5", input: "hi" },
    });

    expect("failed" in result).toBe(true);
    if (!("failed" in result)) return;
    expect(
      result.reason === "ws_closed_before_first_event" ||
        result.reason === "ws_error_pre_first_event"
    ).toBe(true);
  });

  it("strips stream and background transport-only fields from the forwarded frame", async () => {
    let receivedFrame: unknown = null;
    server = await startMockServer((socket) => {
      socket.on("message", (data) => {
        try {
          receivedFrame = JSON.parse(data.toString("utf8"));
        } catch {
          receivedFrame = null;
        }
        socket.send(
          JSON.stringify({
            type: "response.completed",
            response: { id: "resp_1" },
          })
        );
      });
    });

    const result = await tryResponsesWebsocketUpstream({
      provider: codexProvider(),
      upstreamUrl: `http://127.0.0.1:${server.port}/v1/responses`,
      upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
      body: {
        model: "gpt-5",
        input: "hi",
        stream: true,
        background: false,
        store: false,
      },
    });

    expect("response" in result).toBe(true);
    if (!("response" in result)) return;
    await collectSseBody(result.response);

    expect(receivedFrame).toBeTruthy();
    expect((receivedFrame as Record<string, unknown>).type).toBe("response.create");
    expect((receivedFrame as Record<string, unknown>).stream).toBeUndefined();
    expect((receivedFrame as Record<string, unknown>).background).toBeUndefined();
    expect((receivedFrame as Record<string, unknown>).store).toBe(false);
  });
});
