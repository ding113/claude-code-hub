/**
 * OpenAI Responses WebSocket upstream adapter (Codex providers only).
 *
 * Attempts a WebSocket connection to the upstream's `/v1/responses` endpoint.
 * On success, events received from the upstream WS are re-emitted as SSE
 * frames so that the forwarder's downstream pipeline (fake-200 detection,
 * prompt_cache_key extraction, usage aggregation, finalization) treats the
 * response exactly like an HTTP Responses SSE stream.
 *
 * When the request came from one client WebSocket connection, server.js passes
 * a per-client `x-cch-responses-ws-session` marker. We reuse one upstream
 * WebSocket for that marker so Codex's `store=false` + `previous_response_id`
 * continuation can hit the upstream connection-local cache, matching OpenAI's
 * WebSocket mode semantics.
 */

import { createHash } from "node:crypto";
import type WebSocketType from "ws";
import { logger } from "@/lib/logger";
import type { Provider } from "@/types/provider";
import { RESERVED_INTERNAL_HEADERS } from "./internal-secret";

declare global {
  // server.js is CommonJS and cannot import this TS module directly. The
  // adapter registers a tiny cleanup hook on globalThis so the custom server
  // can close the matching upstream WS as soon as the client WS disconnects.
  // eslint-disable-next-line no-var
  var __cchCleanupResponsesWsSession: ((sessionId: string) => void) | undefined;
}

export interface UpstreamWsOutcome {
  response: Response;
  connected: boolean;
  reused: boolean;
}

export type UpstreamWsFallbackReason =
  | "ws_module_unavailable"
  | "ws_upgrade_rejected"
  | "ws_closed_before_first_event"
  | "ws_error_pre_first_event";

export interface UpstreamWsFailure {
  failed: true;
  reason: UpstreamWsFallbackReason;
  message?: string;
  /**
   * True only for failures that prove the endpoint does not speak the
   * Responses WebSocket protocol (e.g. HTTP 4xx / 501 on the upgrade).
   * Used by the caller to decide whether to cache the endpoint as
   * WS-unsupported. Network-level failures (ECONNREFUSED, ETIMEDOUT,
   * silent upstream, mid-handshake aborts) are NOT cacheable — they may
   * recover on the next request.
   */
  cacheableAsUnsupported: boolean;
}

export type UpstreamWsResult = UpstreamWsOutcome | UpstreamWsFailure;

const TERMINAL_EVENT_TYPES = new Set([
  "response.completed",
  "response.failed",
  "response.incomplete",
  "error",
]);

const HANDSHAKE_TIMEOUT_MS = 10_000;
// `handshakeTimeout` only covers the HTTP -> WS upgrade. Once upgrade
// succeeds, an upstream may still hang without sending any event (bug, dead
// connection, half-open socket). Without a separate first-event timer the
// `await openPromise` below would hang forever and tie up the request slot.
const FIRST_EVENT_TIMEOUT_MS = 20_000;

// Hard limit on one upstream message and on queued bytes between the upstream
// WebSocket and downstream SSE consumer. A message already handed to a waiting
// pull still counts against the single-message bound.
const MAX_BUFFERED_QUEUE_BYTES = 8 * 1024 * 1024; // 8 MiB
// SSE 要为每个物理行补 `data: `。大量换行可让编码后帧远大于原 WS
// 消息，因此实际交给下游的单帧也必须在分配前受同一硬上限约束。
const MAX_ENCODED_SSE_EVENT_BYTES = MAX_BUFFERED_QUEUE_BYTES;
// Tiny or empty WS frames still carry array/string bookkeeping. Bound their
// count independently so the byte cap cannot be bypassed with fragmentation.
const MAX_BUFFERED_QUEUE_MESSAGES = 4096;
const PAUSE_QUEUE_BYTES = 2 * 1024 * 1024;
const RESUME_QUEUE_BYTES = 1024 * 1024;
const PAUSE_QUEUE_MESSAGES = 1024;
const RESUME_QUEUE_MESSAGES = 512;

// Keep idle upstream sessions long enough for normal Codex interactive use.
// server.js calls cleanup immediately on client WS close; this timer is only a
// leak backstop if a process-level close notification is missed.
const PERSISTENT_SESSION_IDLE_TIMEOUT_MS = 65 * 60 * 1000;
const DEFAULT_PERSISTENT_SESSION_MAX_ENTRIES = 512;

// HTTP statuses on the upgrade handshake that we treat as a definitive
// "this endpoint does not speak WebSocket" signal and cache as unsupported.
// 401 / 403 are NOT in this list because they reflect auth state, not
// protocol support.
const PROTOCOL_UNSUPPORTED_HTTP_STATUSES = new Set([400, 404, 405, 426, 501]);
const SSE_DATA_PREFIX = new TextEncoder().encode("data: ");
const SSE_LINE_BREAK = new TextEncoder().encode("\n");
const SSE_EVENT_END = new TextEncoder().encode("\n\n");

/**
 * Encodes one WS text message as one SSE data event without split/map/join
 * copies. The exact UTF-8 size is known before allocation.
 */
function encodeSseData(payload: string, encoder: TextEncoder): Uint8Array | null {
  const normalized = payload.includes("\r") ? payload.replace(/\r\n?/g, "\n") : payload;
  let lineCount = 1;
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized.charCodeAt(index) === 10) lineCount += 1;
  }

  const payloadBytes = Buffer.byteLength(normalized, "utf8");
  const encodedBytes =
    payloadBytes + lineCount * SSE_DATA_PREFIX.byteLength + SSE_EVENT_END.byteLength;
  if (encodedBytes > MAX_ENCODED_SSE_EVENT_BYTES) return null;

  const output = new Uint8Array(encodedBytes);
  let outputOffset = 0;
  let lineStart = 0;
  while (lineStart <= normalized.length) {
    output.set(SSE_DATA_PREFIX, outputOffset);
    outputOffset += SSE_DATA_PREFIX.byteLength;
    const lineEnd = normalized.indexOf("\n", lineStart);
    const end = lineEnd === -1 ? normalized.length : lineEnd;
    const encoded = encoder.encodeInto(
      normalized.slice(lineStart, end),
      output.subarray(outputOffset)
    );
    outputOffset += encoded.written;
    if (lineEnd === -1) break;
    output.set(SSE_LINE_BREAK, outputOffset);
    outputOffset += SSE_LINE_BREAK.byteLength;
    lineStart = lineEnd + 1;
  }
  output.set(SSE_EVENT_END, outputOffset);
  return output;
}

// Hop-by-hop and request-shape headers that must NOT be forwarded into the
// outbound WebSocket upgrade. The `ws` package handles Connection /
// Upgrade / Sec-WebSocket-* itself; the body-shape headers belong to HTTP
// only and would either be ignored or cause handshake rejection.
const FORBIDDEN_UPSTREAM_WS_HEADERS = new Set([
  "connection",
  "upgrade",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-extensions",
  "sec-websocket-protocol",
  "host",
  "content-length",
  "transfer-encoding",
  "accept",
  "content-type",
  ...RESERVED_INTERNAL_HEADERS,
]);

type PersistentWsEntry = {
  sessionId: string;
  fingerprint: string;
  ws: WebSocketType;
  active: boolean;
  createdAt: number;
  lastUsedAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
};

type PersistentWsState = {
  sessions: Map<string, PersistentWsEntry>;
  maxEntries: number;
};

declare global {
  // Keep retained upstream WS state stable across Next.js dev/test module
  // reloads. server.js calls the latest cleanup hook, so the hook must still
  // see sessions created by an older module instance.
  // eslint-disable-next-line no-var
  var __cchResponsesWsPersistentState: PersistentWsState | undefined;
}

const persistentState = (globalThis.__cchResponsesWsPersistentState ??= {
  sessions: new Map<string, PersistentWsEntry>(),
  maxEntries: DEFAULT_PERSISTENT_SESSION_MAX_ENTRIES,
});
const persistentSessions = persistentState.sessions;

function toWsUrl(httpUrl: string): string {
  const url = new URL(httpUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function stripTransportOnlyFields<T extends Record<string, unknown>>(body: T): T {
  const copy: Record<string, unknown> = { ...body };
  delete copy.stream;
  delete copy.background;
  return copy as T;
}

function serializeResponseCreateFrame(body: Record<string, unknown>): string {
  return JSON.stringify({
    type: "response.create",
    ...stripTransportOnlyFields(body),
  });
}

function buildUpstreamWsHeaders(source: Headers | Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const push = (key: string, value: string) => {
    if (FORBIDDEN_UPSTREAM_WS_HEADERS.has(key.toLowerCase())) return;
    out[key] = value;
  };
  if (source instanceof Headers) {
    source.forEach((value, key) => push(key, value));
  } else {
    for (const [k, v] of Object.entries(source)) push(k, v);
  }
  return out;
}

function buildConnectionFingerprint(options: {
  provider: Provider;
  endpointId?: number | null;
  upstreamUrl: string;
  headers: Record<string, string>;
}): string {
  const normalizedHeaders = Object.entries(options.headers)
    .map(([key, value]) => [key.toLowerCase(), value] as const)
    .sort(([a], [b]) => a.localeCompare(b));

  return createHash("sha256")
    .update(
      JSON.stringify({
        providerId: options.provider.id,
        endpointId: options.endpointId ?? null,
        upstreamUrl: options.upstreamUrl,
        headers: normalizedHeaders,
      })
    )
    .digest("hex");
}

async function loadWsModule(): Promise<typeof WebSocketType | null> {
  try {
    const mod = await import("ws");
    return (mod.default ?? mod) as unknown as typeof WebSocketType;
  } catch (err) {
    logger.warn("[ResponsesWsAdapter] ws module unavailable, falling back to HTTP", {
      error: String(err),
    });
    return null;
  }
}

function isWsOpen(ws: WebSocketType): boolean {
  return ws.readyState === 1;
}

function isWsClosingOrClosed(ws: WebSocketType): boolean {
  return ws.readyState >= 2;
}

function safelyCloseWebSocket(ws: WebSocketType, code: number): void {
  if (ws.readyState === 3) return;

  // Active closes can still surface an asynchronous error after request-level
  // listeners are detached. This one-shot sink keeps the error owned by this
  // socket instead of letting it escape to process-level crash handlers.
  const consumeCloseError = () => {};
  ws.once("error", consumeCloseError);
  ws.once("close", () => {
    ws.off("error", consumeCloseError);
  });

  // Another close path may already have started the handshake. Keep the
  // temporary sink above, but do not issue a duplicate close or terminate.
  if (ws.readyState === 2) return;

  if (ws.readyState === 0) {
    // ws emits this error asynchronously when a CONNECTING socket is closed
    // or terminated, so abort the incomplete handshake instead of attempting
    // a normal close handshake.
    try {
      ws.terminate();
    } catch {
      // ignore
    }
    return;
  }

  try {
    ws.close(code);
  } catch {
    // A readyState transition can race with close(). If the socket is still
    // live, terminate it using the error consumer installed above.
    if (!isWsClosingOrClosed(ws)) {
      try {
        ws.terminate();
      } catch {
        // ignore
      }
    }
  }
}

function forgetPersistentSession(sessionId: string, ws?: WebSocketType): void {
  const entry = persistentSessions.get(sessionId);
  if (!entry) return;
  if (ws && entry.ws !== ws) return;
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
  persistentSessions.delete(sessionId);
}

function closePersistentEntry(entry: PersistentWsEntry, code: number): void {
  forgetPersistentSession(entry.sessionId, entry.ws);
  safelyCloseWebSocket(entry.ws, code);
}

function armPersistentIdleTimer(entry: PersistentWsEntry): void {
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    const current = persistentSessions.get(entry.sessionId);
    if (current !== entry || current.active) return;
    logger.info("[ResponsesWsAdapter] closing idle upstream WS session", {
      sessionId: entry.sessionId,
      idleMs: Date.now() - entry.lastUsedAt,
    });
    closePersistentEntry(entry, 1000);
  }, PERSISTENT_SESSION_IDLE_TIMEOUT_MS);
  if (typeof entry.idleTimer === "object" && "unref" in entry.idleTimer) {
    entry.idleTimer.unref();
  }
}

function prunePersistentSessions(): void {
  const maxEntries = persistentState.maxEntries;
  if (persistentSessions.size < maxEntries) return;

  const idleEntries = [...persistentSessions.values()]
    .filter((entry) => !entry.active)
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  const overflow = persistentSessions.size - maxEntries + 1;
  for (const entry of idleEntries.slice(0, overflow)) {
    logger.warn("[ResponsesWsAdapter] pruning idle upstream WS session", {
      sessionId: entry.sessionId,
    });
    closePersistentEntry(entry, 1000);
  }
}

function registerPersistentSession(
  sessionId: string,
  fingerprint: string,
  ws: WebSocketType
): PersistentWsEntry | null {
  prunePersistentSessions();
  if (persistentSessions.size >= persistentState.maxEntries) {
    logger.warn("[ResponsesWsAdapter] upstream WS session cap reached; not retaining session", {
      sessionId,
      maxEntries: persistentState.maxEntries,
    });
    return null;
  }

  const entry: PersistentWsEntry = {
    sessionId,
    fingerprint,
    ws,
    active: true,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    idleTimer: null,
  };

  ws.on("close", () => {
    forgetPersistentSession(sessionId, ws);
  });
  ws.on("error", () => {
    forgetPersistentSession(sessionId, ws);
  });

  persistentSessions.set(sessionId, entry);
  return entry;
}

export function cleanupResponsesWsSession(sessionId: string): void {
  const entry = persistentSessions.get(sessionId);
  if (!entry) return;
  logger.info("[ResponsesWsAdapter] cleaning upstream WS session", { sessionId });
  closePersistentEntry(entry, 1000);
}

export function clearResponsesWsSessionsForTests(): void {
  for (const entry of persistentSessions.values()) {
    closePersistentEntry(entry, 1000);
  }
  persistentSessions.clear();
  persistentState.maxEntries = DEFAULT_PERSISTENT_SESSION_MAX_ENTRIES;
}

export function setResponsesWsSessionMaxEntriesForTests(maxEntries: number): void {
  const normalized = Math.floor(maxEntries);
  persistentState.maxEntries = Number.isFinite(normalized) ? Math.max(0, normalized) : 0;
}

export function getResponsesWsSessionCountForTests(): number {
  return persistentSessions.size;
}

globalThis.__cchCleanupResponsesWsSession = cleanupResponsesWsSession;

export async function tryResponsesWebsocketUpstream(options: {
  provider: Provider;
  upstreamUrl: string;
  upstreamHeaders: Headers | Record<string, string>;
  body: Record<string, unknown>;
  sessionId?: string | null;
  endpointId?: number | null;
  abortSignal?: AbortSignal;
}): Promise<UpstreamWsResult> {
  const WsCtor = (await loadWsModule()) as
    | (typeof WebSocketType & { new (url: string, opts?: unknown): WebSocketType })
    | null;
  if (!WsCtor) {
    return { failed: true, reason: "ws_module_unavailable", cacheableAsUnsupported: false };
  }

  const wssUrl = toWsUrl(options.upstreamUrl);
  const headers = buildUpstreamWsHeaders(options.upstreamHeaders);
  const sessionId = options.sessionId ?? null;
  const abortSignal = options.abortSignal;
  const fingerprint = buildConnectionFingerprint({
    provider: options.provider,
    endpointId: options.endpointId,
    upstreamUrl: wssUrl,
    headers,
  });

  // 握手期间只保留发送所需字符串；send() 接管后立即断开本地引用。后续流事件
  // 监听器不得闭包捕获完整 options，否则整份请求 body 会滞留到生成结束。
  let serializedFrame = serializeResponseCreateFrame(options.body);

  let persistentEntry: PersistentWsEntry | null = null;
  let reused = false;
  let canRetainFreshSession = Boolean(sessionId);
  let ws: WebSocketType;

  if (sessionId) {
    const existing = persistentSessions.get(sessionId) ?? null;
    if (existing) {
      if (existing.active && !isWsClosingOrClosed(existing.ws)) {
        logger.warn(
          "[ResponsesWsAdapter] active upstream WS session is busy; opening a fresh one",
          {
            sessionId,
          }
        );
        // Keep the active retained entry addressable by cleanupResponsesWsSession().
        // The concurrent fresh socket is request-scoped and must close after its
        // terminal event instead of replacing the in-flight session in the map.
        canRetainFreshSession = false;
      } else if (existing.fingerprint === fingerprint && !isWsClosingOrClosed(existing.ws)) {
        persistentEntry = existing;
        persistentEntry.active = true;
        persistentEntry.lastUsedAt = Date.now();
        if (persistentEntry.idleTimer) {
          clearTimeout(persistentEntry.idleTimer);
          persistentEntry.idleTimer = null;
        }
        ws = existing.ws;
        reused = true;
      } else {
        closePersistentEntry(existing, 1000);
      }
    }
  }

  if (!reused) {
    try {
      ws = new (WsCtor as unknown as new (url: string, opts?: unknown) => WebSocketType)(wssUrl, {
        headers,
        handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
        maxPayload: MAX_BUFFERED_QUEUE_BYTES,
      });
    } catch (err) {
      return {
        failed: true,
        reason: "ws_upgrade_rejected",
        message: String(err && (err as Error).message ? (err as Error).message : err),
        // Constructor throws are typically URL parsing / TLS configuration —
        // not a server-side protocol negative signal — so don't cache.
        cacheableAsUnsupported: false,
      };
    }
  } else {
    ws = persistentEntry!.ws;
  }

  type OpenResult =
    | { ok: true }
    | {
        ok: false;
        reason: UpstreamWsFallbackReason;
        message?: string;
        cacheableAsUnsupported: boolean;
      };

  let firstEventSeen = false;
  let openResolved = false;
  let openPromiseResolve: (v: OpenResult) => void;
  const openPromise = new Promise<OpenResult>((resolve) => {
    openPromiseResolve = resolve;
  });

  const finishOpen = (result: OpenResult) => {
    if (openResolved) return;
    openResolved = true;
    openPromiseResolve(result);
  };

  const closeAndForget = (code: number) => {
    if (sessionId) forgetPersistentSession(sessionId, ws);
    safelyCloseWebSocket(ws, code);
  };

  const messageQueue: string[] = [];
  let messageQueueHead = 0;
  let queueResolver: ((value: string | null) => void) | null = null;
  let socketClosed = isWsClosingOrClosed(ws);
  let queuedBytes = 0;
  let upstreamPaused = false;

  const queuedMessageCount = () => messageQueue.length - messageQueueHead;
  const pauseUpstreamIfNeeded = () => {
    if (upstreamPaused || socketClosed || requestFinished) return;
    if (queuedBytes < PAUSE_QUEUE_BYTES && queuedMessageCount() < PAUSE_QUEUE_MESSAGES) {
      return;
    }
    ws.pause();
    upstreamPaused = true;
  };
  const resumeUpstreamIfNeeded = (force = false) => {
    if (!upstreamPaused) return;
    if (
      !force &&
      (queuedBytes > RESUME_QUEUE_BYTES || queuedMessageCount() > RESUME_QUEUE_MESSAGES)
    ) {
      return;
    }
    upstreamPaused = false;
    if (!socketClosed && !requestFinished) ws.resume();
  };
  // Marks an upstream failure observed AFTER the first event was emitted.
  // The downstream pipeline must see this as an error rather than a clean
  // end-of-stream so it doesn't treat a half-streamed response as success.
  let midStreamError: { code: string; message?: string } | null = null;
  // Hoisted twin of `sawTerminalEvent` (which is scoped inside the SSE
  // ReadableStream's start()). The `ws.on("close")` handler runs in this
  // outer scope and would otherwise have no way to tell whether a terminal
  // event was already forwarded — without this flag a clean post-terminal
  // close would be misclassified as a mid-stream error.
  let terminalEventSeen = false;
  let terminalEventShouldClosePersistent = false;
  let firstEventTimer: ReturnType<typeof setTimeout> | null = null;
  let requestFinished = false;

  const sendFrame = () => {
    if (!isWsOpen(ws)) {
      finishOpen({
        ok: false,
        reason: "ws_error_pre_first_event",
        message: "websocket is not open",
        cacheableAsUnsupported: false,
      });
      closeAndForget(1011);
      return;
    }

    try {
      const payload = serializedFrame;
      serializedFrame = "";
      ws.send(payload, (err?: Error) => {
        if (!err) return;
        finishOpen({
          ok: false,
          reason: "ws_error_pre_first_event",
          message: String(err.message ? err.message : err),
          // Local send failure (closed underlying socket, etc.) is transient.
          cacheableAsUnsupported: false,
        });
        closeAndForget(1011);
      });
    } catch (err) {
      finishOpen({
        ok: false,
        reason: "ws_error_pre_first_event",
        message: String(err && (err as Error).message ? (err as Error).message : err),
        cacheableAsUnsupported: false,
      });
      closeAndForget(1011);
    }
  };

  const onOpen = () => {
    sendFrame();
  };

  const onUnexpectedResponse = (
    _req: unknown,
    res: { statusCode?: number; statusMessage?: string }
  ) => {
    const status = typeof res.statusCode === "number" ? res.statusCode : undefined;
    const cacheable = typeof status === "number" && PROTOCOL_UNSUPPORTED_HTTP_STATUSES.has(status);
    finishOpen({
      ok: false,
      reason: "ws_upgrade_rejected",
      message: `HTTP ${status ?? "?"} ${res.statusMessage ?? ""}`.trim(),
      // Only definitive protocol negatives (4xx/501 on the upgrade path)
      // are cacheable. 401/403/5xx/etc. are auth or transient state.
      cacheableAsUnsupported: cacheable,
    });
    closeAndForget(1011);
  };

  const onMessage = (data: Buffer | string) => {
    if (socketClosed || requestFinished) return;
    const size = typeof data === "string" ? Buffer.byteLength(data, "utf8") : data.byteLength;
    if (size > MAX_BUFFERED_QUEUE_BYTES) {
      logger.warn("[ResponsesWsAdapter] oversized upstream message, terminating WS", {
        attemptedSize: size,
      });
      const failure = {
        code: "upstream_ws_message_too_large",
        message: `upstream payload exceeded ${MAX_BUFFERED_QUEUE_BYTES} bytes`,
      };
      if (!firstEventSeen) {
        finishOpen({
          ok: false,
          reason: "ws_error_pre_first_event",
          message: failure.message,
          cacheableAsUnsupported: false,
        });
      } else {
        midStreamError = failure;
      }
      socketClosed = true;
      resolveMessageWaiter();
      closeAndForget(1009);
      return;
    }

    const text = typeof data === "string" ? data : data.toString("utf8");
    if (!firstEventSeen) {
      firstEventSeen = true;
      if (firstEventTimer) {
        clearTimeout(firstEventTimer);
        firstEventTimer = null;
      }
      finishOpen({ ok: true });
    }
    if (queueResolver) {
      const resolve = queueResolver;
      queueResolver = null;
      resolve(text);
      return;
    }
    // Hard cap on buffered bytes so a stalled SSE consumer cannot let us
    // accumulate unbounded heap growth.
    const queuedMessages = queuedMessageCount();
    if (
      queuedMessages >= MAX_BUFFERED_QUEUE_MESSAGES ||
      queuedBytes + size > MAX_BUFFERED_QUEUE_BYTES
    ) {
      logger.warn("[ResponsesWsAdapter] upstream queue overflow, terminating WS", {
        queuedBytes,
        queuedMessages,
        attemptedSize: size,
      });
      midStreamError = {
        code: "upstream_ws_queue_overflow",
        message: "buffered upstream message queue exceeded its memory limit",
      };
      socketClosed = true;
      closeAndForget(1011);
      return;
    }
    messageQueue.push(text);
    queuedBytes += size;
    pauseUpstreamIfNeeded();
  };

  const onError = (err: Error) => {
    logger.warn("[ResponsesWsAdapter] upstream ws error", {
      error: String(err?.message ? err.message : err),
      firstEventSeen,
      reused,
    });
    if (!firstEventSeen) {
      finishOpen({
        ok: false,
        reason: "ws_error_pre_first_event",
        message: String(err?.message ? err.message : err),
        // Network errors (ECONNREFUSED, ETIMEDOUT, ECONNRESET, TLS) are
        // transient — never cache them as endpoint-unsupported.
        cacheableAsUnsupported: false,
      });
    } else {
      midStreamError = {
        code: "upstream_ws_mid_stream_error",
        message: String(err?.message ? err.message : err),
      };
    }
    socketClosed = true;
    if (sessionId) forgetPersistentSession(sessionId, ws);
    if (queueResolver) {
      const resolve = queueResolver;
      queueResolver = null;
      resolve(null);
    }
  };

  const onClose = (code: number, reason: Buffer | string) => {
    socketClosed = true;
    if (sessionId) forgetPersistentSession(sessionId, ws);
    if (!firstEventSeen) {
      finishOpen({
        ok: false,
        reason: "ws_closed_before_first_event",
        // Endpoint upgraded successfully but closed without a frame. That
        // could be transient (server restart, reload) or it could be a
        // half-broken WS implementation. Conservative default: don't cache,
        // re-probe on the next request.
        cacheableAsUnsupported: false,
      });
    } else if (!midStreamError && !terminalEventSeen) {
      // Upstream closed after the first event but before a terminal event.
      // Record this as an error so the synthesized error frame downstream
      // carries the actual close code instead of a generic message — and so
      // the forwarder doesn't bill the truncated stream as a clean success.
      const reasonText = reason?.length
        ? typeof reason === "string"
          ? reason
          : reason.toString("utf8")
        : "";
      midStreamError = {
        code: "upstream_ws_closed_mid_stream",
        message: `upstream WebSocket closed (code=${code ?? "unknown"})${
          reasonText ? `: ${reasonText}` : ""
        }`,
      };
    }
    if (queueResolver) {
      const resolve = queueResolver;
      queueResolver = null;
      resolve(null);
    }
  };

  const resolveMessageWaiter = () => {
    if (!queueResolver) return;
    const resolve = queueResolver;
    queueResolver = null;
    resolve(null);
  };

  const cleanupRequestListeners = () => {
    ws.off("message", onMessage);
    ws.off("error", onError);
    ws.off("close", onClose);
    ws.off("open", onOpen);
    ws.off("unexpected-response", onUnexpectedResponse);
    if (abortSignal) {
      abortSignal.removeEventListener("abort", onAbort);
    }
    if (firstEventTimer) {
      clearTimeout(firstEventTimer);
      firstEventTimer = null;
    }
  };

  const finishRequest = (options?: { closeCode?: number; forgetSession?: boolean }) => {
    if (requestFinished) return;
    requestFinished = true;

    let closeDetachedEntry = false;
    if (persistentEntry) {
      persistentEntry.active = false;
      persistentEntry.lastUsedAt = Date.now();
      const retainedForReuse = sessionId
        ? persistentSessions.get(sessionId) === persistentEntry
        : false;
      if (!retainedForReuse) {
        closeDetachedEntry = !options?.closeCode;
      } else if (!isWsClosingOrClosed(persistentEntry.ws)) {
        armPersistentIdleTimer(persistentEntry);
      }
    }
    if (options?.forgetSession && sessionId) {
      forgetPersistentSession(sessionId, ws);
    }
    if (options?.closeCode) {
      closeAndForget(options.closeCode);
    } else if (closeDetachedEntry) {
      safelyCloseWebSocket(ws, 1000);
    }
    cleanupRequestListeners();
  };

  function onAbort() {
    socketClosed = true;
    if (!firstEventSeen) {
      finishOpen({
        ok: false,
        reason: "ws_error_pre_first_event",
        message: "aborted before first upstream WebSocket event",
        cacheableAsUnsupported: false,
      });
    }
    resolveMessageWaiter();
    finishRequest({ closeCode: 1000, forgetSession: true });
  }

  ws.on("message", onMessage);
  ws.on("error", onError);
  ws.on("close", onClose);
  if (!reused) {
    ws.on("open", onOpen);
    ws.on("unexpected-response", onUnexpectedResponse);
  }

  if (abortSignal) {
    abortSignal.addEventListener("abort", onAbort, { once: true });
    if (abortSignal.aborted) {
      onAbort();
    }
  }

  // Bound the wait for the first event so a silent upstream cannot pin a
  // request slot indefinitely. Cleared on first message or any other
  // resolution.
  if (!openResolved) {
    firstEventTimer = setTimeout(() => {
      if (firstEventSeen) return;
      finishOpen({
        ok: false,
        reason: "ws_error_pre_first_event",
        message: "timeout_waiting_for_first_event",
        // A silent upstream is most likely transient (load, latency); the
        // next request should re-probe rather than skip the WS path.
        cacheableAsUnsupported: false,
      });
      finishRequest({ closeCode: 1011, forgetSession: true });
    }, FIRST_EVENT_TIMEOUT_MS);
  }

  if (reused) {
    sendFrame();
  }

  const openResult = await openPromise;
  if (firstEventTimer) {
    clearTimeout(firstEventTimer);
    firstEventTimer = null;
  }
  if (!openResult.ok) {
    finishRequest({ closeCode: 1011, forgetSession: true });
    return {
      failed: true,
      reason: openResult.reason,
      message: openResult.message,
      cacheableAsUnsupported: openResult.cacheableAsUnsupported,
    };
  }

  if (sessionId && canRetainFreshSession && !persistentEntry && !socketClosed) {
    persistentEntry = registerPersistentSession(sessionId, fingerprint, ws);
  }

  // Upstream WS is open and at least one event was received. Each downstream
  // pull consumes at most one WS message. This preserves Web Stream
  // backpressure; the explicit messageQueue remains the only upstream-ahead
  // buffer and is capped above.
  const encoder = new TextEncoder();
  let streamFinished = false;

  const popMessage = (): string | undefined => {
    if (messageQueueHead >= messageQueue.length) return undefined;
    const msg = messageQueue[messageQueueHead];
    messageQueue[messageQueueHead] = "";
    messageQueueHead += 1;
    if (msg !== undefined) {
      queuedBytes -= Buffer.byteLength(msg, "utf8");
      if (queuedBytes < 0) queuedBytes = 0;
    }
    if (messageQueueHead === messageQueue.length) {
      messageQueue.length = 0;
      messageQueueHead = 0;
    } else if (messageQueueHead >= 1024 && messageQueueHead * 2 >= messageQueue.length) {
      messageQueue.splice(0, messageQueueHead);
      messageQueueHead = 0;
    }
    resumeUpstreamIfNeeded();
    return msg;
  };

  const clearMessageQueue = () => {
    messageQueue.length = 0;
    messageQueueHead = 0;
    queuedBytes = 0;
    resumeUpstreamIfNeeded(true);
  };

  const processText = (text: string): { bytes: Uint8Array; terminal: boolean } => {
    const bytes = encodeSseData(text, encoder);
    if (!bytes) {
      const failure = {
        code: "upstream_ws_sse_event_too_large",
        message: `encoded upstream SSE event exceeded ${MAX_ENCODED_SSE_EVENT_BYTES} bytes`,
      };
      logger.warn("[ResponsesWsAdapter] encoded SSE event too large, terminating WS", {
        sourceBytes: Buffer.byteLength(text, "utf8"),
      });
      terminalEventSeen = true;
      terminalEventShouldClosePersistent = true;
      return {
        bytes: encodeSseData(JSON.stringify({ type: "error", error: failure }), encoder)!,
        terminal: true,
      };
    }

    let terminal = false;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.type === "string" && TERMINAL_EVENT_TYPES.has(parsed.type)) {
        terminal = true;
        terminalEventSeen = true;
        terminalEventShouldClosePersistent =
          parsed.type === "error" || parsed.error?.code === "websocket_connection_limit_reached";
      }
    } catch {
      // Non-JSON upstream text is forwarded and remains non-terminal.
    }
    return { bytes, terminal };
  };

  const completeTerminal = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    streamFinished = true;
    clearMessageQueue();
    controller.close();
    if (sessionId && persistentEntry && !terminalEventShouldClosePersistent) {
      finishRequest();
    } else {
      finishRequest({ closeCode: 1000, forgetSession: true });
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (streamFinished) return;

      let next = popMessage();
      if (next === undefined && !socketClosed) {
        next =
          (await new Promise<string | null>((resolve) => {
            const queued = popMessage();
            if (queued !== undefined) {
              resolve(queued);
              return;
            }
            queueResolver = resolve;
          })) ?? undefined;
      }

      if (streamFinished) return;
      if (next !== undefined) {
        const processed = processText(next);
        controller.enqueue(processed.bytes);
        if (processed.terminal) completeTerminal(controller);
        return;
      }

      // A close/error wakes the pending pull with null. Consume any frame that
      // raced with the wake-up before declaring the upstream truncated.
      next = popMessage();
      if (next !== undefined) {
        const processed = processText(next);
        controller.enqueue(processed.bytes);
        if (processed.terminal) completeTerminal(controller);
        return;
      }

      const failure = midStreamError ?? {
        code: "upstream_ws_mid_stream_error",
        message: "upstream WebSocket closed before emitting a terminal response event",
      };
      const errorFrame = JSON.stringify({ type: "error", error: failure });
      controller.enqueue(encodeSseData(errorFrame, encoder)!);
      streamFinished = true;
      controller.close();
      finishRequest({ closeCode: 1011, forgetSession: true });
    },
    cancel() {
      streamFinished = true;
      clearMessageQueue();
      resolveMessageWaiter();
      finishRequest({ closeCode: 1000, forgetSession: true });
    },
  });

  return {
    response: new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        "x-cch-upstream-transport": "websocket",
      },
    }),
    connected: true,
    reused,
  };
}
