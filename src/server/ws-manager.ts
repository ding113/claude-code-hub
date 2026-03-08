import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";

const WS_PATH = "/v1/responses";

export interface WsManagerOptions {
  /** Max payload size in bytes (default: 16MB) */
  maxPayloadLength?: number;
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatIntervalMs?: number;
}

export class WsManager {
  private wss: WebSocketServer;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor(server: HttpServer, options?: WsManagerOptions) {
    const maxPayload = options?.maxPayloadLength ?? 16 * 1024 * 1024;

    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload,
    });

    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

      if (url.pathname === WS_PATH) {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit("connection", ws, req);
        });
      } else {
        // Not our path; Next.js does not handle WS upgrades
        socket.destroy();
      }
    });

    const heartbeatMs = options?.heartbeatIntervalMs ?? 30_000;
    this.startHeartbeat(heartbeatMs);
  }

  private startHeartbeat(intervalMs: number): void {
    this.heartbeatInterval = setInterval(() => {
      for (const ws of this.wss.clients) {
        if ((ws as any).__isAlive === false) {
          ws.terminate();
          continue;
        }
        (ws as any).__isAlive = false;
        ws.ping();
      }
    }, intervalMs);
  }

  /** Register a connection handler */
  onConnection(handler: (ws: WebSocket, req: IncomingMessage) => void): void {
    this.wss.on("connection", (ws, req) => {
      (ws as any).__isAlive = true;
      ws.on("pong", () => {
        (ws as any).__isAlive = true;
      });
      handler(ws, req);
    });
  }

  /** Get active connection count */
  get connectionCount(): number {
    return this.wss.clients.size;
  }

  /** Graceful shutdown */
  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
      for (const ws of this.wss.clients) {
        ws.close(1001, "Server shutting down");
      }
      this.wss.close(() => resolve());
    });
  }
}
