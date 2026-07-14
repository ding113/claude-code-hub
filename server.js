// Custom Node.js server for claude-code-hub.
//
// Purpose: add WebSocket upgrade support on /v1/responses so clients that speak
// the OpenAI Responses WebSocket protocol (text JSON frames with
// type=response.create) can proxy through CCH. All other HTTP traffic is
// delegated to the Next.js App Router handler unchanged.
//
// Architecture: this server is a thin tunnel. For each client WebSocket frame,
// we build an equivalent HTTP POST against the same app's /v1/responses
// endpoint (with x-cch-client-transport and x-cch-responses-ws-session headers)
// so that auth, provider selection, guard pipeline, forwarder, circuit
// breakers, observability, and all existing TypeScript business logic run
// exactly once. Upstream WebSocket attempts and per-client upstream reuse live
// inside that TypeScript pipeline (forwarder), not here.
//
// Compatibility:
// - Non-WebSocket clients: unaffected. HTTP still flows through Next.js.
// - Non-Codex providers: the forwarder never attempts upstream WS; client WS
//   is still accepted and tunneled through HTTP SSE.
// - Setting disabled: client WS handshake still succeeds (so clients don't
//   break), but every frame is tunneled over HTTP with no upstream-WS attempt.

"use strict";

const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { parse } = require("node:url");

function isNextDevMode(nodeEnv) {
  return nodeEnv !== "production";
}

// 保留既有本地语义：只有显式 production 才服务已构建产物；Docker/K8s
// 镜像会显式设置 NODE_ENV=production 和 PORT=3000。
const dev = isNextDevMode(process.env.NODE_ENV);
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = parseInt(process.env.PORT || (dev ? "13500" : "3000"), 10);

// Loopback target for the in-process WS->HTTP tunnel. When the public bind
// hostname is a wildcard (0.0.0.0 / ::), tunnel via 127.0.0.1; otherwise use
// the configured hostname so we still hit the local listener even when bound
// to a specific interface.
const INTERNAL_TUNNEL_HOST =
  hostname === "0.0.0.0" || hostname === "::" || hostname === "*" ? "127.0.0.1" : hostname;

const WS_PATH = "/v1/responses";
const CLIENT_TRANSPORT_HEADER = "x-cch-client-transport";
const WS_FORWARD_FLAG_HEADER = "x-cch-responses-ws-forward";
const WS_SESSION_HEADER = "x-cch-responses-ws-session";
const INTERNAL_SECRET_HEADER = "x-cch-internal-secret";
const INTERNAL_SECRET_ENV = "CCH_RESPONSES_WS_INTERNAL_SECRET";

// Header names a client must NEVER be allowed to set on inbound traffic.
// Anything starting with "x-cch-" is reserved for internal markers; the WS
// edge strips the entire prefix from inbound requests so an attacker cannot
// pre-set the WS-tunnel marker headers when they connect.
const RESERVED_INTERNAL_HEADER_PREFIX = "x-cch-";

// Per-WebSocket-connection guardrails: cap the queue depth and total queued
// bytes to make a misbehaving / malicious client a bounded-memory event.
const MAX_PENDING_FRAMES = 64;
const MAX_PENDING_BYTES = 64 * 1024 * 1024; // 64 MiB across all queued frames

// Maximum payload size for any single inbound WS frame. The default `ws`
// limit is 100 MiB. We pick 32 MiB to accommodate Codex requests that ship
// large conversation history alongside the prompt — a tighter cap caused the
// `ws` library to socket.destroy() (TCP RST) without sending a close frame,
// surfacing on the client as "Connection reset without closing handshake".
const WS_MAX_PAYLOAD_BYTES = 32 * 1024 * 1024; // 32 MiB per frame

const TERMINAL_EVENT_TYPES = new Set([
  "response.completed",
  "response.failed",
  "response.incomplete",
  "error",
]);

// Query-string keys we explicitly never want to log on the connection event.
// Anything outside this list is masked to "***".
const ALLOWED_LOGGED_QUERY_KEYS = new Set(["model"]);

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

function sanitizedRequestPath(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return "/";
  }
  try {
    const parsed = new URL(rawUrl, "http://localhost");
    const masked = new URLSearchParams();
    parsed.searchParams.forEach((value, key) => {
      masked.append(key, ALLOWED_LOGGED_QUERY_KEYS.has(key.toLowerCase()) ? value : "***");
    });
    const qs = masked.toString();
    return qs.length > 0 ? `${parsed.pathname}?${qs}` : parsed.pathname;
  } catch {
    return "/";
  }
}

async function handleWebSocketConnection(ws, req) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const queryModel = url.searchParams.get("model");
  const responsesWsSessionId = randomUUID();
  let inFlight = false;
  const pending = [];
  let pendingBytes = 0;
  let closed = false;
  // Track the in-flight internal HTTP ClientRequest so we can abort it when
  // the client WebSocket disconnects mid-stream — otherwise the SSE consumer
  // (and provider concurrency / breaker counters) keep running for minutes.
  let currentInternalReq = null;

  const abortCurrentInternalReq = () => {
    if (!currentInternalReq) return;
    const reqToDestroy = currentInternalReq;
    currentInternalReq = null;
    try {
      if (!reqToDestroy.destroyed) {
        reqToDestroy.destroy();
      }
    } catch {
      // ignore
    }
  };

  const cleanupUpstreamWsSession = () => {
    const cleanup = globalThis.__cchCleanupResponsesWsSession;
    if (typeof cleanup !== "function") return;
    try {
      cleanup(responsesWsSessionId);
    } catch (err) {
      log("warn", "ws_upstream_session_cleanup_failed", {
        error: String(err && err.message ? err.message : err),
      });
    }
  };

  const dropPendingFrames = () => {
    if (pending.length > 0) {
      log("warn", "ws_pending_dropped_on_close", {
        droppedFrames: pending.length,
        droppedBytes: pendingBytes,
      });
    }
    pending.length = 0;
    pendingBytes = 0;
  };

  const finalize = () => {
    if (closed) return;
    closed = true;
    abortCurrentInternalReq();
    dropPendingFrames();
    cleanupUpstreamWsSession();
  };

  // Synchronously mark the connection closed so any pipelined frame in
  // `pending` is dropped *before* drain() can dispatch another upstream
  // request. Without this the gap between ws.close() and the async
  // ws.on("close") event is wide enough for `drain()` to pop the next frame
  // and run `forwardToInternalHttp` against the upstream — work the client
  // can never receive (safeSend would fail) but the provider would still bill.
  const requestClose = (code, reason) => {
    if (closed) {
      abortCurrentInternalReq();
      dropPendingFrames();
      return;
    }
    if (ws && ws.readyState >= 2) {
      // Already closing/closed; just make sure local state matches.
      finalize();
      return;
    }
    closed = true;
    abortCurrentInternalReq();
    dropPendingFrames();
    cleanupUpstreamWsSession();
    log("info", "ws_client_close_initiated", { code, reason });
    try {
      ws.close(code, reason);
    } catch (err) {
      log("warn", "ws_client_close_failed", { error: String(err) });
    }
  };

  ws.on("close", finalize);
  ws.on("error", (err) => {
    log("warn", "ws_client_error", {
      error: String(err && err.message ? err.message : err),
    });
    finalize();
  });

  const processFrame = async (raw) => {
    if (closed) return;

    if (typeof raw !== "string") {
      emitErrorEvent(ws, "invalid_frame_type", "Only text WebSocket frames are supported");
      requestClose(1003, "binary_not_supported");
      return;
    }

    let frame;
    try {
      frame = JSON.parse(raw);
    } catch (err) {
      emitErrorEvent(
        ws,
        "invalid_json",
        `Invalid JSON frame: ${err && err.message ? err.message : "parse error"}`
      );
      return;
    }

    if (!frame || typeof frame !== "object") {
      emitErrorEvent(ws, "invalid_frame", "Frame must be a JSON object");
      return;
    }

    if (frame.type !== "response.create") {
      emitErrorEvent(
        ws,
        "unsupported_event_type",
        `Only type=response.create is supported; received: ${frame.type ?? "(missing)"}`
      );
      return;
    }

    const { type: _type, ...rawBody } = frame;
    const body = { ...rawBody };
    // body.model wins over query; only fill from query when body lacks a model
    // (LiteLLM/other compat). Drop transport-only fields.
    if (queryModel && (body.model === undefined || body.model === null || body.model === "")) {
      body.model = queryModel;
    }

    log("info", "ws_request_started", {
      model: typeof body.model === "string" ? body.model : null,
      payloadBytes: Buffer.byteLength(raw, "utf8"),
      hasPreviousResponseId: typeof body.previous_response_id === "string",
    });

    await forwardToInternalHttp(
      ws,
      req,
      body,
      responsesWsSessionId,
      (clientReq) => {
        currentInternalReq = clientReq;
      },
      requestClose
    );
    if (!closed) {
      currentInternalReq = null;
    }
  };

  const drain = async () => {
    if (inFlight) return;
    const next = pending.shift();
    if (next === undefined) return;
    pendingBytes -= Buffer.byteLength(next, "utf8");
    if (pendingBytes < 0) pendingBytes = 0;
    inFlight = true;
    try {
      await processFrame(next);
    } finally {
      inFlight = false;
      if (pending.length > 0 && !closed) {
        void drain().catch((err) => {
          log("error", "ws_drain_failed", {
            error: String(err && err.message ? err.message : err),
          });
          emitErrorEvent(ws, "internal_error", "Failed to process queued request");
          requestClose(1011, "internal_error");
        });
      }
    }
  };

  ws.on("message", (data, isBinary) => {
    if (closed) return;
    if (isBinary) {
      emitErrorEvent(ws, "invalid_frame_type", "Only text WebSocket frames are supported");
      requestClose(1003, "binary_not_supported");
      return;
    }
    const text = data.toString("utf8");
    const size = Buffer.byteLength(text, "utf8");
    if (pending.length >= MAX_PENDING_FRAMES || pendingBytes + size > MAX_PENDING_BYTES) {
      log("warn", "ws_pending_overflow", {
        pendingFrames: pending.length,
        pendingBytes,
        attemptedFrameSize: size,
      });
      emitErrorEvent(ws, "too_many_requests", "Pending frame limit exceeded");
      requestClose(1008, "too_many_requests");
      return;
    }
    pending.push(text);
    pendingBytes += size;
    void drain().catch((err) => {
      log("error", "ws_drain_failed", {
        error: String(err && err.message ? err.message : err),
      });
      emitErrorEvent(ws, "internal_error", "Failed to process request");
      requestClose(1011, "internal_error");
    });
  });
}

async function forwardToInternalHttp(
  ws,
  originalReq,
  body,
  responsesWsSessionId,
  registerInternalReq,
  requestClose
) {
  // requestClose(code, reason) initiates the WebSocket closing handshake AND
  // synchronously marks the client connection closed so the caller's pending
  // queue stops dispatching follow-up frames against the upstream. Tests that
  // exercise this function in isolation can pass a no-op fallback.
  const initiateClose =
    typeof requestClose === "function"
      ? requestClose
      : (code, reason) => {
          log("info", "ws_client_close_initiated", { code, reason });
          try {
            ws.close(code, reason);
          } catch (err) {
            log("warn", "ws_client_close_failed", { error: String(err) });
          }
        };
  const internalHeaders = {};
  for (const [k, v] of Object.entries(originalReq.headers)) {
    const lower = k.toLowerCase();
    // Strip hop-by-hop / WS-specific transport headers.
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
    // Strip any `x-cch-*` header the client may have set: those names are
    // reserved for internal markers that we'll attach below. Without this an
    // external attacker could try to forge `x-cch-internal-secret` /
    // `x-cch-responses-ws-forward` and bypass the loopback-only check.
    if (lower.startsWith(RESERVED_INTERNAL_HEADER_PREFIX)) {
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
  if (typeof responsesWsSessionId === "string" && responsesWsSessionId.length > 0) {
    internalHeaders[WS_SESSION_HEADER] = responsesWsSessionId;
  }
  // Per-process loopback secret. Read from process.env so it can be picked
  // up by any code path that needs to verify (the TS forwarder reads the
  // same env var via `internal-secret.ts`). The secret is generated at
  // startup if no operator value is preset.
  const internalSecret = process.env[INTERNAL_SECRET_ENV];
  if (internalSecret) {
    internalHeaders[INTERNAL_SECRET_HEADER] = internalSecret;
  }

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
        hostname: INTERNAL_TUNNEL_HOST,
        port,
        path: "/v1/responses",
        headers: internalHeaders,
      },
      (res) => {
        const contentType = (res.headers["content-type"] || "").toLowerCase();
        const isSse = contentType.includes("text/event-stream");
        let responseSettled = false;
        const settleResponse = () => {
          if (responseSettled) return false;
          responseSettled = true;
          resolve();
          return true;
        };

        if (!isSse) {
          // Upstream returned non-stream JSON (e.g. error response). Collect
          // and emit as a single terminal event.
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            if (responseSettled) return;
            const text = Buffer.concat(chunks).toString("utf8");
            let parsed;
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = { raw: text };
            }
            const isHttpError = !!(res.statusCode && res.statusCode >= 400);
            if (isHttpError) {
              safeSend(ws, {
                type: "error",
                status: res.statusCode,
                error:
                  typeof parsed === "object" && parsed && parsed.error
                    ? parsed.error
                    : { code: `http_${res.statusCode}`, message: text.slice(0, 512) },
              });
              log("info", "ws_terminal_event_sent", {
                type: "error",
                source: "json",
                status: res.statusCode,
              });
            } else {
              safeSend(ws, {
                type: "response.completed",
                response: parsed,
              });
              log("info", "ws_terminal_event_sent", { type: "response.completed", source: "json" });
            }
            settleResponse();
          });
          res.on("error", (err) => {
            if (responseSettled) return;
            emitErrorEvent(
              ws,
              "internal_response_error",
              String(err && err.message ? err.message : err)
            );
            initiateClose(1011, "internal_response_error");
            settleResponse();
          });
          res.on("close", () => {
            if (responseSettled) return;
            emitErrorEvent(
              ws,
              "internal_response_closed",
              "Internal response closed before a complete JSON body was received"
            );
            initiateClose(1011, "internal_response_closed");
            settleResponse();
          });
          return;
        }

        // SSE path: decode `data:` events and emit each as a WS JSON frame.
        // Accept both LF (`\n\n`) and CRLF (`\r\n\r\n`) event separators since
        // upstreams in the wild emit either form.
        let buffer = "";
        let sawTerminal = false;
        let terminalEventType = null;
        const EVENT_DELIMITER = /\r?\n\r?\n/;
        const failIfUnsettled = (code, message, closeReason) => {
          if (responseSettled) return;
          if (!sawTerminal) {
            emitErrorEvent(ws, code, message);
            initiateClose(1011, closeReason);
          }
          settleResponse();
        };

        const flushEvents = () => {
          const parts = buffer.split(EVENT_DELIMITER);
          // Last part may be a partial event still arriving — keep it buffered.
          buffer = parts.pop() ?? "";
          for (const chunk of parts) {
            const lines = chunk.split(/\r?\n/);
            const dataLines = [];
            for (const line of lines) {
              if (line.startsWith("data:")) {
                // Trim CR / leading whitespace so trailing \r from CRLF lines
                // doesn't end up inside the payload.
                dataLines.push(line.slice(5).trim());
              }
            }
            if (dataLines.length === 0) continue;
            const dataText = dataLines.join("\n");
            if (dataText.trim() === "[DONE]") {
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
              terminalEventType = event.type;
              log("info", "ws_terminal_event_sent", { type: event.type, source: "sse" });
            }
          }
        };

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          if (responseSettled) return;
          buffer += chunk;
          flushEvents();
        });
        res.on("end", () => {
          if (responseSettled) return;
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
            initiateClose(1011, "stream_ended_without_terminal");
          } else {
            // OpenAI Responses WebSocket mode is persistent: after a terminal
            // event, the same client connection can send the next
            // response.create. Do not close here; only fatal transport/protocol
            // errors initiate a close handshake.
            log("info", "ws_turn_completed", { terminalEventType });
          }
          settleResponse();
        });
        res.on("error", (err) => {
          failIfUnsettled(
            "internal_response_error",
            String(err && err.message ? err.message : err),
            "internal_response_error"
          );
        });
        res.on("close", () => {
          failIfUnsettled(
            "internal_response_closed",
            "Internal response closed before emitting a terminal response event",
            "internal_response_closed"
          );
        });
      }
    );

    req.on("error", (err) => {
      // ECONNRESET when we destroy() the request on client disconnect is
      // expected; downgrade to debug to avoid noisy logs in normal traffic.
      const errCode = err && (err.code || err.name);
      const isAbort = errCode === "ECONNRESET" || errCode === "ERR_STREAM_PREMATURE_CLOSE";
      if (!isAbort) {
        emitErrorEvent(
          ws,
          "internal_request_error",
          String(err && err.message ? err.message : err)
        );
        initiateClose(1011, "internal_request_error");
      }
      resolve();
    });

    if (typeof registerInternalReq === "function") {
      registerInternalReq(req);
    }
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
  // Surface the build-time Next config via the env var Next's own standalone
  // template uses. See server-lib/standalone-config.js for the full rationale.
  if (!dev) {
    // eslint-disable-next-line global-require
    const { applyStandaloneNextConfig } = require("./server-lib/standalone-config");
    applyStandaloneNextConfig({ rootDir: __dirname, env: process.env, log });
  }

  // Import Next programmatically. We require it lazily so that the server can
  // still report a clean error if Next is not installed (unlikely but possible
  // in a misconfigured deployment).
  let nextModule;
  try {
    // eslint-disable-next-line global-require
    nextModule = require("next");
  } catch (err) {
    log("error", "next_import_failed", {
      error: String(err && err.message ? err.message : err),
    });
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

  // Initialize the per-process internal secret BEFORE next.prepare() so that
  // any module loaded by Next can read the same value from process.env.
  // Operators may pre-seed the env var; otherwise we generate one. Either
  // way the secret never leaves this process.
  if (!process.env[INTERNAL_SECRET_ENV]) {
    process.env[INTERNAL_SECRET_ENV] = randomUUID();
  }

  const app = nextFactory({ dev, hostname, port });
  const handler = app.getRequestHandler();
  await app.prepare();

  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handler(req, res, parsedUrl);
    } catch (err) {
      log("error", "http_handler_error", {
        error: String(err && err.message ? err.message : err),
      });
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    }
  });

  let wss = null;
  if (WebSocketServer) {
    wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD_BYTES });

    server.on("upgrade", (req, socket, head) => {
      if (!isResponsesWsUpgrade(req)) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        log("info", "ws_client_connected", { path: sanitizedRequestPath(req.url) });
        handleWebSocketConnection(ws, req).catch((err) => {
          log("error", "ws_handler_error", {
            error: String(err && err.message ? err.message : err),
          });
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
    log("info", "server_listening", {
      hostname,
      port,
      internalTunnelHost: INTERNAL_TUNNEL_HOST,
      wsEnabled: !!WebSocketServer,
    });
  });

  registerOrchestratedShutdown(server, wss);
}

// Graceful shutdown orchestration. Lives here (not in instrumentation.ts) because
// only this process owns the `server` handle returned by http.createServer().
//
// Sequence (bounded by SHUTDOWN_HARD_EXIT_MS as the final safety net):
//   1. Mark shutdown flag    -> /api/health/ready returns 503 -> Service drains
//   2. server.close()        -> stop accepting; in-flight HTTP finishes
//   3. wss.close()           -> reject new WS upgrades
//   4. Wait for drain        -> bounded by SHUTDOWN_DRAIN_MS
//   5. runApplicationCleanup -> abort + join tasks, flush writer, close DB pools,
//      then release non-critical resources. SHUTDOWN_CLEANUP_MS is a soft warning;
//      the referenced hard watchdog is the final bound for critical barriers.
//   6. Success logs shutdown_complete and exits 0; cleanup failure exits 1.
function registerOrchestratedShutdown(server, wss) {
  let shuttingDown = false;

  // Positive integer parser: `Number("0") || default` would silently coerce an
  // intentional 0 back to the default. Mirrors the parser in
  // src/lib/langfuse/index.ts so operator overrides behave consistently.
  const parsePosInt = (raw, fallback) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  // Defaults: drain + cleanup = 25s, with a 3s gap before the hard-exit
  // watchdog. Without the gap, when both phases hit their cap the watchdog
  // (registered at T=0) fires at the same instant as `process.exit(0)` and
  // wins by ordering, falsely logging the shutdown as failed.
  const drainMs = parsePosInt(process.env.SHUTDOWN_DRAIN_MS, 15000);
  const cleanupMs = parsePosInt(process.env.SHUTDOWN_CLEANUP_MS, 10000);
  const hardExitMs = parsePosInt(process.env.SHUTDOWN_HARD_EXIT_MS, 28000);

  const orchestratedShutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("info", "shutdown_received", { signal, drainMs, cleanupMs, hardExitMs });

    // Final safety: even if every step below hangs, this referenced timer keeps
    // the process alive until it can terminate with a truthful non-zero status.
    const hardExit = setTimeout(() => {
      log("error", "shutdown_hard_exit_watchdog", { hardExitMs });
      process.exit(1);
    }, hardExitMs);

    // 1. Flip readiness BEFORE closing the listener so probes already in flight
    //    see 503 and the Service starts removing this pod from endpoints.
    const lifecycle = globalThis.__CCH_LIFECYCLE__;
    try {
      lifecycle?.markShuttingDown?.();
    } catch (err) {
      log("warn", "shutdown_mark_failed", { error: String(err && err.message ? err.message : err) });
    }

    // 2 + 3. Stop accepting new connections.
    const closeServer = new Promise((resolve) => {
      try {
        server.close((err) => {
          if (err) {
            log("warn", "shutdown_server_close_error", {
              error: String(err && err.message ? err.message : err),
            });
          }
          resolve();
        });
      } catch (err) {
        log("warn", "shutdown_server_close_threw", {
          error: String(err && err.message ? err.message : err),
        });
        resolve();
      }
    });

    const closeWss = new Promise((resolve) => {
      if (!wss || typeof wss.close !== "function") {
        resolve();
        return;
      }

      try {
        if (wss.close.length === 0) {
          wss.close();
          resolve();
          return;
        }
        wss.close(() => resolve());
      } catch (err) {
        log("warn", "shutdown_wss_close_error", {
          error: String(err && err.message ? err.message : err),
        });
        resolve();
      }
    });
    const closeTransports = Promise.all([closeServer, closeWss]);

    // 4. Bounded drain — HTTP and WebSocket close only settle after every in-flight
    //    connection completes; we cap them so a stuck client can't hold us forever.
    //    Clearing the timer on natural close avoids a misleading
    //    "shutdown_drain_timeout" warning during the subsequent cleanup phase.
    await Promise.race([
      closeTransports,
      new Promise((resolve) => {
        const t = setTimeout(() => {
          log("warn", "shutdown_drain_timeout", { drainMs });
          resolve();
        }, drainMs);
        if (typeof t.unref === "function") t.unref();
        closeTransports.finally(() => clearTimeout(t));
      }),
    ]);

    // 5. Application-level cleanup.
    try {
      if (typeof lifecycle?.runApplicationCleanup === "function") {
        await lifecycle.runApplicationCleanup(signal, { totalTimeoutMs: cleanupMs });
      } else {
        log("warn", "shutdown_cleanup_unavailable", {
          reason: "lifecycle_globals_not_bound",
        });
        process.exit(1);
        return;
      }
    } catch (err) {
      log("error", "shutdown_cleanup_error", {
        error: String(err && err.message ? err.message : err),
      });
      process.exit(1);
      return;
    }

    log("info", "shutdown_complete", { signal });
    clearTimeout(hardExit);
    process.exit(0);
  };

  process.once("SIGTERM", () => void orchestratedShutdown("SIGTERM"));
  process.once("SIGINT", () => void orchestratedShutdown("SIGINT"));
}

// Exposed for tests; not part of the long-lived server entrypoint.
module.exports = {
  sanitizedRequestPath,
  isNextDevMode,
  handleWebSocketConnection,
  forwardToInternalHttp,
  registerOrchestratedShutdown,
  WS_MAX_PAYLOAD_BYTES,
  MAX_PENDING_BYTES,
};

if (require.main === module) {
  main().catch((err) => {
    log("error", "server_bootstrap_failed", {
      error: String(err && err.stack ? err.stack : err),
    });
    process.exit(1);
  });
}
