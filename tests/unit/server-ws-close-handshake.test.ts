/**
 * server.js WebSocket close-handshake regression for issue #1150.
 *
 * Verifies that after the SSE→WS bridge delivers a terminal event (or runs
 * into an error), the client WebSocket receives a proper close frame instead
 * of being abruptly torn down — which clients like Codex (tungstenite-rs)
 * surface as "Connection reset without closing handshake".
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
};

function restoreEnvVar(name: "PORT" | "HOSTNAME" | "NODE_ENV", value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
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

  it("sends close(1000) after delivering response.completed", async () => {
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
    client.ws.send(JSON.stringify({ type: "response.create", model: "gpt-5", input: "hi" }));

    const close = await client.closeEvent;
    expect(close.code).toBe(1000);
    expect(close.reason).toBe("response_completed");
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
    client.ws.send(JSON.stringify({ type: "response.create", model: "gpt-5", input: "hi" }));

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

  it("sends close(1011) when the upstream returns a non-stream HTTP error", async () => {
    if (!harness) throw new Error("harness not initialized");
    harness.setSseHandler((_req, res) => {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { code: "bad_gateway", message: "upstream down" } }));
    });

    const client = connectClient(harness.port);
    await client.opened;
    client.ws.send(JSON.stringify({ type: "response.create", model: "gpt-5", input: "hi" }));

    const close = await client.closeEvent;
    expect(close.code).toBe(1011);
    expect(close.reason).toBe("http_502");
  });

  it("sends close(1011) labelled upstream_error when terminal type is 'error'", async () => {
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
    client.ws.send(JSON.stringify({ type: "response.create", model: "gpt-5", input: "hi" }));

    const close = await client.closeEvent;
    expect(close.code).toBe(1011);
    expect(close.reason).toBe("upstream_error");
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
    client.ws.send(JSON.stringify({ type: "response.create", model: "gpt-5", input: bigInput }));

    const close = await client.closeEvent;
    expect(close.code).toBe(1000);
    expect(close.reason).toBe("response_completed");
  }, 20000);

  it("drops queued frames once a terminal close is initiated (no extra upstream calls)", async () => {
    if (!harness) throw new Error("harness not initialized");
    let upstreamCalls = 0;
    harness.setSseHandler((_req, res) => {
      upstreamCalls += 1;
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream");
      // Stagger the response so the second frame, if not dropped, has time
      // to be dequeued and dispatched while we're closing the first.
      setTimeout(() => {
        res.write(
          `data: ${JSON.stringify({
            type: "response.completed",
            response: { id: `r_${upstreamCalls}` },
          })}\n\n`
        );
        res.end();
      }, 20);
    });

    const client = connectClient(harness.port);
    await client.opened;
    // Pipeline two frames before the first response completes. With the race
    // present, drain() pops the second after closeClient() initiates the
    // close handshake but before ws.on("close") fires, hitting the upstream
    // a second time and burning provider quota.
    client.ws.send(JSON.stringify({ type: "response.create", model: "gpt-5", input: "first" }));
    client.ws.send(JSON.stringify({ type: "response.create", model: "gpt-5", input: "second" }));

    const close = await client.closeEvent;
    expect(close.code).toBe(1000);
    expect(close.reason).toBe("response_completed");
    // Exactly one upstream call must have happened — the second frame is
    // dropped synchronously when we initiate the close.
    expect(upstreamCalls).toBe(1);
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

    const client = connectClient(harness.port);
    await client.opened;
    client.ws.send(Buffer.from("not a text frame"), { binary: true });
    client.ws.send(JSON.stringify({ type: "response.create", model: "gpt-5", input: "queued" }));

    const close = await client.closeEvent;
    expect(close.code).toBe(1003);
    expect(close.reason).toBe("binary_not_supported");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(upstreamCalls).toBe(0);
  });

  it("clears the pending queue synchronously on overflow close", async () => {
    if (!harness) throw new Error("harness not initialized");
    let upstreamCalls = 0;
    harness.setSseHandler((_req, res) => {
      upstreamCalls += 1;
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream");
      setTimeout(() => {
        res.write(
          `data: ${JSON.stringify({
            type: "response.completed",
            response: { id: `r_${upstreamCalls}` },
          })}\n\n`
        );
        res.end();
      }, 100);
    });

    const client = connectClient(harness.port);
    await client.opened;
    client.ws.send(JSON.stringify({ type: "response.create", model: "gpt-5", input: "first" }));
    for (let i = 0; i < 70; i += 1) {
      client.ws.send(
        JSON.stringify({ type: "response.create", model: "gpt-5", input: `queued-${i}` })
      );
    }

    const close = await client.closeEvent;
    expect(close.code).toBe(1008);
    expect(close.reason).toBe("too_many_requests");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(upstreamCalls).toBe(1);
  });
});
