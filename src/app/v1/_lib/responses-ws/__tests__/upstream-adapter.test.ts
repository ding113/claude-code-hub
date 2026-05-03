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

  it("filters hop-by-hop and shape headers regardless of input shape", async () => {
    let receivedHeaders: Record<string, string | string[] | undefined> = {};
    server = await startMockServer((socket, req) => {
      receivedHeaders = req.headers as Record<string, string | string[] | undefined>;
      socket.on("message", () => {
        socket.send(JSON.stringify({ type: "response.completed", response: { id: "x" } }));
      });
    });

    const plainHeaders: Record<string, string> = {
      authorization: "Bearer sk-mock",
      // These must be filtered out regardless of the input shape:
      connection: "keep-alive",
      host: "evil.example.com",
      "content-length": "999",
      "transfer-encoding": "chunked",
      accept: "application/json",
      "content-type": "application/json",
      // Custom header should pass through:
      "x-cch-tenant": "tenant-a",
    };

    const result = await tryResponsesWebsocketUpstream({
      provider: codexProvider(),
      upstreamUrl: `http://127.0.0.1:${server.port}/v1/responses`,
      upstreamHeaders: plainHeaders,
      body: { model: "gpt-5", input: "hi" },
    });

    expect("response" in result).toBe(true);
    if (!("response" in result)) return;
    await collectSseBody(result.response);

    expect(receivedHeaders.authorization).toBe("Bearer sk-mock");
    expect(receivedHeaders["x-cch-tenant"]).toBe("tenant-a");
    // The host the upstream observed must come from the actual TCP target,
    // never the value we passed in the plain Record (which we filter):
    expect(receivedHeaders.host).not.toBe("evil.example.com");
    // ws-package-managed headers must be set by ws, not echoed from input:
    expect(receivedHeaders["content-length"]).not.toBe("999");
  });

  it("preserves store=false and previous_response_id across continuous WS turns", async () => {
    const receivedFrames: Array<Record<string, unknown>> = [];
    server = await startMockServer((socket) => {
      let turn = 0;
      socket.on("message", (data) => {
        try {
          receivedFrames.push(JSON.parse(data.toString("utf8")) as Record<string, unknown>);
        } catch {
          // ignore
        }
        const responseId = `resp_${++turn}`;
        socket.send(
          JSON.stringify({
            type: "response.created",
            response: { id: responseId },
          })
        );
        socket.send(
          JSON.stringify({
            type: "response.completed",
            response: { id: responseId, prompt_cache_key: "tenantA:s1" },
          })
        );
      });
    });

    // Turn 1: full input, store=false, no previous_response_id yet.
    const turn1 = await tryResponsesWebsocketUpstream({
      provider: codexProvider(),
      upstreamUrl: `http://127.0.0.1:${server.port}/v1/responses`,
      upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
      body: {
        model: "gpt-5",
        store: false,
        prompt_cache_key: "tenantA:s1",
        input: [{ role: "user", content: "hello" }],
      },
    });
    expect("response" in turn1).toBe(true);
    if (!("response" in turn1)) return;
    await collectSseBody(turn1.response);

    // Turn 2: send only the new input + previous_response_id, with store=false
    // preserved. The adapter must forward both fields untouched so the
    // upstream can re-use its in-connection state.
    const turn2 = await tryResponsesWebsocketUpstream({
      provider: codexProvider(),
      upstreamUrl: `http://127.0.0.1:${server.port}/v1/responses`,
      upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
      body: {
        model: "gpt-5",
        store: false,
        prompt_cache_key: "tenantA:s1",
        previous_response_id: "resp_1",
        input: [
          {
            type: "function_call_output",
            call_id: "call_1",
            output: '{"ok":true}',
          },
        ],
      },
    });
    expect("response" in turn2).toBe(true);
    if (!("response" in turn2)) return;
    await collectSseBody(turn2.response);

    expect(receivedFrames).toHaveLength(2);
    const [first, second] = receivedFrames;
    expect(first.type).toBe("response.create");
    expect(first.store).toBe(false);
    expect(first.prompt_cache_key).toBe("tenantA:s1");
    expect(first.previous_response_id).toBeUndefined();

    expect(second.type).toBe("response.create");
    expect(second.store).toBe(false);
    expect(second.previous_response_id).toBe("resp_1");
    expect(second.prompt_cache_key).toBe("tenantA:s1");
    // input was passed through untouched
    expect(Array.isArray(second.input)).toBe(true);
  });

  it("classifies HTTP 426 / 404 / 501 upgrade failures as cacheable-unsupported", async () => {
    const http = await import("node:http");
    for (const status of [426, 404, 501]) {
      const httpServer = http.createServer((_req, res) => {
        res.statusCode = status;
        res.end(`status ${status}`);
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
        if (!("failed" in result)) continue;
        expect(result.cacheableAsUnsupported).toBe(true);
      } finally {
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      }
    }
  });

  it("classifies 401 / 5xx / network errors as NOT cacheable-unsupported", async () => {
    const http = await import("node:http");
    for (const status of [401, 503]) {
      const httpServer = http.createServer((_req, res) => {
        res.statusCode = status;
        res.end(`status ${status}`);
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
        if (!("failed" in result)) continue;
        expect(result.cacheableAsUnsupported).toBe(false);
      } finally {
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      }
    }
  });

  it("emits an error frame when upstream WS fails mid-stream after the first event", async () => {
    server = await startMockServer((socket) => {
      socket.on("message", () => {
        socket.send(JSON.stringify({ type: "response.created", response: { id: "resp_1" } }));
        // Simulate an abrupt protocol-level failure; no terminal event is sent.
        setTimeout(() => {
          try {
            socket.terminate();
          } catch {
            // ignore
          }
        }, 5);
      });
    });

    const result = await tryResponsesWebsocketUpstream({
      provider: codexProvider(),
      upstreamUrl: `http://127.0.0.1:${server.port}/v1/responses`,
      upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
      body: { model: "gpt-5", input: "hi" },
    });

    expect("response" in result).toBe(true);
    if (!("response" in result)) return;
    const body = await collectSseBody(result.response);
    expect(body).toContain('"type":"response.created"');
    // The mid-stream failure must surface as an error event so the downstream
    // pipeline does not mistake the truncated stream for a clean success.
    expect(body).toContain('"type":"error"');
    // Either the network-level error path (`upstream_ws_mid_stream_error`)
    // or the close-without-error path (`upstream_ws_closed_mid_stream`) is
    // acceptable here — terminate() may surface as one or the other depending
    // on platform timing.
    expect(
      body.includes("upstream_ws_mid_stream_error") ||
        body.includes("upstream_ws_closed_mid_stream")
    ).toBe(true);
  });

  it("synthesizes a mid-stream error when upstream closes cleanly without a terminal event", async () => {
    // Some upstreams (or transient infra failures) close the WS with code 1000
    // mid-stream — no `error` event is fired, only `close`. The adapter must
    // still surface this as an error frame so a truncated response is never
    // billed as a clean success.
    server = await startMockServer((socket) => {
      socket.on("message", () => {
        socket.send(JSON.stringify({ type: "response.created", response: { id: "resp_2" } }));
        setTimeout(() => {
          try {
            socket.close(1000, "early_close");
          } catch {
            // ignore
          }
        }, 5);
      });
    });

    const result = await tryResponsesWebsocketUpstream({
      provider: codexProvider(),
      upstreamUrl: `http://127.0.0.1:${server.port}/v1/responses`,
      upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
      body: { model: "gpt-5", input: "hi" },
    });

    expect("response" in result).toBe(true);
    if (!("response" in result)) return;
    const body = await collectSseBody(result.response);
    expect(body).toContain('"type":"response.created"');
    expect(body).toContain('"type":"error"');
    expect(body).toContain("upstream_ws_closed_mid_stream");
    expect(body).toContain("code=1000");
  });

  it("closes the upstream WS after delivering a terminal event", async () => {
    let upstreamCloseCode: number | null = null;
    let upstreamClosedResolve: (() => void) | null = null;
    const upstreamClosed = new Promise<void>((resolve) => {
      upstreamClosedResolve = resolve;
    });
    server = await startMockServer((socket) => {
      socket.on("close", (code) => {
        upstreamCloseCode = code;
        upstreamClosedResolve?.();
      });
      socket.on("message", () => {
        socket.send(JSON.stringify({ type: "response.created", response: { id: "resp_3" } }));
        socket.send(JSON.stringify({ type: "response.completed", response: { id: "resp_3" } }));
      });
    });

    const result = await tryResponsesWebsocketUpstream({
      provider: codexProvider(),
      upstreamUrl: `http://127.0.0.1:${server.port}/v1/responses`,
      upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
      body: { model: "gpt-5", input: "hi" },
    });

    expect("response" in result).toBe(true);
    if (!("response" in result)) return;
    await collectSseBody(result.response);
    await upstreamClosed;
    // 1000 == normal closure. The adapter must initiate a close handshake to
    // release the upstream socket once the terminal event is forwarded.
    expect(upstreamCloseCode).toBe(1000);
  });
});
