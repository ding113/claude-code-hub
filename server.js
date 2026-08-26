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
const MAX_PENDING_OUTBOUND_BYTES = 1024 * 1024; // 1 MiB per client WebSocket
// Internal HTTP responses ultimately become one outbound WS frame per event.
// Bound aggregation at the same layer instead of first materializing a body
// that safeSend can never accept.
const MAX_INTERNAL_RESPONSE_BODY_BYTES = MAX_PENDING_OUTBOUND_BYTES;
const MAX_INTERNAL_SSE_EVENT_CHARACTERS = MAX_PENDING_OUTBOUND_BYTES;
const REQUEST_BODY_DRAIN_TIMEOUT_MS = 30_000;
const OUTBOUND_SEND_TIMEOUT_MS = 30_000;

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

const outboundSendStates = new WeakMap();

function invalidateOutboundSends(ws, options = {}) {
  const state = outboundSendStates.get(ws);
  if (!state) return;
  state.active = false;
  state.generation += 1;
  if (state.callbackDeadlineId) clearTimeout(state.callbackDeadlineId);
  state.callbackDeadlineId = null;
  state.pending.length = 0;
  state.pendingBytes = 0;
  state.inFlight = false;
  if (options.destroyResponses) {
    for (const response of state.pressuredResponses) {
      if (!response.destroyed) response.destroy();
    }
  }
  state.pressuredResponses.clear();
  outboundSendStates.delete(ws);
}

function failOutboundSends(ws, state, failure) {
  if (!state.active) return;
  log("warn", "ws_send_failed", {
    reason: failure.reason,
    error: failure.error ? String(failure.error) : undefined,
  });
  invalidateOutboundSends(ws, { destroyResponses: true });
  if (failure.onFailure) {
    failure.onFailure(failure.reason);
    return;
  }
  try {
    ws.close(1011, failure.reason);
  } catch (err) {
    log("warn", "ws_client_close_failed", { error: String(err) });
  }
}

function flushOutboundSends(ws, state) {
  if (!state.active || state.inFlight) return;
  const next = state.pending.shift();
  if (!next) {
    for (const response of state.pressuredResponses) response.resume();
    state.pressuredResponses.clear();
    return;
  }
  if (ws.readyState !== 1 /* OPEN */) {
    failOutboundSends(ws, state, {
      reason: "outbound_socket_closed",
      onFailure: next.onFailure,
    });
    return;
  }

  state.inFlight = true;
  const generation = state.generation;
  state.callbackDeadlineId = setTimeout(() => {
    failOutboundSends(ws, state, {
      reason: "outbound_send_timeout",
      onFailure: next.onFailure,
    });
  }, OUTBOUND_SEND_TIMEOUT_MS);
  try {
    ws.send(next.payload, (err) => {
      if (!state.active || state.generation !== generation) return;
      if (state.callbackDeadlineId) clearTimeout(state.callbackDeadlineId);
      state.callbackDeadlineId = null;
      state.inFlight = false;
      state.pendingBytes -= next.bytes;
      if (err) {
        failOutboundSends(ws, state, {
          reason: "outbound_send_error",
          error: err,
          onFailure: next.onFailure,
        });
        return;
      }
      next.onSuccess?.();
      flushOutboundSends(ws, state);
    });
  } catch (err) {
    failOutboundSends(ws, state, {
      reason: "outbound_send_error",
      error: err,
      onFailure: next.onFailure,
    });
  }
}

function safeSend(ws, data, options = {}) {
  if (ws.readyState !== 1 /* OPEN */) {
    options.onFailure?.("outbound_socket_closed");
    return false;
  }
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  const bytes = Buffer.byteLength(payload, "utf8");
  let state = outboundSendStates.get(ws);
  if (!state) {
    state = {
      active: true,
      generation: 0,
      inFlight: false,
      callbackDeadlineId: null,
      pending: [],
      pendingBytes: 0,
      pressuredResponses: new Set(),
    };
    outboundSendStates.set(ws, state);
  }
  if (options.response) {
    options.response.pause();
    state.pressuredResponses.add(options.response);
  }
  if (!state.active || state.pendingBytes + bytes > MAX_PENDING_OUTBOUND_BYTES) {
    failOutboundSends(ws, state, {
      reason: "outbound_backpressure",
      onFailure: options.onFailure,
    });
    return false;
  }

  state.pending.push({
    payload,
    bytes,
    onSuccess: options.onSuccess,
    onFailure: options.onFailure,
  });
  state.pendingBytes += bytes;
  flushOutboundSends(ws, state);
  return true;
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
  let closing = false;
  let turnSequence = 0;
  // Track the in-flight internal HTTP ClientRequest so we can abort it when
  // the client WebSocket disconnects mid-stream — otherwise the SSE consumer
  // (and provider concurrency / breaker counters) keep running for minutes.
  let currentInternalReq = null;
  let currentInternalRes = null;
  let currentTurnSettle = null;

  const abortCurrentInternalReq = () => {
    const reqToDestroy = currentInternalReq;
    currentInternalReq = null;
    try {
      if (reqToDestroy && !reqToDestroy.destroyed) {
        reqToDestroy.destroy();
      }
    } catch {
      // ignore
    }
    const resToDestroy = currentInternalRes;
    currentInternalRes = null;
    try {
      if (resToDestroy && !resToDestroy.destroyed) resToDestroy.destroy();
    } catch {
      currentInternalRes = null;
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
    currentTurnSettle?.();
    currentTurnSettle = null;
    abortCurrentInternalReq();
    dropPendingFrames();
    invalidateOutboundSends(ws);
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
    currentTurnSettle?.();
    currentTurnSettle = null;
    abortCurrentInternalReq();
    dropPendingFrames();
    invalidateOutboundSends(ws);
    cleanupUpstreamWsSession();
    log("info", "ws_client_close_initiated", { code, reason });
    try {
      ws.close(code, reason);
    } catch (err) {
      log("warn", "ws_client_close_failed", { error: String(err) });
    }
  };
  const sendErrorAndClose = (error, close) => {
    if (closed || closing) return;
    closing = true;
    abortCurrentInternalReq();
    dropPendingFrames();
    const finish = () => requestClose(close.code, close.reason);
    safeSend(ws, { type: "error", error }, { onSuccess: finish, onFailure: finish });
  };

  ws.on("close", finalize);
  ws.on("error", (err) => {
    log("warn", "ws_client_error", {
      error: String(err && err.message ? err.message : err),
    });
    finalize();
  });

  const processFrame = async (queuedFrame) => {
    if (closed || closing) return;
    // drain() 会在整个上游生成期间等待本 Promise。立即清空队列项里的大字符串，
    // 避免同一请求同时被 drain 局部变量和解析后的请求对象重复保留。
    let raw = queuedFrame.text;
    queuedFrame.text = "";
    const turnId = ++turnSequence;
    let turnActive = true;
    let turnReq = null;
    let turnRes = null;
    let turnSettle = null;
    const destroyLateResource = (resource) => {
      try {
        if (resource && !resource.destroyed) resource.destroy();
      } catch {
        // ignore late transport cleanup errors
      }
    };
    const registerTurnResource = (clientReq, clientRes, settleTurn) => {
      if (closed || closing || !turnActive) {
        destroyLateResource(clientReq);
        destroyLateResource(clientRes);
        return false;
      }
      turnReq = clientReq;
      turnRes = clientRes || turnRes;
      currentInternalReq = clientReq;
      if (clientRes) currentInternalRes = clientRes;
      if (typeof settleTurn === "function") {
        turnSettle = settleTurn;
        currentTurnSettle = settleTurn;
      }
      return true;
    };

    if (typeof raw !== "string") {
      sendErrorAndClose(
        { code: "invalid_frame_type", message: "Only text WebSocket frames are supported" },
        { code: 1003, reason: "binary_not_supported" }
      );
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

    delete frame.type;
    let body = frame;
    // body.model wins over query; only fill from query when body lacks a model
    // (LiteLLM/other compat). Drop transport-only fields.
    if (queryModel && (body.model === undefined || body.model === null || body.model === "")) {
      body.model = queryModel;
    }

    log("info", "ws_request_started", {
      model: typeof body.model === "string" ? body.model : null,
      payloadBytes: queuedFrame.bytes,
      hasPreviousResponseId: typeof body.previous_response_id === "string",
    });

    // forwardToInternalHttp 会在返回 Promise 前同步完成 JSON 序列化。随后便可
    // 释放原始 WS 文本和解析对象，不能让几十 MiB 的请求跟随整段响应存活。
    const forwarding = forwardToInternalHttp(
      ws,
      req,
      body,
      responsesWsSessionId,
      registerTurnResource,
      requestClose
    );
    raw = "";
    frame = null;
    body = null;

    try {
      await forwarding;
    } finally {
      turnActive = false;
      if (currentInternalReq === turnReq) currentInternalReq = null;
      if (currentInternalRes === turnRes) currentInternalRes = null;
      if (currentTurnSettle === turnSettle) currentTurnSettle = null;
      log("debug", "ws_turn_resources_released", { turnId });
    }
  };

  const drain = async () => {
    if (inFlight) return;
    const next = pending.shift();
    if (next === undefined) return;
    pendingBytes -= next.bytes;
    if (pendingBytes < 0) pendingBytes = 0;
    inFlight = true;
    try {
      await processFrame(next);
    } finally {
      inFlight = false;
      if (pending.length > 0 && !closed && !closing) {
        void drain().catch((err) => {
          log("error", "ws_drain_failed", {
            error: String(err && err.message ? err.message : err),
          });
          sendErrorAndClose(
            { code: "internal_error", message: "Failed to process queued request" },
            { code: 1011, reason: "internal_error" }
          );
        });
      }
    }
  };

  ws.on("message", (data, isBinary) => {
    if (closed || closing) return;
    if (isBinary) {
      sendErrorAndClose(
        { code: "invalid_frame_type", message: "Only text WebSocket frames are supported" },
        { code: 1003, reason: "binary_not_supported" }
      );
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
      sendErrorAndClose(
        { code: "too_many_requests", message: "Pending frame limit exceeded" },
        { code: 1008, reason: "too_many_requests" }
      );
      return;
    }
    pending.push({ text, bytes: size });
    pendingBytes += size;
    void drain().catch((err) => {
      log("error", "ws_drain_failed", {
        error: String(err && err.message ? err.message : err),
      });
      sendErrorAndClose(
        { code: "internal_error", message: "Failed to process request" },
        { code: 1011, reason: "internal_error" }
      );
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
  let bodyForHttp = { ...body, stream: true };
  body = null;
  delete bodyForHttp.background;

  let payload = Buffer.from(JSON.stringify(bodyForHttp), "utf8");
  bodyForHttp = null;
  internalHeaders["content-length"] = String(payload.length);

  await new Promise((resolve) => {
    let cleanupRequestBody = () => {};
    let turnFinished = false;
    const forceSettleTurn = () => {
      if (turnFinished) return false;
      turnFinished = true;
      cleanupRequestBody();
      resolve();
      return true;
    };
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
        let responseBodyEnded = false;
        let terminalSendAcknowledged = false;
        let terminalFailureQueued = false;
        const settleResponse = () => {
          if (responseSettled) return false;
          if (!responseBodyEnded || !terminalSendAcknowledged) return false;
          responseSettled = true;
          turnFinished = true;
          cleanupRequestBody();
          resolve();
          return true;
        };
        const acknowledgeTerminalSend = () => {
          terminalSendAcknowledged = true;
          settleResponse();
        };
        const forceSettleResponse = () => {
          if (responseSettled) return false;
          responseSettled = true;
          return forceSettleTurn();
        };
        if (typeof registerInternalReq === "function") {
          const accepted = registerInternalReq(req, res, forceSettleResponse);
          if (accepted === false) {
            forceSettleResponse();
            return;
          }
        }
        const settleAndClose = (reason) => {
          initiateClose(1011, reason);
          forceSettleResponse();
        };
        const sendFatalError = (code, message, closeReason) => {
          if (responseSettled || terminalFailureQueued) return false;
          terminalFailureQueued = true;
          const sent = safeSend(
            ws,
            { type: "error", error: { code, message } },
            {
              response: res,
              onSuccess: () => settleAndClose(closeReason),
              onFailure: settleAndClose,
            }
          );
          if (!sent) settleAndClose(closeReason);
          return sent;
        };

        if (!isSse) {
          // Upstream returned non-stream JSON (e.g. error response). Collect
          // and emit as a single terminal event.
          const chunks = [];
          let responseBytes = 0;
          res.on("data", (chunk) => {
            if (responseSettled || terminalFailureQueued) return;
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            if (responseBytes + bytes.byteLength > MAX_INTERNAL_RESPONSE_BODY_BYTES) {
              chunks.length = 0;
              sendFatalError(
                "internal_response_too_large",
                "Internal JSON response exceeded the WebSocket response limit",
                "internal_response_too_large"
              );
              if (!res.destroyed) res.destroy();
              return;
            }
            responseBytes += bytes.byteLength;
            chunks.push(bytes);
          });
          res.on("end", () => {
            if (responseSettled || terminalFailureQueued) return;
            responseBodyEnded = true;
            const text = Buffer.concat(chunks).toString("utf8");
            let parsed;
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = { raw: text };
            }
            const isHttpError = !!(res.statusCode && res.statusCode >= 400);
            if (isHttpError) {
              safeSend(
                ws,
                {
                  type: "error",
                  status: res.statusCode,
                  error:
                    typeof parsed === "object" && parsed && parsed.error
                      ? parsed.error
                      : { code: `http_${res.statusCode}`, message: text.slice(0, 512) },
                },
                { response: res, onSuccess: acknowledgeTerminalSend, onFailure: settleAndClose }
              );
              log("info", "ws_terminal_event_sent", {
                type: "error",
                source: "json",
                status: res.statusCode,
              });
            } else {
              safeSend(
                ws,
                { type: "response.completed", response: parsed },
                { response: res, onSuccess: acknowledgeTerminalSend, onFailure: settleAndClose }
              );
              log("info", "ws_terminal_event_sent", { type: "response.completed", source: "json" });
            }
          });
          res.on("error", (err) => {
            if (responseSettled || terminalFailureQueued) return;
            sendFatalError(
              "internal_response_error",
              String(err && err.message ? err.message : err),
              "internal_response_error"
            );
          });
          res.on("close", () => {
            if (responseSettled || terminalFailureQueued) return;
            if (responseBodyEnded || res.complete) {
              responseBodyEnded = true;
              settleResponse();
              return;
            }
            sendFatalError(
              "internal_response_closed",
              "Internal response closed before a complete JSON body was received",
              "internal_response_closed"
            );
          });
          return;
        }

        // SSE path: decode `data:` events and emit each as a WS JSON frame.
        // Accept both LF (`\n\n`) and CRLF (`\r\n\r\n`) event separators since
        // upstreams in the wild emit either form.
        let buffer = "";
        let delimiterScanOffset = 0;
        let sawTerminal = false;
        let terminalEventType = null;
        const EVENT_DELIMITER = /\r?\n\r?\n/g;
        const failIfUnsettled = (code, message, closeReason) => {
          if (responseSettled) return;
          if (sawTerminal) {
            // A terminal protocol event is authoritative. Once the internal
            // transport closes, wait only for its WS send acknowledgement;
            // otherwise this persistent connection would retain inFlight
            // ownership forever when close/error arrives before `end`.
            responseBodyEnded = true;
            settleResponse();
            return;
          }
          sendFatalError(code, message, closeReason);
        };

        const failOversizedSseEvent = () => {
          buffer = "";
          delimiterScanOffset = 0;
          sendFatalError(
            "internal_sse_event_too_large",
            "Internal SSE event exceeded the WebSocket response limit",
            "internal_sse_event_too_large"
          );
          if (!res.destroyed) res.destroy();
        };
        const processEvent = (eventChunk) => {
            const lines = eventChunk.split(/\r?\n/);
            const dataLines = [];
            for (const line of lines) {
              if (line.startsWith("data:")) {
                // SSE removes at most one optional space after the colon.
                // Payload whitespace is data and must otherwise remain intact.
                const data = line.slice(5);
                dataLines.push(data.startsWith(" ") ? data.slice(1) : data);
              }
            }
            if (dataLines.length === 0) return;
            const dataText = dataLines.join("\n");
            if (dataText.trim() === "[DONE]") {
              if (!sawTerminal) {
                // Some upstreams close SSE with [DONE] without a preceding
                // response.completed. Synthesize one so the client sees a
                // clean terminal event.
                safeSend(ws, { type: "response.completed", response: null }, {
                  response: res,
                  onSuccess: acknowledgeTerminalSend,
                  onFailure: settleAndClose,
                });
                sawTerminal = true;
              }
              return;
            }
            let event;
            try {
              event = JSON.parse(dataText);
            } catch {
              // Not JSON; forward as raw string event.
              safeSend(ws, { type: "response.output_text.delta", delta: dataText }, {
                response: res,
                onFailure: settleAndClose,
              });
              return;
            }
            const isTerminalEvent =
              event && typeof event.type === "string" && TERMINAL_EVENT_TYPES.has(event.type);
            safeSend(ws, event, {
              response: res,
              onSuccess: isTerminalEvent ? acknowledgeTerminalSend : undefined,
              onFailure: settleAndClose,
            });
            if (isTerminalEvent) {
              sawTerminal = true;
              terminalEventType = event.type;
              log("info", "ws_terminal_event_sent", { type: event.type, source: "sse" });
            }
        };

        const flushEvents = () => {
          // buffer 通常只保留一个未完成事件。从上次尾部附近继续扫描，避免一字节
          // HTTP chunk 每次都重扫持续增长的事件；保留三个字符以覆盖跨块 CRLF 分隔符。
          EVENT_DELIMITER.lastIndex = delimiterScanOffset;
          let eventStart = 0;
          let delimiter;
          while ((delimiter = EVENT_DELIMITER.exec(buffer)) !== null) {
            if (delimiter.index - eventStart > MAX_INTERNAL_SSE_EVENT_CHARACTERS) {
              failOversizedSseEvent();
              return false;
            }
            processEvent(buffer.slice(eventStart, delimiter.index));
            eventStart = EVENT_DELIMITER.lastIndex;
            if (responseSettled || terminalFailureQueued) break;
          }
          if (eventStart > 0) buffer = buffer.slice(eventStart);
          EVENT_DELIMITER.lastIndex = 0;
          delimiterScanOffset = Math.max(0, buffer.length - 3);
          if (buffer.length > MAX_INTERNAL_SSE_EVENT_CHARACTERS) {
            failOversizedSseEvent();
            return false;
          }
          return true;
        };

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          if (responseSettled || terminalFailureQueued) return;
          buffer += chunk;
          flushEvents();
        });
        res.on("end", () => {
          if (responseSettled || terminalFailureQueued) return;
          responseBodyEnded = true;
          // Flush any remaining buffered event
          if (buffer.length > 0) {
            buffer += "\n\n";
            if (!flushEvents()) return;
          }
          if (!sawTerminal) {
            sendFatalError(
              "stream_ended_without_terminal",
              "Upstream stream ended before emitting a terminal response event",
              "stream_ended_without_terminal"
            );
          } else {
            // OpenAI Responses WebSocket mode is persistent: after a terminal
            // event, the same client connection can send the next
            // response.create. Do not close here; only fatal transport/protocol
            // errors initiate a close handshake.
            log("info", "ws_turn_completed", { terminalEventType });
            settleResponse();
          }
          if (!sawTerminal) return;
        });
        res.on("error", (err) => {
          failIfUnsettled(
            "internal_response_error",
            String(err && err.message ? err.message : err),
            "internal_response_error"
          );
        });
        res.on("close", () => {
          if (responseBodyEnded || res.complete) {
            responseBodyEnded = true;
            settleResponse();
            return;
          }
          failIfUnsettled(
            "internal_response_closed",
            "Internal response closed before emitting a terminal response event",
            "internal_response_closed"
          );
        });
      }
    );

    if (typeof registerInternalReq === "function") {
      const accepted = registerInternalReq(req, null, forceSettleTurn);
      if (accepted === false) {
        if (!req.destroyed) req.destroy();
        forceSettleTurn();
        return;
      }
    }

    const handleRequestError = (err) => {
      if (turnFinished) {
        return;
      }
      turnFinished = true;
      cleanupRequestBody();
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        initiateClose(1011, "internal_request_error");
        resolve();
      };
      const sent = safeSend(
        ws,
        {
          type: "error",
          error: {
            code: "internal_request_error",
            message: String(err && err.message ? err.message : err),
          },
        },
        { onSuccess: finish, onFailure: finish }
      );
      if (!sent) finish();
    };
    req.on("error", handleRequestError);
    let requestEnded = false;
    let requestBodyFinished = false;
    let requestBodyDeadlineId = null;
    const clearRequestBodyListeners = () => {
      req.removeListener("drain", finishRequestBody);
      req.removeListener("close", abandonRequestBody);
      req.removeListener("error", abandonRequestBody);
      req.removeListener("abort", abandonRequestBody);
      if (requestBodyDeadlineId) {
        clearTimeout(requestBodyDeadlineId);
        requestBodyDeadlineId = null;
      }
    };
    const endRequestOnce = () => {
      if (requestEnded) return;
      requestEnded = true;
      req.end();
    };
    const finishRequestBody = () => {
      if (requestBodyFinished) return;
      requestBodyFinished = true;
      clearRequestBodyListeners();
      endRequestOnce();
    };
    const abandonRequestBody = () => {
      if (requestBodyFinished) return;
      requestBodyFinished = true;
      clearRequestBodyListeners();
      if (!turnFinished) {
        turnFinished = true;
        const finish = () => {
          initiateClose(1011, "internal_request_body_closed");
          resolve();
        };
        const sent = safeSend(
          ws,
          {
            type: "error",
            error: {
              code: "internal_request_body_closed",
              message: "Internal request body closed before it was fully written",
            },
          },
          { onSuccess: finish, onFailure: finish }
        );
        if (!sent) finish();
        return;
      }
      resolve();
    };
    const expireRequestBody = () => {
      if (requestBodyFinished) return;
      requestBodyFinished = true;
      clearRequestBodyListeners();
      turnFinished = true;
      if (!req.destroyed) req.destroy();
      const finish = () => {
        initiateClose(1011, "internal_request_drain_timeout");
        resolve();
      };
      const sent = safeSend(
        ws,
        {
          type: "error",
          error: {
            code: "internal_request_drain_timeout",
            message: "Internal request body remained backpressured past its deadline",
          },
        },
        { onSuccess: finish, onFailure: finish }
      );
      if (!sent) finish();
    };
    cleanupRequestBody = () => {
      if (requestBodyFinished) return;
      requestBodyFinished = true;
      clearRequestBodyListeners();
      if (!requestEnded && !req.destroyed) req.destroy();
    };
    const requestBodyAccepted = req.write(payload);
    // ClientRequest 已同步取得 Buffer 所有权；本地不应在等待整段响应期间
    // 再保留一份大请求体。即使 write() 返回 false，Node 的写队列也持有它。
    payload = null;
    if (requestBodyAccepted) {
      finishRequestBody();
    } else {
      req.once("drain", finishRequestBody);
      req.once("close", abandonRequestBody);
      req.once("error", abandonRequestBody);
      req.once("abort", abandonRequestBody);
      requestBodyDeadlineId = setTimeout(expireRequestBody, REQUEST_BODY_DRAIN_TIMEOUT_MS);
    }
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
  MAX_PENDING_OUTBOUND_BYTES,
};

if (require.main === module) {
  main().catch((err) => {
    log("error", "server_bootstrap_failed", {
      error: String(err && err.stack ? err.stack : err),
    });
    process.exit(1);
  });
}
