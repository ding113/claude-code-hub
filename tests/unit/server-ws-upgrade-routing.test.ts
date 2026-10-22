import { once } from "node:events";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

const requireFromHere = createRequire(import.meta.url);
type InternalHttpTarget = { hostname: string; port: number };
const { installResponsesWsUpgradeHandler, WS_MAX_PAYLOAD_BYTES } = requireFromHere(
  "../../server.js"
) as {
  installResponsesWsUpgradeHandler: (
    server: http.Server,
    implementation: typeof WebSocketServer | null,
    internalHttpTarget?: InternalHttpTarget
  ) => WebSocketServer | null;
  WS_MAX_PAYLOAD_BYTES: number;
};

const cleanups: Array<() => Promise<void>> = [];
const clients = new Set<WebSocket>();

afterEach(async () => {
  for (const client of clients) client.terminate();
  clients.clear();
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  vi.restoreAllMocks();
});

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Socket operation timed out")), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function listen(server: http.Server, wss?: WebSocketServer | null): Promise<number> {
  const sockets = new Set<net.Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => (wss ? wss.close(() => resolve()) : resolve())),
    ]);
  });
  server.listen(0, "127.0.0.1");
  await withTimeout(once(server, "listening"));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing TCP address");
  return address.port;
}

function createClient(port: number, path = "/v1/responses"): WebSocket {
  const client = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  clients.add(client);
  client.on("error", () => {});
  return client;
}

async function expectProbe(client: WebSocket): Promise<void> {
  const message = withTimeout(once(client, "message"));
  client.send(JSON.stringify({ type: "probe.invalid" }));
  const [raw] = await message;
  expect(JSON.parse(raw.toString())).toMatchObject({
    type: "error",
    error: { code: "unsupported_event_type" },
  });
}

async function expectStableConnection(port: number): Promise<void> {
  const client = createClient(port, "/v1/responses?probe=upgrade-routing");
  await withTimeout(once(client, "open"));
  await expectProbe(client);
  const pong = withTimeout(once(client, "pong"));
  client.ping("still-open");
  expect((await pong)[0].toString()).toBe("still-open");
  await delay(20);
  await expectProbe(client);
  const closed = withTimeout(once(client, "close"));
  client.close(1000, "test_done");
  const [code, reason] = await closed;
  expect(code).toBe(1000);
  expect(reason.toString()).toBe("test_done");
}

async function warmHttp(port: number): Promise<void> {
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/api/health/live`, { agent: false }, (res) => {
        res.resume();
        res.once("end", resolve);
        res.once("error", reject);
      });
      req.once("error", reject);
    })
  );
}

async function rawUpgrade(port: number, path: string): Promise<string> {
  const socket = net.connect(port, "127.0.0.1");
  let response = "";
  socket.on("data", (chunk) => {
    response += chunk.toString();
  });
  const closed = withTimeout(once(socket, "close"));
  socket.once("connect", () => {
    socket.write(
      `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`
    );
  });
  try {
    await closed;
    return response;
  } finally {
    socket.destroy();
  }
}

describe("Responses WebSocket upgrade routing", () => {
  it.each(["before", "after", "first HTTP"])(
    "owns Responses upgrades with a competing listener registered %s",
    async (order) => {
      const competingListener = vi.fn((_req: http.IncomingMessage, socket: net.Socket) => {
        socket.destroy();
      });
      let registered = false;
      const server = http.createServer((_req, res) => {
        if (order === "first HTTP" && !registered) {
          registered = true;
          server.on("upgrade", competingListener);
        }
        res.end("alive");
      });
      if (order === "before") server.on("upgrade", competingListener);
      const wss = installResponsesWsUpgradeHandler(server, WebSocketServer);
      if (order === "after") server.on("upgrade", competingListener);
      const port = await listen(server, wss);

      if (order === "first HTTP") {
        await expectStableConnection(port);
        await warmHttp(port);
        expect(registered).toBe(true);
      }
      for (let index = 0; index < 12; index += 1) await expectStableConnection(port);
      expect(competingListener).not.toHaveBeenCalled();
      expect(wss?.options.maxPayload).toBe(WS_MAX_PAYLOAD_BYTES);
    }
  );

  it.each([true, false])("delegates other paths when ws is available: %s", async (enabled) => {
    const server = http.createServer();
    const wss = installResponsesWsUpgradeHandler(server, enabled ? WebSocketServer : null);
    const nextUpgrade = vi.fn((req: http.IncomingMessage, socket: net.Socket) => {
      expect(req.url).toBe("/_next/hmr?probe=1");
      socket.end("HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
    });
    server.on("upgrade", nextUpgrade);
    const port = await listen(server, wss);
    expect(await rawUpgrade(port, "/_next/hmr?probe=1")).toContain("204 No Content");
    expect(nextUpgrade).toHaveBeenCalledTimes(1);
  });

  it("closes unclaimed upgrade sockets without another listener", async () => {
    const server = http.createServer();
    const wss = installResponsesWsUpgradeHandler(server, WebSocketServer);
    const port = await listen(server, wss);
    expect(await rawUpgrade(port, "/other")).toBe("");
  });

  it("rejects Responses upgrades without ws and keeps ownership from later listeners", async () => {
    const server = http.createServer();
    expect(installResponsesWsUpgradeHandler(server, null)).toBeNull();
    const competingListener = vi.fn();
    server.on("upgrade", competingListener);
    const port = await listen(server);
    const client = createClient(port);
    const error = withTimeout(once(client, "error"));
    const closed = new Promise<number>((resolve) => client.once("close", resolve));
    await error;
    expect(await withTimeout(closed)).toBe(1006);
    expect(competingListener).not.toHaveBeenCalled();
  });

  it.each([new Error("handshake failed"), "handshake failed"])(
    "destroys the socket when handleUpgrade throws %s",
    (error) => {
      class ThrowingWebSocketServer {
        handleUpgrade() {
          throw error;
        }
      }
      const server = http.createServer();
      installResponsesWsUpgradeHandler(
        server,
        ThrowingWebSocketServer as unknown as typeof WebSocketServer
      );
      const socket = { destroy: vi.fn() };
      const competingListener = vi.fn();
      server.on("upgrade", competingListener);
      expect(server.emit("upgrade", { url: "/v1/responses" }, socket, Buffer.alloc(0))).toBe(true);
      expect(socket.destroy).toHaveBeenCalledOnce();
      expect(competingListener).not.toHaveBeenCalled();
    }
  );

  it.each([new Error("invalid upgrade headers"), "invalid upgrade headers"])(
    "closes with 1011 when the connection handler rejects with %s",
    async (error) => {
      const close = vi.fn(() => {
        if (typeof error === "string") throw new Error("connection already closed");
      });
      class CallbackWebSocketServer {
        handleUpgrade(
          _req: http.IncomingMessage,
          _socket: net.Socket,
          _head: Buffer,
          callback: (client: { close: typeof close }) => void
        ) {
          callback({ close });
        }
      }
      const server = http.createServer();
      installResponsesWsUpgradeHandler(
        server,
        CallbackWebSocketServer as unknown as typeof WebSocketServer
      );
      const req = {
        url: "/v1/responses",
        get headers() {
          throw error;
        },
      };
      expect(server.emit("upgrade", req, {}, Buffer.alloc(0))).toBe(true);
      await vi.waitFor(() => expect(close).toHaveBeenCalledWith(1011, "internal_error"));
    }
  );

  it("preserves ordinary events, listener arguments, this and return values", () => {
    const server = http.createServer();
    installResponsesWsUpgradeHandler(server, null);
    const listener = vi.fn();
    server.on("probe", listener);
    const payload = { value: 1 };
    expect(server.emit("probe", payload)).toBe(true);
    expect(listener).toHaveBeenCalledWith(payload);
    expect(listener.mock.contexts[0]).toBe(server);
    expect(server.emit("unhandled-probe")).toBe(false);
  });

  it("forwards response.create to the supplied private worker HTTP target", async () => {
    const requests: Array<{ path: string | undefined; body: unknown }> = [];
    const internalServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        requests.push({ path: req.url, body: JSON.parse(body) });
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end('event: response.completed\ndata: {"type":"response.completed"}\n\n');
      });
    });
    const internalPort = await listen(internalServer);
    const server = http.createServer((_req, res) => {
      res.writeHead(500);
      res.end("wrong worker target");
    });
    const wss = installResponsesWsUpgradeHandler(server, WebSocketServer, {
      hostname: "127.0.0.1",
      port: internalPort,
    });
    const port = await listen(server, wss);
    const client = createClient(port);
    await withTimeout(once(client, "open"));
    const message = withTimeout(once(client, "message"));
    client.send(JSON.stringify({ type: "response.create", model: "test", input: "probe" }));
    expect(JSON.parse((await message)[0].toString())).toMatchObject({ type: "response.completed" });
    expect(requests).toEqual([
      { path: "/v1/responses", body: { model: "test", input: "probe", stream: true } },
    ]);
    const closed = withTimeout(once(client, "close"));
    client.close(1000);
    expect((await closed)[0]).toBe(1000);
  });
});
