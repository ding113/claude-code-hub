/**
 * server.js WebSocket close-handshake regression for issue #1150.
 *
 * Verifies that normal terminal events keep the persistent client WebSocket
 * usable for the next response.create, while fatal protocol/transport paths
 * still receive a proper close frame instead of being abruptly torn down —
 * which clients like Codex (tungstenite-rs) surface as
 * "Connection reset without closing handshake".
 */

import { createRequire } from "node:module";
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

const requireFromHere = createRequire(import.meta.url);

type ServerHarness = {
  port: number;
  server: http.Server;
  wss: WebSocketServer;
  setSseHandler: (handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) => void;
  nextServerConnection: () => Promise<{
    close: Promise<void>;
    waitForMessageCount: (count: number) => Promise<void>;
  }>;
  close: () => Promise<void>;
};

type ServerJsModule = {
  handleWebSocketConnection: (ws: WebSocket, req: http.IncomingMessage) => Promise<void>;
};

let serverModule: ServerJsModule;
let harness: ServerHarness | null = null;
let originalEnv: {
  PORT: string | undefined;
  HOSTNAME: string | undefined;
  NODE_ENV: string | undefined;
} = {
  PORT: process.env.PORT,
  HOSTNAME: process.env.HOSTNAME,
  NODE_ENV: process.env.NODE_ENV,
};

function restoreEnvVar(name: "PORT" | "HOSTNAME" | "NODE_ENV", value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

async function waitForMessageCount(
  messages: unknown[],
  count: number,
  timeoutMs: number,
  message: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setInterval>;
    const timeout = setTimeout(() => {
      clearInterval(timer);
      reject(new Error(message));
    }, timeoutMs);
    timer = setInterval(() => {
      if (messages.length >= count) {
        clearTimeout(timeout);
        clearInterval(timer);
        resolve();
      }
    }, 5);
    if (messages.length >= count) {
      clearTimeout(timeout);
      clearInterval(timer);
      resolve();
    }
  });
}

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      if (typeof addr !== "object" || addr === null) {
        probe.close();
        reject(new Error("address() returned non-object"));
        return;
      }
      const port = addr.port;
      probe.close(() => resolve(port));
    });
  });
}

async function startHarness(port: number): Promise<ServerHarness> {
  let sseHandler: ((req: http.IncomingMessage, res: http.ServerResponse) => void) | null = null;
  const connectionWaiters: Array<
    (signal: {
      close: Promise<void>;
      waitForMessageCount: (count: number) => Promise<void>;
    }) => void
  > = [];

  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/v1/responses") {
      // Drain the body before invoking the handler — otherwise some Node
      // versions hold the request open waiting for the consumer.
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        if (sseHandler) sseHandler(req, res);
        else {
          res.statusCode = 503;
          res.end("no handler set");
        }
      });
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/v1/responses") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const closeSignal = deferred<void>();
      const messageWaiters: Array<{ count: number; resolve: () => void }> = [];
      let messageCount = 0;
      const notifyMessageWaiters = () => {
        for (let i = messageWaiters.length - 1; i >= 0; i -= 1) {
          const waiter = messageWaiters[i]!;
          if (messageCount >= waiter.count) {
            messageWaiters.splice(i, 1);
            waiter.resolve();
          }
        }
      };
      ws.once("close", () => closeSignal.resolve());
      serverModule.handleWebSocketConnection(ws as unknown as WebSocket, req).catch((err) => {
        process.stderr.write(
          `[server-ws-close-handshake] handleWebSocketConnection failed: ${
            err instanceof Error ? err.stack || err.message : String(err)
          }\n`
        );
        try {
          ws.close(1011, "internal_error");
        } catch {
          ws.terminate();
        }
      });
      // Register after the bridge handler so waitForMessageCount() resolves only
      // after the production message listener has accepted or rejected the frame.
      ws.on("message", () => {
        messageCount += 1;
        notifyMessageWaiters();
      });
      const waiter = connectionWaiters.shift();
      if (waiter) {
        waiter({
          close: closeSignal.promise,
          waitForMessageCount: (count) => {
            if (messageCount >= count) return Promise.resolve();
            return new Promise<void>((resolve) => {
              messageWaiters.push({ count, resolve });
            });
          },
        });
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

  return {
    port,
    server,
    wss,
    setSseHandler: (handler) => {
      sseHandler = handler;
    },
    nextServerConnection: () =>
      new Promise((resolve) => {
        connectionWaiters.push(resolve);
      }),
    close: () =>
      new Promise<void>((resolve) => {
        wss.close(() => {
          server.close(() => resolve());
        });
      }),
  };
}

function connectClient(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/responses`);
  const closeEvent = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.once("close", (code, reason) => resolve({ code, reason: reason.toString("utf8") }));
  });
  const messages: unknown[] = [];
  ws.on("message", (raw) => {
    try {
      messages.push(JSON.parse(raw.toString("utf8")));
    } catch {
      messages.push(raw.toString("utf8"));
    }
  });
  const opened = new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return { ws, opened, closeEvent, messages };
}

describe("server.js WebSocket close-handshake (issue #1150)", () => {
  beforeAll(async () => {
    const port = await pickFreePort();
    originalEnv = {
      PORT: process.env.PORT,
      HOSTNAME: process.env.HOSTNAME,
      NODE_ENV: process.env.NODE_ENV,
    };
    process.env.PORT = String(port);
    process.env.HOSTNAME = "127.0.0.1";
    process.env.NODE_ENV = "test";
    // Require server.js *after* env vars are set so its module-level `port`
    // and INTERNAL_TUNNEL_HOST capture our values.
    serverModule = requireFromHere("../../server.js") as ServerJsModule;
    harness = await startHarness(port);
  });

  afterAll(async () => {
    if (harness) {
      await harness.close();
      harness = null;
    }
    restoreEnvVar("PORT", originalEnv.PORT);
    restoreEnvVar("HOSTNAME", originalEnv.HOSTNAME);
    restoreEnvVar("NODE_ENV", originalEnv.NODE_ENV);
  });

  it("keeps the client WebSocket open after delivering response.completed", async () => {
    if (!harness) throw new Error("harness not initialized");
    harness.setSseHandler((_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream");
      res.write(
        `data: ${JSON.stringify({ type: "response.created", response: { id: "r_1" } })}\n\n`
      );
      res.write(
        `data: ${JSON.stringify({
          type: "response.completed",
          response: { id: "r_1", usage: { input_tokens: 1, output_tokens: 1 } },
        })}\n\n`
      );
      res.end();
    });

    const client = connectClient(harness.port);
    await client.opened;
    client.ws.send(JSON.stringify({ type: "response.create", model: "gpt-5.4", input: "hi" }));

    await waitForMessageCount(
      client.messages,
      2,
      3000,
      "response.completed was not forwarded to the client"
    );
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
    client.ws.close(1000, "test_done");
    const close = await client.closeEvent;
    expect(close.code).toBe(1000);
    const types = client.messages
      .filter((m): m is { type: string } => typeof m === "object" && m !== null)
      .map((m) => m.type);
    expect(types).toContain("response.created");
    expect(types).toContain("response.completed");
  });

  it("sends close(1011) when the upstream stream ends without a terminal event", async () => {
    if (!harness) throw new Error("harness not initialized");
    harness.setSseHandler((_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream");
      res.write(
        `data: ${JSON.stringify({ type: "response.created", response: { id: "r_2" } })}\n\n`
      );
      // End without a terminal event — Codex must still receive a close frame.
      res.end();
    });

    const client = connectClient(harness.port);
    await client.opened;
    client.ws.send(JSON.stringify({ type: "response.create", model: "gpt-5.4", input: "hi" }));

    const close = await client.closeEvent;
    expect(close.code).toBe(1011);
    expect(close.reason).toBe("stream_ended_without_terminal");
    const errorEvent = client.messages.find(
      (m): m is { type: string; error: { code: string } } =>
        typeof m === "object" && m !== null && (m as { type?: unknown }).type === "error"
    );
    expect(errorEvent).toBeTruthy();
    expect(errorEvent?.error.code).toBe("stream_ended_without_terminal");
  });

  it("sends close(1011) when the internal HTTP response is destroyed mid-stream", async () => {
    if (!harness) throw new Error("harness not initialized");
    harness.setSseHandler((_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream");
      res.write(
        `data: ${JSON.stringify({ type: "response.created", response: { id: "r_destroy" } })}\n\n`
      );
      setTimeout(() => {
        res.socket?.destroy();
      }, 10);
    });

    const client = connectClient(harness.port);
    await client.opened;
    client.ws.send(JSON.stringify({ type: "response.create", model: "gpt-5.4", input: "hi" }));

    const close = await client.closeEvent;
    expect(close.code).toBe(1011);
    expect(["internal_response_closed", "internal_response_error"]).toContain(close.reason);
    const errorEvent = client.messages.find(
      (m): m is { type: string; error: { code: string } } =>
        typeof m === "object" && m !== null && (m as { type?: unknown }).type === "error"
    );
    expect(errorEvent).toBeTruthy();
    expect(["internal_response_closed", "internal_response_error"]).toContain(
      errorEvent?.error.code
    );
  });

  it("forwards a non-stream HTTP error without closing the persistent client socket", async () => {
    if (!harness) throw new Error("harness not initialized");
    harness.setSseHandler((_req, res) => {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { code: "bad_gateway", message: "upstream down" } }));
    });

    const client = connectClient(harness.port);
    await client.opened;
    client.ws.send(JSON.stringify({ type: "response.create", model: "gpt-5.4", input: "hi" }));

    await waitForMessageCount(client.messages, 1, 3000, "HTTP error was not forwarded");
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
    const errorEvent = client.messages.find(
      (m): m is { type: string; status: number; error: { code: string } } =>
        typeof m === "object" && m !== null && (m as { type?: unknown }).type === "error"
    );
    expect(errorEvent?.status).toBe(502);
    expect(errorEvent?.error.code).toBe("bad_gateway");
    client.ws.close(1000, "test_done");
    await client.closeEvent;
  });

  it("forwards terminal type 'error' without closing the persistent client socket", async () => {
    if (!harness) throw new Error("harness not initialized");
    harness.setSseHandler((_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream");
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          error: { code: "upstream_failure", message: "boom" },
        })}\n\n`
      );
      res.end();
    });

    const client = connectClient(harness.port);
    await client.opened;
    client.ws.send(JSON.stringify({ type: "response.create", model: "gpt-5.4", input: "hi" }));

    await waitForMessageCount(client.messages, 1, 3000, "terminal error was not forwarded");
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
    client.ws.close(1000, "test_done");
    await client.closeEvent;
  });

  it("accepts response.create bodies up to 4 MiB without a maxPayload teardown", async () => {
    if (!harness) throw new Error("harness not initialized");
    harness.setSseHandler((_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream");
      res.write(
        `data: ${JSON.stringify({
          type: "response.completed",
          response: { id: "r_big" },
        })}\n\n`
      );
      res.end();
    });

    const client = connectClient(harness.port);
    await client.opened;
    // 4 MiB of repeated text — comfortably above the prior 1 MiB cap that
    // caused tungstenite to surface "Connection reset without closing
    // handshake".
    const bigInput = "x".repeat(4 * 1024 * 1024);
    client.ws.send(JSON.stringify({ type: "response.create", model: "gpt-5.4", input: bigInput }));

    await waitForMessageCount(client.messages, 1, 3000, "large response was not forwarded");
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
    client.ws.close(1000, "test_done");
    const close = await client.closeEvent;
    expect(close.code).toBe(1000);
  }, 20000);

  it("processes queued response.create frames sequentially after a terminal event", async () => {
    if (!harness) throw new Error("harness not initialized");
    let upstreamCalls = 0;
    harness.setSseHandler((_req, res) => {
      upstreamCalls += 1;
      const callNo = upstreamCalls;
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream");
      // Stagger the response so the second frame remains queued until the
      // first turn's terminal event has been fully forwarded.
      setTimeout(() => {
        res.write(
          `data: ${JSON.stringify({
            type: "response.completed",
            response: { id: `r_${callNo}` },
          })}\n\n`
        );
        res.end();
      }, 20);
    });

    const client = connectClient(harness.port);
    await client.opened;
    // Pipeline two frames before the first response completes. A compliant
    // Responses WS bridge keeps the client socket open and drains them
    // sequentially.
    client.ws.send(JSON.stringify({ type: "response.create", model: "gpt-5.4", input: "first" }));
    client.ws.send(JSON.stringify({ type: "response.create", model: "gpt-5.4", input: "second" }));

    await waitForMessageCount(client.messages, 2, 3000, "both queued responses were not forwarded");
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
    client.ws.close(1000, "test_done");
    const close = await client.closeEvent;
    expect(close.code).toBe(1000);
    expect(upstreamCalls).toBe(2);
  });

  it("drops any pipelined frame after a binary protocol close", async () => {
    if (!harness) throw new Error("harness not initialized");
    let upstreamCalls = 0;
    harness.setSseHandler((_req, res) => {
      upstreamCalls += 1;
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream");
      res.write(
        `data: ${JSON.stringify({
          type: "response.completed",
          response: { id: "should_not_run" },
        })}\n\n`
      );
      res.end();
    });

    const serverConnectionPromise = harness.nextServerConnection();
    const client = connectClient(harness.port);
    const serverConnection = await withTimeout(
      serverConnectionPromise,
      3000,
      "server WebSocket did not accept the binary-close test connection"
    );
    await client.opened;
    const queuedFrameObserved = serverConnection.waitForMessageCount(2);
    client.ws.send(Buffer.from("not a text frame"), { binary: true });
    client.ws.send(JSON.stringify({ type: "response.create", model: "gpt-5.4", input: "queued" }));

    const close = await client.closeEvent;
    expect(close.code).toBe(1003);
    expect(close.reason).toBe("binary_not_supported");
    await withTimeout(
      serverConnection.close,
      3000,
      "server WebSocket did not close after binary protocol close"
    );
    await withTimeout(
      queuedFrameObserved,
      3000,
      "server WebSocket did not observe the queued text frame after binary close"
    );
    expect(upstreamCalls).toBe(0);
  });

  it("aborts the in-flight request and clears the pending queue on overflow close", async () => {
    if (!harness) throw new Error("harness not initialized");
    let upstreamCalls = 0;
    let firstResponse: http.ServerResponse | null = null;
    const firstRequestStarted = deferred<void>();
    const firstResponseClosed = deferred<void>();
    harness.setSseHandler((_req, res) => {
      upstreamCalls += 1;
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream");
      if (upstreamCalls === 1) {
        firstResponse = res;
        res.on("close", () => firstResponseClosed.resolve());
        res.write(":\n\n");
        firstRequestStarted.resolve();
        return;
      }
      res.write(
        `data: ${JSON.stringify({
          type: "response.completed",
          response: { id: `unexpected_${upstreamCalls}` },
        })}\n\n`
      );
      res.end();
    });

    try {
      const serverConnectionPromise = harness.nextServerConnection();
      const client = connectClient(harness.port);
      const serverConnection = await withTimeout(
        serverConnectionPromise,
        3000,
        "server WebSocket did not accept the overflow test connection"
      );
      await client.opened;
      client.ws.send(JSON.stringify({ type: "response.create", model: "gpt-5.4", input: "first" }));
      await withTimeout(
        firstRequestStarted.promise,
        3000,
        "first upstream request did not start before overflow test"
      );
      for (let i = 0; i < 70; i += 1) {
        client.ws.send(
          JSON.stringify({ type: "response.create", model: "gpt-5.4", input: `queued-${i}` })
        );
      }

      const close = await client.closeEvent;
      expect(close.code).toBe(1008);
      expect(close.reason).toBe("too_many_requests");
      await withTimeout(
        serverConnection.close,
        3000,
        "server WebSocket did not close after overflow protocol close"
      );
      await withTimeout(
        firstResponseClosed.promise,
        3000,
        "overflow close did not abort the in-flight internal request"
      );
      expect(upstreamCalls).toBe(1);
    } finally {
      if (firstResponse && !firstResponse.destroyed && !firstResponse.writableEnded) {
        firstResponse.end();
      }
    }
  });
});
