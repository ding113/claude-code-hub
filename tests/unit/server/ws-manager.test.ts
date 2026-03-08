import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted() ensures shared state is available when vi.mock factory executes
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => {
  const state = {
    clients: new Set<any>(),
    wss: null as any,
    opts: null as any,
  };
  return state;
});

vi.mock("ws", () => {
  const { EventEmitter: EE } = require("node:events");

  class MockWebSocketServer extends EE {
    clients: Set<any>;
    handleUpgrade: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;

    constructor(opts: any) {
      super();
      this.clients = mockState.clients;
      this.handleUpgrade = vi.fn();
      this.close = vi.fn((cb?: () => void) => cb?.());
      mockState.wss = this;
      mockState.opts = opts;
    }
  }
  return { WebSocketServer: MockWebSocketServer };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockServer(): HttpServer {
  return new EventEmitter() as unknown as HttpServer;
}

function createMockSocket(): Duplex {
  return {
    destroy: vi.fn(),
  } as unknown as Duplex;
}

function createMockWs() {
  return Object.assign(new EventEmitter(), {
    ping: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    send: vi.fn(),
  });
}

function createMockRequest(urlPath: string): IncomingMessage {
  return {
    url: urlPath,
    headers: { host: "localhost:3000" },
  } as unknown as IncomingMessage;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WsManager", () => {
  let server: HttpServer;

  beforeEach(() => {
    vi.useFakeTimers();
    server = createMockServer();
    mockState.clients.clear();
    mockState.wss = null;
    mockState.opts = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("constructor creates WSS in noServer mode", async () => {
    const { WsManager } = await import("@/server/ws-manager");
    new WsManager(server);

    expect(mockState.opts).toEqual(
      expect.objectContaining({
        noServer: true,
        maxPayload: 16 * 1024 * 1024,
      })
    );
  });

  test("constructor respects custom maxPayloadLength", async () => {
    const { WsManager } = await import("@/server/ws-manager");
    new WsManager(server, { maxPayloadLength: 1024 });

    expect(mockState.opts).toEqual(
      expect.objectContaining({
        noServer: true,
        maxPayload: 1024,
      })
    );
  });

  test("handleUpgrade is called for /v1/responses path", async () => {
    const { WsManager } = await import("@/server/ws-manager");
    new WsManager(server);

    const socket = createMockSocket();
    const head = Buffer.alloc(0);
    const req = createMockRequest("/v1/responses");

    mockState.wss.handleUpgrade.mockImplementation(
      (_req: any, _socket: any, _head: any, cb: (ws: any) => void) => {
        cb(createMockWs());
      }
    );

    server.emit("upgrade", req, socket, head);

    expect(mockState.wss.handleUpgrade).toHaveBeenCalledWith(
      req,
      socket,
      head,
      expect.any(Function)
    );
  });

  test("non-matching paths get socket destroyed", async () => {
    const { WsManager } = await import("@/server/ws-manager");
    new WsManager(server);

    const socket = createMockSocket();
    const head = Buffer.alloc(0);
    const req = createMockRequest("/v1/messages");

    server.emit("upgrade", req, socket, head);

    expect(mockState.wss.handleUpgrade).not.toHaveBeenCalled();
    expect(socket.destroy).toHaveBeenCalled();
  });

  test("onConnection handler receives connections", async () => {
    const { WsManager } = await import("@/server/ws-manager");
    const manager = new WsManager(server);

    const handler = vi.fn();
    manager.onConnection(handler);

    const ws = createMockWs();
    const req = createMockRequest("/v1/responses");

    mockState.wss.emit("connection", ws, req);

    expect(handler).toHaveBeenCalledWith(ws, req);
    expect((ws as any).__isAlive).toBe(true);
  });

  test("onConnection sets up pong listener to mark client alive", async () => {
    const { WsManager } = await import("@/server/ws-manager");
    const manager = new WsManager(server);

    manager.onConnection(vi.fn());

    const ws = createMockWs();
    mockState.wss.emit("connection", ws, createMockRequest("/v1/responses"));

    // Simulate heartbeat marking as dead
    (ws as any).__isAlive = false;

    // Pong should restore alive status
    ws.emit("pong");
    expect((ws as any).__isAlive).toBe(true);
  });

  test("connectionCount returns correct number", async () => {
    const { WsManager } = await import("@/server/ws-manager");
    const manager = new WsManager(server);

    expect(manager.connectionCount).toBe(0);

    mockState.clients.add(createMockWs());
    expect(manager.connectionCount).toBe(1);

    mockState.clients.add(createMockWs());
    expect(manager.connectionCount).toBe(2);
  });

  test("heartbeat pings alive clients", async () => {
    const { WsManager } = await import("@/server/ws-manager");
    new WsManager(server, { heartbeatIntervalMs: 1000 });

    const ws = createMockWs();
    (ws as any).__isAlive = true;
    mockState.clients.add(ws);

    vi.advanceTimersByTime(1000);

    expect(ws.ping).toHaveBeenCalled();
    expect((ws as any).__isAlive).toBe(false);
  });

  test("heartbeat terminates dead clients", async () => {
    const { WsManager } = await import("@/server/ws-manager");
    new WsManager(server, { heartbeatIntervalMs: 1000 });

    const ws = createMockWs();
    (ws as any).__isAlive = false;
    mockState.clients.add(ws);

    vi.advanceTimersByTime(1000);

    expect(ws.terminate).toHaveBeenCalled();
    expect(ws.ping).not.toHaveBeenCalled();
  });

  test("close() terminates all clients and clears heartbeat", async () => {
    const { WsManager } = await import("@/server/ws-manager");
    const manager = new WsManager(server, { heartbeatIntervalMs: 1000 });

    const ws1 = createMockWs();
    const ws2 = createMockWs();
    mockState.clients.add(ws1);
    mockState.clients.add(ws2);

    await manager.close();

    expect(ws1.close).toHaveBeenCalledWith(1001, "Server shutting down");
    expect(ws2.close).toHaveBeenCalledWith(1001, "Server shutting down");
    expect(mockState.wss.close).toHaveBeenCalled();

    // After close, advancing timers should not trigger heartbeat pings
    const ws3 = createMockWs();
    (ws3 as any).__isAlive = true;
    mockState.clients.add(ws3);
    vi.advanceTimersByTime(2000);
    expect(ws3.ping).not.toHaveBeenCalled();
  });

  test("handleUpgrade emits connection event on WSS", async () => {
    const { WsManager } = await import("@/server/ws-manager");
    new WsManager(server);

    const connectionSpy = vi.fn();
    mockState.wss.on("connection", connectionSpy);

    const ws = createMockWs();
    mockState.wss.handleUpgrade.mockImplementation(
      (_req: any, _socket: any, _head: any, cb: (ws: any) => void) => {
        cb(ws);
      }
    );

    const req = createMockRequest("/v1/responses");
    server.emit("upgrade", req, createMockSocket(), Buffer.alloc(0));

    expect(connectionSpy).toHaveBeenCalledWith(ws, req);
  });

  test("close() resolves even with no active clients", async () => {
    const { WsManager } = await import("@/server/ws-manager");
    const manager = new WsManager(server);

    await expect(manager.close()).resolves.toBeUndefined();
    expect(mockState.wss.close).toHaveBeenCalled();
  });
});
