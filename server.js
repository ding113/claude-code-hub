// Custom Node.js server for claude-code-hub.
//
// Purpose: add WebSocket upgrade support on /v1/responses so clients that speak
// the OpenAI Responses WebSocket protocol (text JSON frames with
// type=response.create) can proxy through CCH. All other HTTP traffic is
// delegated to the Next.js App Router handler unchanged.
//
// Architecture: this server is a thin tunnel. For each client WebSocket frame,
// we build an equivalent HTTP POST against the same app's /v1/responses
// endpoint (with an x-cch-client-transport header) so that auth, provider
// selection, guard pipeline, forwarder, circuit breakers, observability, and
// all existing TypeScript business logic run exactly once. Upstream WebSocket
// attempts live inside that TypeScript pipeline (forwarder), not here.
//
// Compatibility:
// - Non-WebSocket clients: unaffected. HTTP still flows through Next.js.
// - Non-Codex providers: the forwarder never attempts upstream WS; client WS
//   is still accepted and tunneled through HTTP SSE.
// - Setting disabled: client WS handshake still succeeds (so clients don't
//   break), but every frame is tunneled over HTTP with no upstream-WS attempt.

"use strict";

const http = require("node:http");
const { parse } = require("node:url");

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = parseInt(process.env.PORT || (dev ? "13500" : "3000"), 10);

const WS_PATH = "/v1/responses";
const CLIENT_TRANSPORT_HEADER = "x-cch-client-transport";
const WS_FORWARD_FLAG_HEADER = "x-cch-responses-ws-forward";

const TERMINAL_EVENT_TYPES = new Set([
  "response.completed",
  "response.failed",
  "response.incomplete",
  "error",
]);

function log(level, msg, extra) {
  const line = { ts: new Date().toISOString(), level, msg, ...(extra || {}) };
  try {
    process.stdout.write(`${JSON.stringify(line)}\n`);
  } catch {
    // ignore
  }
}

function safeSend(ws, data) {
  try {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(typeof data === "string" ? data : JSON.stringify(data));
      return true;
    }
  } catch (err) {
    log("warn", "ws_send_failed", { error: String(err) });
  }
  return false;
}

function emitErrorEvent(ws, code, message) {
  safeSend(ws, {
    type: "error",
    error: { code, message },
  });
}

async function handleWebSocketConnection(ws, req) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const queryModel = url.searchParams.get("model");
  let inFlight = false;
  const pending = [];
  let closed = false;

  const finalize = () => {
    closed = true;
  };
  ws.on("close", finalize);
  ws.on("error", finalize);

  const processFrame = async (raw) => {
    if (closed) return;

    if (typeof raw !== "string") {
      emitErrorEvent(ws, "invalid_frame_type", "Only text WebSocket frames are supported");
      try {
        ws.close(1003, "binary_not_supported");
      } catch {
        // ignore
      }
      return;
    }

    let frame;
    try {
      frame = JSON.parse(raw);
    } catch (err) {
      emitErrorEvent(ws, "invalid_json", `Invalid JSON frame: ${err && err.message ? err.message : "parse error"}`);
      return;
    }

    if (!frame || typeof frame !== "object") {
      emitErrorEvent(ws, "invalid_frame", "Frame must be a JSON object");
      return;
    }

    if (frame.type !== "response.create") {
      emitErrorEvent(ws, "unsupported_event_type", `Only type=response.create is supported; received: ${frame.type ?? "(missing)"}`);
      return;
    }

    const { type, ...rawBody } = frame;
    const body = { ...rawBody };
    // body.model wins over query; only fill from query when body lacks a model
    // (LiteLLM/other compat). Drop transport-only fields.
    if (queryModel && (body.model === undefined || body.model === null || body.model === "")) {
      body.model = queryModel;
    }

    await forwardToInternalHttp(ws, req, body);
  };

  const drain = async () => {
    if (inFlight) return;
    const next = pending.shift();
    if (!next) return;
    inFlight = true;
    try {
      await processFrame(next);
    } finally {
      inFlight = false;
      if (pending.length > 0 && !closed) {
        void drain();
      }
    }
  };

  ws.on("message", (data, isBinary) => {
    if (closed) return;
    if (isBinary) {
      emitErrorEvent(ws, "invalid_frame_type", "Only text WebSocket frames are supported");
      try {
        ws.close(1003, "binary_not_supported");
      } catch {
        // ignore
      }
      return;
    }
    pending.push(data.toString("utf8"));
    void drain();
  });
}

async function forwardToInternalHttp(ws, originalReq, body) {
  const internalHeaders = {};
  for (const [k, v] of Object.entries(originalReq.headers)) {
    // Skip hop-by-hop / WS-specific headers; keep app-level auth/session etc.
    const lower = k.toLowerCase();
    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "upgrade" ||
      lower === "sec-websocket-key" ||
      lower === "sec-websocket-version" ||
      lower === "sec-websocket-extensions" ||
      lower === "sec-websocket-protocol" ||
      lower === "content-length" ||
      lower === "transfer-encoding"
    ) {
      continue;
    }
    if (Array.isArray(v)) {
      internalHeaders[k] = v.join(", ");
    } else if (typeof v === "string") {
      internalHeaders[k] = v;
    }
  }
  internalHeaders["accept"] = "text/event-stream";
  internalHeaders["content-type"] = "application/json";
  internalHeaders[CLIENT_TRANSPORT_HEADER] = "websocket";
  internalHeaders[WS_FORWARD_FLAG_HEADER] = "1";

  // Force streaming so we can translate SSE events to WS frames incrementally.
  // The upstream pipeline will strip transport-only fields (stream, background)
  // before forwarding to upstream WebSocket.
  const bodyForHttp = { ...body, stream: true };
  delete bodyForHttp.background;

  const payload = Buffer.from(JSON.stringify(bodyForHttp), "utf8");
  internalHeaders["content-length"] = String(payload.length);

  await new Promise((resolve) => {
    const req = http.request(
      {
        method: "POST",
        hostname: "127.0.0.1",
        port,
        path: "/v1/responses",
        headers: internalHeaders,
      },
      (res) => {
        const contentType = (res.headers["content-type"] || "").toLowerCase();
        const isSse = contentType.includes("text/event-stream");

        if (!isSse) {
          // Upstream returned non-stream JSON (e.g. error response). Collect
          // and emit as a single terminal event.
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let parsed;
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = { raw: text };
            }
            if (res.statusCode && res.statusCode >= 400) {
              safeSend(ws, {
                type: "error",
                error: typeof parsed === "object" && parsed && parsed.error
                  ? parsed.error
                  : { code: `http_${res.statusCode}`, message: text.slice(0, 512) },
              });
            } else {
              safeSend(ws, {
                type: "response.completed",
                response: parsed,
              });
            }
            resolve();
          });
          res.on("error", (err) => {
            emitErrorEvent(ws, "internal_response_error", String(err && err.message ? err.message : err));
            resolve();
          });
          return;
        }

        // SSE path: decode `data:` events and emit each as a WS JSON frame.
        let buffer = "";
        let sawTerminal = false;

        const flushEvents = () => {
          let idx;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const lines = chunk.split(/\r?\n/);
            const dataLines = [];
            for (const line of lines) {
              if (line.startsWith("data:")) {
                dataLines.push(line.slice(5).trimStart());
              }
            }
            if (dataLines.length === 0) continue;
            const dataText = dataLines.join("\n");
            if (dataText === "[DONE]") {
              if (!sawTerminal) {
                // Some upstreams close SSE with [DONE] without a preceding
                // response.completed. Synthesize one so the client sees a
                // clean terminal event.
                safeSend(ws, { type: "response.completed", response: null });
                sawTerminal = true;
              }
              continue;
            }
            let event;
            try {
              event = JSON.parse(dataText);
            } catch {
              // Not JSON; forward as raw string event.
              safeSend(ws, { type: "response.output_text.delta", delta: dataText });
              continue;
            }
            safeSend(ws, event);
            if (event && typeof event.type === "string" && TERMINAL_EVENT_TYPES.has(event.type)) {
              sawTerminal = true;
            }
          }
        };

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buffer += chunk;
          flushEvents();
        });
        res.on("end", () => {
          // Flush any remaining buffered event
          if (buffer.trim().length > 0) {
            buffer += "\n\n";
            flushEvents();
          }
          if (!sawTerminal) {
            emitErrorEvent(
              ws,
              "stream_ended_without_terminal",
              "Upstream stream ended before emitting a terminal response event"
            );
          }
          resolve();
        });
        res.on("error", (err) => {
          emitErrorEvent(ws, "internal_response_error", String(err && err.message ? err.message : err));
          resolve();
        });
      }
    );

    req.on("error", (err) => {
      emitErrorEvent(ws, "internal_request_error", String(err && err.message ? err.message : err));
      resolve();
    });

    req.write(payload);
    req.end();
  });
}

function isResponsesWsUpgrade(req) {
  if (!req.url) return false;
  const parsed = parse(req.url);
  return parsed.pathname === WS_PATH;
}

async function main() {
  // Import Next programmatically. We require it lazily so that the server can
  // still report a clean error if Next is not installed (unlikely but possible
  // in a misconfigured deployment).
  let nextModule;
  try {
    // eslint-disable-next-line global-require
    nextModule = require("next");
  } catch (err) {
    log("error", "next_import_failed", { error: String(err && err.message ? err.message : err) });
    process.exit(1);
    return;
  }
  const nextFactory = typeof nextModule === "function" ? nextModule : nextModule.default;

  let WebSocketServer;
  try {
    // eslint-disable-next-line global-require
    WebSocketServer = require("ws").WebSocketServer;
  } catch (err) {
    log("warn", "ws_module_unavailable_ws_disabled", {
      error: String(err && err.message ? err.message : err),
    });
    WebSocketServer = null;
  }

  const app = nextFactory({ dev, hostname, port });
  const handler = app.getRequestHandler();
  await app.prepare();

  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handler(req, res, parsedUrl);
    } catch (err) {
      log("error", "http_handler_error", { error: String(err && err.message ? err.message : err) });
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    }
  });

  if (WebSocketServer) {
    const wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req, socket, head) => {
      if (!isResponsesWsUpgrade(req)) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        log("info", "ws_client_connected", { path: req.url });
        handleWebSocketConnection(ws, req).catch((err) => {
          log("error", "ws_handler_error", { error: String(err && err.message ? err.message : err) });
          try {
            ws.close(1011, "internal_error");
          } catch {
            // ignore
          }
        });
      });
    });
  } else {
    server.on("upgrade", (_req, socket) => {
      socket.destroy();
    });
  }

  server.listen(port, hostname, () => {
    log("info", "server_listening", { hostname, port, wsEnabled: !!WebSocketServer });
  });
}

main().catch((err) => {
  log("error", "server_bootstrap_failed", { error: String(err && err.stack ? err.stack : err) });
  process.exit(1);
});
