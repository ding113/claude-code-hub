import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { WsManager } from "./ws-manager";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

async function main() {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  await app.prepare();

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url || "/", true);
    handle(req, res, parsedUrl);
  });

  // Attach WebSocket manager on the same HTTP server
  const wsManager = new WsManager(server);

  // Placeholder connection handler (will be replaced by ingress-handler in T6)
  wsManager.onConnection((ws, req) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    console.log(`[WS] New connection on ${url.pathname}`);

    ws.on("message", () => {
      ws.send(
        JSON.stringify({
          type: "error",
          error: {
            type: "server_error",
            message: "WebSocket ingress not yet initialized",
          },
        })
      );
    });
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("[Server] Shutting down...");
    await wsManager.close();
    server.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  server.listen(port, hostname, () => {
    console.log(`[Server] Ready on http://${hostname}:${port} (HTTP + WS)`);
  });
}

main().catch((err) => {
  console.error("[Server] Failed to start:", err);
  process.exit(1);
});
