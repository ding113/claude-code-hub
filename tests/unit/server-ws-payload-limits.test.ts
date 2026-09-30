import http from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

const requireFromHere = createRequire(import.meta.url);
const { handleWebSocketConnection } = requireFromHere("../../server.js");
const limits = { soft: 1024, absolute: 2048, hard: 3072, pending: 4096 };
const FORCE_HTTP_HEADER = "x-cch-responses-ws-force-http";
const FORCE_HTTP_REASON = "payload_too_large_for_upstream_ws";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function frameOfSize(bytes: number) {
  const frame = JSON.stringify({ type: "response.create", model: "gpt-5.5", input: "hi" });
  return frame + " ".repeat(bytes - Buffer.byteLength(frame));
}

async function startHarness(
  options: {
    holdErrorCallback?: boolean;
    stallHttp?: boolean;
    headers?: Record<string, string>;
  } = {}
) {
  const requests: http.IncomingHttpHeaders[] = [];
  const requestStarted = deferred<void>();
  const requestAborted = deferred<void>();
  const messages: Array<{
    type?: string;
    status?: number;
    error?: { code: string; message: string };
  }> = [];
  const messageReceived = deferred<void>();
  const callbackHeld = deferred<() => void>();
  const server = http.createServer((req, res) => {
    requests.push(req.headers);
    requestStarted.resolve();
    req.resume();
    res.on("close", () => requestAborted.resolve());
    if (options.stallHttp) return;
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end('data: {"type":"response.completed","response":{"id":"done"}}\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const wss = new WebSocketServer({ noServer: true, maxPayload: limits.hard });
  let serverWs: WebSocket | undefined;
  server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      serverWs = ws;
      if (options.holdErrorCallback) {
        const originalSend = ws.send.bind(ws);
        ws.send = ((data: string, callback: (error?: Error) => void) => {
          if (JSON.parse(data).status === 413) {
            originalSend(data, (error?: Error) => callbackHeld.resolve(() => callback(error)));
          } else originalSend(data, callback);
        }) as typeof ws.send;
      }
      void handleWebSocketConnection(ws, req, { hostname: "127.0.0.1", port }, limits);
    });
  });
  const client = new WebSocket(`ws://127.0.0.1:${port}/v1/responses`, { headers: options.headers });
  client.on("message", (data) => {
    messages.push(JSON.parse(data.toString()));
    messageReceived.resolve();
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    client.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  await new Promise<void>((resolve, reject) => {
    client.once("open", resolve);
    client.once("error", reject);
  });
  return {
    client,
    messages,
    requests,
    closed,
    messageReceived: messageReceived.promise,
    requestStarted: requestStarted.promise,
    requestAborted: requestAborted.promise,
    callbackHeld: callbackHeld.promise,
    get serverWs() {
      return serverWs!;
    },
    async close() {
      client.terminate();
      for (const socket of wss.clients) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

let harness: Awaited<ReturnType<typeof startHarness>> | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe("Responses WS client payload limits", () => {
  it.each([
    [limits.soft - 1, false],
    [limits.soft, false],
    [limits.soft + 1, true],
    [limits.absolute, true],
  ])("routes a %i-byte message with force-HTTP=%s", async (bytes, force) => {
    harness = await startHarness();
    harness.client.send(frameOfSize(bytes as number));
    await harness.messageReceived;
    expect(harness.requests).toHaveLength(1);
    expect(harness.requests[0][FORCE_HTTP_HEADER]).toBe(force ? FORCE_HTTP_REASON : undefined);
    expect(harness.messages[0].type).toBe("response.completed");
    expect(harness.client.readyState).toBe(WebSocket.OPEN);
  });

  it("counts UTF-8 bytes rather than string characters", async () => {
    harness = await startHarness();
    const frame = JSON.stringify({ type: "response.create", input: "界".repeat(400) });
    expect(frame.length).toBeLessThan(limits.soft);
    expect(Buffer.byteLength(frame)).toBeGreaterThan(limits.soft);
    harness.client.send(frame);
    await harness.messageReceived;
    expect(harness.requests[0][FORCE_HTTP_HEADER]).toBe(FORCE_HTTP_REASON);
  });

  it("applies the limit to the full fragmented message", async () => {
    harness = await startHarness();
    const frame = frameOfSize(limits.absolute + 1);
    harness.client.send(frame.slice(0, 1000), { fin: false });
    harness.client.send(frame.slice(1000), { fin: true });
    expect(await harness.closed).toEqual({ code: 1009, reason: "request_payload_too_large" });
    expect(harness.requests).toHaveLength(0);
    expect(harness.messages[0].status).toBe(413);
  });

  it.each([limits.absolute + 1, limits.hard])(
    "sends a structured 413 for %i bytes before closing",
    async (bytes) => {
      harness = await startHarness({ headers: { "accept-language": "en" } });
      harness.client.send(frameOfSize(bytes));
      expect(await harness.closed).toEqual({ code: 1009, reason: "request_payload_too_large" });
      expect(harness.requests).toHaveLength(0);
      expect(harness.messages).toEqual([
        expect.objectContaining({
          type: "error",
          status: 413,
          error: { code: "request_payload_too_large", message: expect.stringContaining("exceeds") },
        }),
      ]);
    }
  );

  it("leaves messages above the hard limit to the ws receiver", async () => {
    harness = await startHarness();
    harness.client.send(frameOfSize(limits.hard + 1));
    expect((await harness.closed).code).toBe(1009);
    expect(harness.requests).toHaveLength(0);
  });

  it("waits for the error send callback and drops further frames while closing", async () => {
    harness = await startHarness({ holdErrorCallback: true });
    harness.client.send(frameOfSize(limits.absolute + 1));
    const acknowledge = await harness.callbackHeld;
    await harness.messageReceived;
    expect(harness.serverWs.readyState).toBe(WebSocket.OPEN);
    const received = new Promise<void>((resolve) =>
      harness!.serverWs.once("message", () => resolve())
    );
    harness.client.send(frameOfSize(limits.soft));
    await received;
    expect(harness.requests).toHaveLength(0);
    acknowledge();
    expect((await harness.closed).code).toBe(1009);
    expect(harness.messages).toHaveLength(1);
  });

  it("aborts the active HTTP request and drops queued frames on an oversized message", async () => {
    harness = await startHarness({ stallHttp: true });
    harness.client.send(frameOfSize(limits.soft));
    await harness.requestStarted;
    harness.client.send(frameOfSize(limits.soft));
    harness.client.send(frameOfSize(limits.absolute + 1));
    expect((await harness.closed).code).toBe(1009);
    await harness.requestAborted;
    expect(harness.requests).toHaveLength(1);
    expect(harness.messages.some((event) => event.status === 413)).toBe(true);
  });

  it("strips a client-supplied force-HTTP marker on a small request", async () => {
    harness = await startHarness({ headers: { [FORCE_HTTP_HEADER]: FORCE_HTTP_REASON } });
    harness.client.send(frameOfSize(limits.soft));
    await harness.messageReceived;
    expect(harness.requests[0][FORCE_HTTP_HEADER]).toBeUndefined();
  });
});
