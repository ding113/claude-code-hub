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

// Hard limit on bytes we will buffer between the upstream WebSocket and the
// downstream SSE consumer. If the consumer stalls (or upstream sends faster
// than the SSE reader drains) we cap memory growth and abort the WS rather
// than spilling into the heap unboundedly.
const MAX_BUFFERED_QUEUE_BYTES = 8 * 1024 * 1024; // 8 MiB

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

function closeWs(ws: WebSocketType, code: number): void {
  try {
    ws.close(code);
  } catch {
    // ignore
  }
}

function terminateWs(ws: WebSocketType): void {
  try {
    ws.terminate?.();
  } catch {
    // ignore
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
  closeWs(entry.ws, code);
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
  const fingerprint = buildConnectionFingerprint({
    provider: options.provider,
    endpointId: options.endpointId,
    upstreamUrl: wssUrl,
    headers,
  });

  const frame = {
    type: "response.create",
    ...stripTransportOnlyFields(options.body),
  };

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
    closeWs(ws, code);
  };

  const messageQueue: string[] = [];
  let queueResolver: ((value: string | null) => void) | null = null;
  let socketClosed = isWsClosingOrClosed(ws);
  let queuedBytes = 0;
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
      ws.send(JSON.stringify(frame), (err?: Error) => {
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
    const text = typeof data === "string" ? data : data.toString("utf8");
    const size = Buffer.byteLength(text, "utf8");
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
    if (queuedBytes + size > MAX_BUFFERED_QUEUE_BYTES) {
      logger.warn("[ResponsesWsAdapter] upstream queue overflow, terminating WS", {
        queuedBytes,
        attemptedSize: size,
      });
      midStreamError = {
        code: "upstream_ws_queue_overflow",
        message: `buffered upstream payload exceeded ${MAX_BUFFERED_QUEUE_BYTES} bytes`,
      };
      socketClosed = true;
      closeAndForget(1011);
      return;
    }
    messageQueue.push(text);
    queuedBytes += size;
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
    if (options.abortSignal) {
      options.abortSignal.removeEventListener("abort", onAbort);
    }
    if (firstEventTimer) {
      clearTimeout(firstEventTimer);
      firstEventTimer = null;
    }
  };

  const finishRequest = (options?: { closeCode?: number; forgetSession?: boolean }) => {
    cleanupRequestListeners();
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
      closeWs(ws, 1000);
    }
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

  if (options.abortSignal) {
    options.abortSignal.addEventListener("abort", onAbort, { once: true });
    if (options.abortSignal.aborted) {
      onAbort();
    }
  }

  // Bound the wait for the first event so a silent upstream cannot pin a
  // request slot indefinitely. Cleared on first message or any other
  // resolution.
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
    closeAndForget(1011);
  }, FIRST_EVENT_TIMEOUT_MS);

  if (reused) {
    sendFrame();
  }

  const openResult = await openPromise;
  if (firstEventTimer) {
    clearTimeout(firstEventTimer);
    firstEventTimer = null;
  }
  if (!openResult.ok) {
    cleanupRequestListeners();
    if (sessionId) forgetPersistentSession(sessionId, ws);
    terminateWs(ws);
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

  // Upstream WS is open and at least one event was received. Build an SSE
  // ReadableStream that replays queued messages and streams future ones until
  // a terminal event arrives or the connection closes.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sawTerminalEvent = false;

      const writeLine = (obj: string) => {
        controller.enqueue(encoder.encode(`data: ${obj}\n\n`));
      };

      const processText = (text: string): boolean => {
        writeLine(text);
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed.type === "string" && TERMINAL_EVENT_TYPES.has(parsed.type)) {
            sawTerminalEvent = true;
            // Hoisted twin so the outer `ws.on("close")` handler can tell
            // a clean post-terminal close apart from a real mid-stream drop.
            terminalEventSeen = true;
            terminalEventShouldClosePersistent =
              parsed.type === "error" ||
              parsed.error?.code === "websocket_connection_limit_reached";
            return true;
          }
        } catch {
          // Non-JSON upstream text: still forwarded, not terminal.
        }
        return false;
      };

      const popMessage = (): string | undefined => {
        const msg = messageQueue.shift();
        if (msg !== undefined) {
          queuedBytes -= Buffer.byteLength(msg, "utf8");
          if (queuedBytes < 0) queuedBytes = 0;
        }
        return msg;
      };

      const completeTerminal = () => {
        controller.close();
        if (sessionId && persistentEntry && !terminalEventShouldClosePersistent) {
          finishRequest();
        } else {
          finishRequest({ closeCode: 1000, forgetSession: true });
        }
      };

      // Drain queued first-event(s)
      while (messageQueue.length > 0) {
        const msg = popMessage();
        if (msg === undefined) break;
        if (processText(msg)) {
          completeTerminal();
          return;
        }
      }

      while (!socketClosed) {
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- websocket messages must be consumed in arrival order
        const next = await new Promise<string | null>((resolve) => {
          if (messageQueue.length > 0) {
            resolve(popMessage() ?? null);
            return;
          }
          queueResolver = resolve;
        });
        if (next === null) break;
        if (processText(next)) {
          completeTerminal();
          return;
        }
      }

      // Drain any messages enqueued after the loop's last `await` resolved
      // with `null` (race between shift() and `socketClosed` becoming true).
      while (messageQueue.length > 0) {
        const msg = popMessage();
        if (msg === undefined) break;
        if (processText(msg)) {
          completeTerminal();
          return;
        }
      }

      // If the upstream WS hung up before sending a terminal event, the
      // downstream pipeline must see this as an error rather than a clean
      // end-of-stream — otherwise a truncated body would be billed as a
      // successful response.
      if (!sawTerminalEvent) {
        const failure = midStreamError ?? {
          code: "upstream_ws_mid_stream_error",
          message: "upstream WebSocket closed before emitting a terminal response event",
        };
        const errorFrame = JSON.stringify({
          type: "error",
          error: failure,
        });
        controller.enqueue(encoder.encode(`data: ${errorFrame}\n\n`));
      }

      controller.close();
      finishRequest({ closeCode: sawTerminalEvent ? 1000 : 1011, forgetSession: true });
    },
    cancel() {
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
