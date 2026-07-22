import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import type { Provider } from "@/types/provider";
import {
  clearResponsesWsSessionsForTests,
  cleanupResponsesWsSession,
  getResponsesWsSessionCountForTests,
  setResponsesWsSessionMaxEntriesForTests,
  tryResponsesWebsocketUpstream,
} from "../upstream-adapter";
import {
  INTERNAL_SECRET_HEADER,
  RESPONSES_WS_SESSION_HEADER,
  WS_FORWARD_FLAG_HEADER,
} from "../internal-secret";

type ServerHandle = {
  wss: WebSocketServer;
  port: number;
  close: () => Promise<void>;
};

type StalledUpgradeServerHandle = {
  port: number;
  upgradeReceived: Promise<void>;
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

async function startStalledUpgradeServer(): Promise<StalledUpgradeServerHandle> {
  const http = await import("node:http");
  const sockets = new Set<import("node:net").Socket>();
  let resolveUpgradeReceived: (() => void) | null = null;
  const upgradeReceived = new Promise<void>((resolve) => {
    resolveUpgradeReceived = resolve;
  });
  const httpServer = http.createServer();

  httpServer.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  httpServer.on("upgrade", () => {
    resolveUpgradeReceived?.();
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    httpServer.once("error", onError);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.off("error", onError);
      resolve();
    });
  });

  const address = httpServer.address() as AddressInfo;
  return {
    port: address.port,
    upgradeReceived,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

function captureProcessErrors() {
  const uncaughtExceptions: unknown[] = [];
  const unhandledRejections: unknown[] = [];
  const onUncaughtException = (error: unknown) => uncaughtExceptions.push(error);
  const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);

  process.on("uncaughtException", onUncaughtException);
  process.on("unhandledRejection", onUnhandledRejection);

  return {
    uncaughtExceptions,
    unhandledRejections,
    stop() {
      process.off("uncaughtException", onUncaughtException);
      process.off("unhandledRejection", onUnhandledRejection);
    },
  };
}

async function flushProcessEvents(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe("tryResponsesWebsocketUpstream", () => {
  let server: ServerHandle | null = null;

  afterEach(async () => {
    clearResponsesWsSessionsForTests();
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
      body: { model: "gpt-5.5", input: [{ role: "user", content: "hi" }] },
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
        body: { model: "gpt-5.5", input: "hi" },
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
      body: { model: "gpt-5.5", input: "hi" },
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
        model: "gpt-5.5",
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
      "x-cch-client-transport": "websocket",
      [WS_FORWARD_FLAG_HEADER]: "1",
      [RESPONSES_WS_SESSION_HEADER]: "client-session-1",
      [INTERNAL_SECRET_HEADER]: "loopback-secret-should-stay-local",
      // Custom header should pass through:
      "x-cch-tenant": "tenant-a",
    };

    const result = await tryResponsesWebsocketUpstream({
      provider: codexProvider(),
      upstreamUrl: `http://127.0.0.1:${server.port}/v1/responses`,
      upstreamHeaders: plainHeaders,
      body: { model: "gpt-5.5", input: "hi" },
    });

    expect("response" in result).toBe(true);
    if (!("response" in result)) return;
    await collectSseBody(result.response);

    expect(receivedHeaders.authorization).toBe("Bearer sk-mock");
    expect(receivedHeaders["x-cch-tenant"]).toBe("tenant-a");
    expect(receivedHeaders["x-cch-client-transport"]).toBeUndefined();
    expect(receivedHeaders[WS_FORWARD_FLAG_HEADER]).toBeUndefined();
    expect(receivedHeaders[RESPONSES_WS_SESSION_HEADER]).toBeUndefined();
    expect(receivedHeaders[INTERNAL_SECRET_HEADER]).toBeUndefined();
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
        model: "gpt-5.5",
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
        model: "gpt-5.5",
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

  it("reuses one upstream WS when the client WebSocket session id is stable", async () => {
    const receivedFrames: Array<Record<string, unknown>> = [];
    let connectionCount = 0;
    server = await startMockServer((socket) => {
      connectionCount += 1;
      let turn = 0;
      socket.on("message", (data) => {
        const frame = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
        receivedFrames.push(frame);
        const responseId = `resp_${++turn}`;
        socket.send(JSON.stringify({ type: "response.created", response: { id: responseId } }));
        socket.send(
          JSON.stringify({
            type: "response.completed",
            response: { id: responseId },
          })
        );
      });
    });

    const common = {
      provider: codexProvider(),
      upstreamUrl: `http://127.0.0.1:${server.port}/v1/responses`,
      upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
      sessionId: "client-ws-session-1",
    };

    const turn1 = await tryResponsesWebsocketUpstream({
      ...common,
      body: { model: "gpt-5.5", store: false, input: "first" },
    });
    expect("response" in turn1).toBe(true);
    if (!("response" in turn1)) return;
    expect(turn1.reused).toBe(false);
    await collectSseBody(turn1.response);

    const turn2 = await tryResponsesWebsocketUpstream({
      ...common,
      body: {
        model: "gpt-5.5",
        store: false,
        previous_response_id: "resp_1",
        input: [{ type: "function_call_output", call_id: "call_1", output: "ok" }],
      },
    });
    expect("response" in turn2).toBe(true);
    if (!("response" in turn2)) return;
    expect(turn2.reused).toBe(true);
    await collectSseBody(turn2.response);

    expect(connectionCount).toBe(1);
    expect(receivedFrames).toHaveLength(2);
    expect(receivedFrames[0]?.generate).toBeUndefined();
    expect(receivedFrames[1]?.previous_response_id).toBe("resp_1");
  });

  it("keeps generate=false warmup on the same upstream WS for the generated turn", async () => {
    const receivedFrames: Array<Record<string, unknown>> = [];
    let connectionCount = 0;
    server = await startMockServer((socket) => {
      connectionCount += 1;
      socket.on("message", (data) => {
        const frame = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
        receivedFrames.push(frame);
        const responseId = receivedFrames.length === 1 ? "resp_warmup" : "resp_generated";
        socket.send(JSON.stringify({ type: "response.created", response: { id: responseId } }));
        socket.send(JSON.stringify({ type: "response.completed", response: { id: responseId } }));
      });
    });

    const common = {
      provider: codexProvider(),
      upstreamUrl: `http://127.0.0.1:${server.port}/v1/responses`,
      upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
      sessionId: "client-ws-session-generate-false",
    };

    const warmup = await tryResponsesWebsocketUpstream({
      ...common,
      body: {
        model: "gpt-5.5",
        store: false,
        generate: false,
        input: "warm up",
      },
    });
    expect("response" in warmup).toBe(true);
    if (!("response" in warmup)) return;
    await collectSseBody(warmup.response);

    const generated = await tryResponsesWebsocketUpstream({
      ...common,
      body: {
        model: "gpt-5.5",
        store: false,
        previous_response_id: "resp_warmup",
        input: "continue",
      },
    });
    expect("response" in generated).toBe(true);
    if (!("response" in generated)) return;
    expect(generated.reused).toBe(true);
    await collectSseBody(generated.response);

    expect(connectionCount).toBe(1);
    expect(receivedFrames[0]).toMatchObject({ generate: false, store: false });
    expect(receivedFrames[1]).toMatchObject({ previous_response_id: "resp_warmup" });
  });

  it("forgets the upstream WS after websocket_connection_limit_reached", async () => {
    let connectionCount = 0;
    server = await startMockServer((socket) => {
      connectionCount += 1;
      socket.on("message", () => {
        if (connectionCount === 1) {
          socket.send(
            JSON.stringify({
              type: "error",
              status: 400,
              error: {
                type: "invalid_request_error",
                code: "websocket_connection_limit_reached",
                message: "Responses websocket connection limit reached (60 minutes).",
              },
            })
          );
          return;
        }
        socket.send(JSON.stringify({ type: "response.completed", response: { id: "resp_new" } }));
      });
    });

    const common = {
      provider: codexProvider(),
      upstreamUrl: `http://127.0.0.1:${server.port}/v1/responses`,
      upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
      sessionId: "client-ws-session-limit",
    };

    const first = await tryResponsesWebsocketUpstream({
      ...common,
      body: { model: "gpt-5.5", input: "first" },
    });
    expect("response" in first).toBe(true);
    if (!("response" in first)) return;
    expect(await collectSseBody(first.response)).toContain("websocket_connection_limit_reached");

    const second = await tryResponsesWebsocketUpstream({
      ...common,
      body: { model: "gpt-5.5", input: "after reconnect" },
    });
    expect("response" in second).toBe(true);
    if (!("response" in second)) return;
    expect(second.reused).toBe(false);
    await collectSseBody(second.response);

    expect(connectionCount).toBe(2);
  });

  it("cleanupResponsesWsSession closes the retained upstream WS for a client disconnect", async () => {
    let upstreamCloseCode: number | null = null;
    let resolveClosed: (() => void) | null = null;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    server = await startMockServer((socket) => {
      socket.on("close", (code) => {
        upstreamCloseCode = code;
        resolveClosed?.();
      });
      socket.on("message", () => {
        socket.send(JSON.stringify({ type: "response.completed", response: { id: "resp_1" } }));
      });
    });

    const result = await tryResponsesWebsocketUpstream({
      provider: codexProvider(),
      upstreamUrl: `http://127.0.0.1:${server.port}/v1/responses`,
      upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
      sessionId: "client-ws-session-cleanup",
      body: { model: "gpt-5.5", input: "hi" },
    });
    expect("response" in result).toBe(true);
    if (!("response" in result)) return;
    await collectSseBody(result.response);

    cleanupResponsesWsSession("client-ws-session-cleanup");
    await closed;

    expect(upstreamCloseCode).toBe(1000);
  });

  it("global cleanup hook closes retained upstream WS sessions from shared state", async () => {
    let upstreamCloseCode: number | null = null;
    let resolveClosed: (() => void) | null = null;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    server = await startMockServer((socket) => {
      socket.on("close", (code) => {
        upstreamCloseCode = code;
        resolveClosed?.();
      });
      socket.on("message", () => {
        socket.send(JSON.stringify({ type: "response.completed", response: { id: "resp_1" } }));
      });
    });

    const sessionId = "client-ws-session-global-cleanup";
    const result = await tryResponsesWebsocketUpstream({
      provider: codexProvider(),
      upstreamUrl: `http://127.0.0.1:${server.port}/v1/responses`,
      upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
      sessionId,
      body: { model: "gpt-5.5", input: "hi" },
    });
    expect("response" in result).toBe(true);
    if (!("response" in result)) return;
    await collectSseBody(result.response);

    const globalState = globalThis as unknown as {
      __cchCleanupResponsesWsSession?: (sessionId: string) => void;
      __cchResponsesWsPersistentState?: { sessions: Map<string, unknown> };
    };
    expect(globalState.__cchResponsesWsPersistentState?.sessions.has(sessionId)).toBe(true);

    globalState.__cchCleanupResponsesWsSession?.(sessionId);
    await closed;

    expect(upstreamCloseCode).toBe(1000);
    expect(globalState.__cchResponsesWsPersistentState?.sessions.has(sessionId)).toBe(false);
  });

  it("does not close an active retained session when a concurrent same-session request opens a fresh upstream WS", async () => {
    let connectionCount = 0;
    let firstUpstreamClosed = false;
    let firstUpstreamCloseCode: number | null = null;
    let resolveFirstClosed: (() => void) | null = null;
    const firstClosed = new Promise<void>((resolve) => {
      resolveFirstClosed = resolve;
    });
    let releaseFirstTerminal!: () => void;
    const firstTerminalReleased = new Promise<void>((resolve) => {
      releaseFirstTerminal = resolve;
    });

    server = await startMockServer((socket) => {
      connectionCount += 1;
      const connectionIndex = connectionCount;
      socket.on("close", (code) => {
        if (connectionIndex === 1) {
          firstUpstreamClosed = true;
          firstUpstreamCloseCode = code;
          resolveFirstClosed?.();
        }
      });
      socket.on("message", () => {
        if (connectionIndex === 1) {
          socket.send(
            JSON.stringify({ type: "response.created", response: { id: "resp_active" } })
          );
          firstTerminalReleased.then(() => {
            if (socket.readyState === 1) {
              socket.send(
                JSON.stringify({ type: "response.completed", response: { id: "resp_active" } })
              );
            }
          });
          return;
        }

        socket.send(JSON.stringify({ type: "response.created", response: { id: "resp_fresh" } }));
        socket.send(JSON.stringify({ type: "response.completed", response: { id: "resp_fresh" } }));
      });
    });

    const common = {
      provider: codexProvider(),
      upstreamUrl: `http://127.0.0.1:${server.port}/v1/responses`,
      upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
      sessionId: "client-ws-session-active-race",
    };

    const first = await tryResponsesWebsocketUpstream({
      ...common,
      body: { model: "gpt-5.5", input: "first" },
    });
    expect("response" in first).toBe(true);
    if (!("response" in first)) return;
    expect(first.reused).toBe(false);

    const second = await tryResponsesWebsocketUpstream({
      ...common,
      body: { model: "gpt-5.5", input: "second" },
    });
    expect("response" in second).toBe(true);
    if (!("response" in second)) return;
    expect(second.reused).toBe(false);

    expect(await collectSseBody(second.response)).toContain("resp_fresh");
    expect(connectionCount).toBe(2);
    expect(firstUpstreamClosed).toBe(false);
    expect(getResponsesWsSessionCountForTests()).toBe(1);

    releaseFirstTerminal();
    expect(await collectSseBody(first.response)).toContain("resp_active");
    expect(firstUpstreamClosed).toBe(false);

    cleanupResponsesWsSession(common.sessionId);
    await withTimeout(
      firstClosed,
      1_000,
      "retained active upstream WS did not close after cleanup"
    );
    expect(firstUpstreamCloseCode).toBe(1000);
  });

  it("keeps the busy retained session addressable for cleanup while a fresh same-session request runs", async () => {
    let connectionCount = 0;
    const socketRefs: {
      first: import("ws").WebSocket | null;
      second: import("ws").WebSocket | null;
    } = {
      first: null,
      second: null,
    };
    let firstUpstreamCloseCode: number | null = null;
    let secondUpstreamCloseCode: number | null = null;
    let resolveFirstClosed: (() => void) | null = null;
    let resolveSecondClosed: (() => void) | null = null;
    const firstClosed = new Promise<void>((resolve) => {
      resolveFirstClosed = resolve;
    });
    const secondClosed = new Promise<void>((resolve) => {
      resolveSecondClosed = resolve;
    });

    server = await startMockServer((socket) => {
      connectionCount += 1;
      const connectionIndex = connectionCount;
      if (connectionIndex === 1) {
        socketRefs.first = socket;
      } else if (connectionIndex === 2) {
        socketRefs.second = socket;
      }
      socket.on("close", (code) => {
        if (connectionIndex === 1) {
          firstUpstreamCloseCode = code;
          resolveFirstClosed?.();
        } else if (connectionIndex === 2) {
          secondUpstreamCloseCode = code;
          resolveSecondClosed?.();
        }
      });
      socket.on("message", () => {
        if (connectionIndex === 1) {
          socket.send(
            JSON.stringify({ type: "response.created", response: { id: "resp_busy_active" } })
          );
          return;
        }

        socket.send(
          JSON.stringify({ type: "response.created", response: { id: "resp_busy_fresh" } })
        );
        socket.send(
          JSON.stringify({ type: "response.completed", response: { id: "resp_busy_fresh" } })
        );
      });
    });

    try {
      const sessionId = "client-ws-session-busy-cleanup";
      const common = {
        provider: codexProvider(),
        upstreamUrl: `http://127.0.0.1:${server.port}/v1/responses`,
        upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
        sessionId,
      };

      const first = await tryResponsesWebsocketUpstream({
        ...common,
        body: { model: "gpt-5.5", input: "first" },
      });
      expect("response" in first).toBe(true);
      if (!("response" in first)) return;

      const second = await tryResponsesWebsocketUpstream({
        ...common,
        body: { model: "gpt-5.5", input: "second" },
      });
      expect("response" in second).toBe(true);
      if (!("response" in second)) return;

      expect(await collectSseBody(second.response)).toContain("resp_busy_fresh");
      await withTimeout(
        secondClosed,
        1_000,
        "busy-session fresh upstream WS did not close after terminal"
      );
      expect(secondUpstreamCloseCode).toBe(1000);
      expect(getResponsesWsSessionCountForTests()).toBe(1);

      cleanupResponsesWsSession(sessionId);
      await withTimeout(
        firstClosed,
        1_000,
        "cleanup hook did not close the original busy upstream WS session"
      );
      expect(firstUpstreamCloseCode).toBe(1000);

      const firstBody = await collectSseBody(first.response);
      expect(firstBody).toContain("resp_busy_active");
      expect(firstBody).toContain('"type":"error"');
    } finally {
      if (socketRefs.first?.readyState === 1) socketRefs.first.close(1000);
      if (socketRefs.second?.readyState === 1) socketRefs.second.close(1000);
    }
  });

  it("safely terminates a CONNECTING socket when aborted after construction", async () => {
    const stalledServer = await startStalledUpgradeServer();
    const abortController = new AbortController();
    const processErrors = captureProcessErrors();
    const closeSpy = vi.spyOn(WebSocket.prototype, "close");
    const terminateSpy = vi.spyOn(WebSocket.prototype, "terminate");

    try {
      const resultPromise = tryResponsesWebsocketUpstream({
        provider: codexProvider(),
        upstreamUrl: `http://127.0.0.1:${stalledServer.port}/v1/responses`,
        upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
        abortSignal: abortController.signal,
        body: { model: "gpt-5.5", input: "hi" },
      });

      await withTimeout(
        stalledServer.upgradeReceived,
        1_000,
        "upstream WebSocket did not enter the stalled handshake"
      );
      abortController.abort();

      const result = await withTimeout(
        resultPromise,
        1_000,
        "CONNECTING upstream WebSocket attempt hung after abort"
      );
      await flushProcessEvents();

      expect("failed" in result).toBe(true);
      if (!("failed" in result)) return;
      expect(result.message).toContain("aborted before first upstream WebSocket event");
      expect(terminateSpy).toHaveBeenCalledTimes(1);
      expect(closeSpy).not.toHaveBeenCalled();
      expect(processErrors.uncaughtExceptions).toEqual([]);
      expect(processErrors.unhandledRejections).toEqual([]);

      const clientSocket = terminateSpy.mock.instances[0] as WebSocket;
      expect(clientSocket.listenerCount("open")).toBe(0);
      expect(clientSocket.listenerCount("message")).toBe(0);
      expect(clientSocket.listenerCount("error")).toBe(0);
      expect(clientSocket.listenerCount("close")).toBe(0);
      expect(clientSocket.listenerCount("unexpected-response")).toBe(0);
    } finally {
      processErrors.stop();
      closeSpy.mockRestore();
      terminateSpy.mockRestore();
      await stalledServer.close();
    }
  });

  it("safely terminates a CONNECTING socket when the signal is already aborted", async () => {
    const stalledServer = await startStalledUpgradeServer();
    const abortController = new AbortController();
    abortController.abort();
    const processErrors = captureProcessErrors();
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const closeSpy = vi.spyOn(WebSocket.prototype, "close");
    const terminateSpy = vi.spyOn(WebSocket.prototype, "terminate");

    try {
      const result = await withTimeout(
        tryResponsesWebsocketUpstream({
          provider: codexProvider(),
          upstreamUrl: `http://127.0.0.1:${stalledServer.port}/v1/responses`,
          upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
          abortSignal: abortController.signal,
          body: { model: "gpt-5.5", input: "hi" },
        }),
        1_000,
        "already-aborted upstream WebSocket attempt hung"
      );
      await flushProcessEvents();

      expect("failed" in result).toBe(true);
      if (!("failed" in result)) return;
      expect(result.message).toContain("aborted before first upstream WebSocket event");
      expect(terminateSpy).toHaveBeenCalledTimes(1);
      expect(closeSpy).not.toHaveBeenCalled();
      expect(timeoutSpy.mock.calls.some(([, delay]) => delay === 20_000)).toBe(false);
      expect(processErrors.uncaughtExceptions).toEqual([]);
      expect(processErrors.unhandledRejections).toEqual([]);

      const clientSocket = terminateSpy.mock.instances[0] as WebSocket;
      expect(clientSocket.listenerCount("open")).toBe(0);
      expect(clientSocket.listenerCount("message")).toBe(0);
      expect(clientSocket.listenerCount("error")).toBe(0);
      expect(clientSocket.listenerCount("close")).toBe(0);
      expect(clientSocket.listenerCount("unexpected-response")).toBe(0);
    } finally {
      processErrors.stop();
      timeoutSpy.mockRestore();
      closeSpy.mockRestore();
      terminateSpy.mockRestore();
      await stalledServer.close();
    }
  });

  it("resolves and closes upstream when aborted before the first WS event", async () => {
    let resolveMessageReceived: (() => void) | null = null;
    const messageReceived = new Promise<void>((resolve) => {
      resolveMessageReceived = resolve;
    });
    let upstreamCloseCode: number | null = null;
    let resolveClosed: (() => void) | null = null;
    const upstreamClosed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    server = await startMockServer((socket) => {
      socket.on("message", () => {
        resolveMessageReceived?.();
      });
      socket.on("close", (code) => {
        upstreamCloseCode = code;
        resolveClosed?.();
      });
    });

    const abortController = new AbortController();
    const resultPromise = tryResponsesWebsocketUpstream({
      provider: codexProvider(),
      upstreamUrl: `http://127.0.0.1:${server.port}/v1/responses`,
      upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
      sessionId: "client-ws-session-aborted-before-first-event",
      abortSignal: abortController.signal,
      body: { model: "gpt-5.5", input: "hi" },
    });

    await withTimeout(messageReceived, 1_000, "upstream did not receive the WS request frame");
    abortController.abort();

    const result = await withTimeout(
      resultPromise,
      1_000,
      "upstream WS attempt hung after abort before first event"
    );
    await withTimeout(upstreamClosed, 1_000, "upstream WS did not close after abort");

    expect("failed" in result).toBe(true);
    if (!("failed" in result)) return;
    expect(result.reason).toBe("ws_error_pre_first_event");
    expect(result.message).toContain("aborted before first upstream WebSocket event");
    expect(result.cacheableAsUnsupported).toBe(false);
    expect(upstreamCloseCode).toBe(1000);
  });

  it("closes only once when abort races the first-event timeout", async () => {
    let resolveMessageReceived: (() => void) | null = null;
    const messageReceived = new Promise<void>((resolve) => {
      resolveMessageReceived = resolve;
    });
    let resolveUpstreamClosed: (() => void) | null = null;
    const upstreamClosed = new Promise<void>((resolve) => {
      resolveUpstreamClosed = resolve;
    });
    server = await startMockServer((socket) => {
      socket.on("message", () => {
        resolveMessageReceived?.();
      });
      socket.on("close", () => {
        resolveUpstreamClosed?.();
      });
    });

    const realSetTimeout = globalThis.setTimeout.bind(globalThis);
    let firstEventTimeoutCallback: (() => void) | null = null;
    const placeholderTimer = realSetTimeout(() => {}, 60_000);
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: (...args: unknown[]) => void,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (delay === 20_000) {
        firstEventTimeoutCallback = () => callback(...args);
        return placeholderTimer;
      }
      return realSetTimeout(callback, delay, ...args);
    }) as typeof setTimeout);
    const abortController = new AbortController();
    const processErrors = captureProcessErrors();
    const closeSpy = vi.spyOn(WebSocket.prototype, "close");
    const terminateSpy = vi.spyOn(WebSocket.prototype, "terminate");

    try {
      const resultPromise = tryResponsesWebsocketUpstream({
        provider: codexProvider(),
        upstreamUrl: `http://127.0.0.1:${server.port}/v1/responses`,
        upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
        abortSignal: abortController.signal,
        body: { model: "gpt-5.5", input: "hi" },
      });

      await withTimeout(messageReceived, 1_000, "upstream did not receive the WS request frame");
      expect(firstEventTimeoutCallback).not.toBeNull();
      const triggerFirstEventTimeout = firstEventTimeoutCallback as unknown as () => void;

      abortController.abort();
      triggerFirstEventTimeout();
      const closeInstances = closeSpy.mock.instances as unknown as WebSocket[];
      const clientCloseCallsAfterRace = closeInstances.filter(
        (socket) => socket.url === `ws://127.0.0.1:${server?.port}/v1/responses`
      );
      expect(clientCloseCallsAfterRace).toHaveLength(1);
      const clientSocket = clientCloseCallsAfterRace[0] as WebSocket;

      const result = await withTimeout(
        resultPromise,
        1_000,
        "upstream WS attempt hung during abort and timeout race"
      );
      await withTimeout(upstreamClosed, 1_000, "upstream WS did not close during abort race");
      await flushProcessEvents();

      expect("failed" in result).toBe(true);
      if (!("failed" in result)) return;
      expect(result.message).toContain("aborted before first upstream WebSocket event");
      expect(terminateSpy).not.toHaveBeenCalled();
      expect(processErrors.uncaughtExceptions).toEqual([]);
      expect(processErrors.unhandledRejections).toEqual([]);

      expect(clientSocket.listenerCount("open")).toBe(0);
      expect(clientSocket.listenerCount("message")).toBe(0);
      expect(clientSocket.listenerCount("error")).toBe(0);
      expect(clientSocket.listenerCount("close")).toBe(0);
      expect(clientSocket.listenerCount("unexpected-response")).toBe(0);
    } finally {
      clearTimeout(placeholderTimer);
      processErrors.stop();
      timeoutSpy.mockRestore();
      closeSpy.mockRestore();
      terminateSpy.mockRestore();
    }
  });

  it("keeps an error sink when abort races a socket already in CLOSING", async () => {
    let resolveMessageReceived: (() => void) | null = null;
    const messageReceived = new Promise<void>((resolve) => {
      resolveMessageReceived = resolve;
    });
    server = await startMockServer((socket) => {
      socket.on("message", () => {
        resolveMessageReceived?.();
      });
    });

    const abortController = new AbortController();
    const processErrors = captureProcessErrors();
    const sendSpy = vi.spyOn(WebSocket.prototype, "send");
    const closeSpy = vi.spyOn(WebSocket.prototype, "close");
    const terminateSpy = vi.spyOn(WebSocket.prototype, "terminate");
    let clientSocket: WebSocket | null = null;

    try {
      const resultPromise = tryResponsesWebsocketUpstream({
        provider: codexProvider(),
        upstreamUrl: `http://127.0.0.1:${server.port}/v1/responses`,
        upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
        abortSignal: abortController.signal,
        body: { model: "gpt-5.5", input: "hi" },
      });

      await withTimeout(messageReceived, 1_000, "upstream did not receive the WS request frame");
      const sendInstances = sendSpy.mock.instances as unknown as WebSocket[];
      clientSocket =
        sendInstances.find(
          (socket) => socket.url === `ws://127.0.0.1:${server?.port}/v1/responses`
        ) ?? null;
      expect(clientSocket).not.toBeNull();
      if (!clientSocket) return;

      const mutableClientSocket = clientSocket as WebSocket & { _readyState: number };
      mutableClientSocket._readyState = WebSocket.CLOSING;
      abortController.abort();

      const result = await withTimeout(
        resultPromise,
        1_000,
        "CLOSING upstream WebSocket attempt hung after abort"
      );

      expect("failed" in result).toBe(true);
      if (!("failed" in result)) return;
      expect(closeSpy).not.toHaveBeenCalled();
      expect(terminateSpy).not.toHaveBeenCalled();
      expect(clientSocket.listenerCount("error")).toBe(1);

      clientSocket.emit("error", new Error("synthetic closing-race error"));
      clientSocket.emit("close", 1000, Buffer.alloc(0));
      await flushProcessEvents();

      expect(clientSocket.listenerCount("error")).toBe(0);
      expect(clientSocket.listenerCount("close")).toBe(0);
      expect(processErrors.uncaughtExceptions).toEqual([]);
      expect(processErrors.unhandledRejections).toEqual([]);
    } finally {
      sendSpy.mockRestore();
      closeSpy.mockRestore();
      terminateSpy.mockRestore();
      if (clientSocket && clientSocket.readyState !== WebSocket.CLOSED) {
        clientSocket.once("error", () => {});
        clientSocket.terminate();
        await flushProcessEvents();
      }
      processErrors.stop();
    }
  });

  it("keeps the persistent session map bounded when every retained session is active", async () => {
    setResponsesWsSessionMaxEntriesForTests(1);
    let connectionCount = 0;
    let secondUpstreamCloseCode: number | null = null;
    let resolveSecondClosed: (() => void) | null = null;
    const secondClosed = new Promise<void>((resolve) => {
      resolveSecondClosed = resolve;
    });
    server = await startMockServer((socket) => {
      connectionCount += 1;
      const connectionIndex = connectionCount;
      socket.on("close", (code) => {
        if (connectionIndex === 2) {
          secondUpstreamCloseCode = code;
          resolveSecondClosed?.();
        }
      });
      socket.on("message", () => {
        const responseId = `resp_cap_${connectionIndex}`;
        socket.send(JSON.stringify({ type: "response.created", response: { id: responseId } }));
        if (connectionIndex > 1) {
          socket.send(JSON.stringify({ type: "response.completed", response: { id: responseId } }));
        }
      });
    });

    const first = await tryResponsesWebsocketUpstream({
      provider: codexProvider(),
      upstreamUrl: `http://127.0.0.1:${server.port}/v1/responses`,
      upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
      sessionId: "client-ws-session-cap-active-1",
      body: { model: "gpt-5.5", input: "first" },
    });
    expect("response" in first).toBe(true);
    if (!("response" in first)) return;
    expect(getResponsesWsSessionCountForTests()).toBe(1);

    const second = await tryResponsesWebsocketUpstream({
      provider: codexProvider(),
      upstreamUrl: `http://127.0.0.1:${server.port}/v1/responses`,
      upstreamHeaders: new Headers({ authorization: "Bearer sk-mock" }),
      sessionId: "client-ws-session-cap-active-2",
      body: { model: "gpt-5.5", input: "second" },
    });
    expect("response" in second).toBe(true);
    if (!("response" in second)) return;
    await collectSseBody(second.response);
    await withTimeout(secondClosed, 1_000, "unretained upstream WS did not close after terminal");

    expect(getResponsesWsSessionCountForTests()).toBe(1);
    expect(secondUpstreamCloseCode).toBe(1000);
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
          body: { model: "gpt-5.5", input: "hi" },
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
          body: { model: "gpt-5.5", input: "hi" },
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
      body: { model: "gpt-5.5", input: "hi" },
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
      body: { model: "gpt-5.5", input: "hi" },
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
      body: { model: "gpt-5.5", input: "hi" },
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
