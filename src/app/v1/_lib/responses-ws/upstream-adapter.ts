/**
 * OpenAI Responses WebSocket upstream adapter (Codex providers only).
 *
 * Attempts a WebSocket connection to the upstream's `/v1/responses` endpoint.
 * On success, events received from the upstream WS are re-emitted as SSE
 * frames so that the forwarder's downstream pipeline (fake-200 detection,
 * prompt_cache_key extraction, usage aggregation, finalization) treats the
 * response exactly like an HTTP Responses SSE stream.
 *
 * On handshake rejection, close-before-first-event, or other fallback-safe
 * errors, returns null so the caller can fall back to the HTTP path. No
 * circuit-breaker accounting happens here — the fallback is purely informational.
 *
 * Scope: this adapter only handles the pre-flight connection attempt. It does
 * NOT re-use connections across requests (first pass); each call opens and
 * closes its own WebSocket. A future revision can add per-socket pooling and
 * previous_response_id delta frames.
 */

import type WebSocketType from "ws";
import { logger } from "@/lib/logger";
import type { Provider } from "@/types/provider";

export interface UpstreamWsOutcome {
  response: Response;
  connected: boolean;
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
]);

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

export async function tryResponsesWebsocketUpstream(options: {
  provider: Provider;
  upstreamUrl: string;
  upstreamHeaders: Headers | Record<string, string>;
  body: Record<string, unknown>;
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

  const frame = {
    type: "response.create",
    ...stripTransportOnlyFields(options.body),
  };

  let ws: WebSocketType;
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

  ws.on("open", () => {
    try {
      ws.send(JSON.stringify(frame));
    } catch (err) {
      finishOpen({
        ok: false,
        reason: "ws_error_pre_first_event",
        message: String(err && (err as Error).message ? (err as Error).message : err),
        // Local send failure (closed underlying socket, etc.) is transient.
        cacheableAsUnsupported: false,
      });
      try {
        ws.close(1011);
      } catch {
        // ignore
      }
    }
  });

  ws.on(
    "unexpected-response",
    (_req: unknown, res: { statusCode?: number; statusMessage?: string }) => {
      const status = typeof res.statusCode === "number" ? res.statusCode : undefined;
      const cacheable =
        typeof status === "number" && PROTOCOL_UNSUPPORTED_HTTP_STATUSES.has(status);
      finishOpen({
        ok: false,
        reason: "ws_upgrade_rejected",
        message: `HTTP ${status ?? "?"} ${res.statusMessage ?? ""}`.trim(),
        // Only definitive protocol negatives (4xx/501 on the upgrade path)
        // are cacheable. 401/403/5xx/etc. are auth or transient state.
        cacheableAsUnsupported: cacheable,
      });
      try {
        ws.close(1011);
      } catch {
        // ignore
      }
    }
  );

  const messageQueue: string[] = [];
  let queueResolver: ((value: string | null) => void) | null = null;
  let closed = false;
  let queuedBytes = 0;
  // Marks an upstream failure observed AFTER the first event was emitted.
  // The downstream pipeline must see this as an error rather than a clean
  // end-of-stream so it doesn't treat a half-streamed response as success.
  let midStreamError: { code: string; message?: string } | null = null;
  let firstEventTimer: ReturnType<typeof setTimeout> | null = null;

  ws.on("message", (data: Buffer | string) => {
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
      closed = true;
      try {
        ws.close(1011);
      } catch {
        // ignore
      }
      return;
    }
    messageQueue.push(text);
    queuedBytes += size;
  });

  ws.on("error", (err: Error) => {
    logger.warn("[ResponsesWsAdapter] upstream ws error", {
      error: String(err?.message ? err.message : err),
      firstEventSeen,
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
    closed = true;
    if (queueResolver) {
      const resolve = queueResolver;
      queueResolver = null;
      resolve(null);
    }
  });

  ws.on("close", () => {
    closed = true;
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
    }
    if (queueResolver) {
      const resolve = queueResolver;
      queueResolver = null;
      resolve(null);
    }
  });

  if (options.abortSignal) {
    options.abortSignal.addEventListener(
      "abort",
      () => {
        try {
          ws.close(1000);
        } catch {
          // ignore
        }
      },
      { once: true }
    );
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
    try {
      ws.close(1011);
    } catch {
      // ignore
    }
  }, FIRST_EVENT_TIMEOUT_MS);

  const openResult = await openPromise;
  if (firstEventTimer) {
    clearTimeout(firstEventTimer);
    firstEventTimer = null;
  }
  if (!openResult.ok) {
    try {
      ws.terminate?.();
    } catch {
      // ignore
    }
    return {
      failed: true,
      reason: openResult.reason,
      message: openResult.message,
      cacheableAsUnsupported: openResult.cacheableAsUnsupported,
    };
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

      // Drain queued first-event(s)
      while (messageQueue.length > 0) {
        const msg = popMessage();
        if (msg === undefined) break;
        if (processText(msg)) {
          controller.close();
          try {
            ws.close(1000);
          } catch {
            // ignore
          }
          return;
        }
      }

      while (!closed) {
        const next = await new Promise<string | null>((resolve) => {
          if (messageQueue.length > 0) {
            resolve(popMessage() ?? null);
            return;
          }
          queueResolver = resolve;
        });
        if (next === null) break;
        if (processText(next)) {
          controller.close();
          try {
            ws.close(1000);
          } catch {
            // ignore
          }
          return;
        }
      }

      // Drain any messages enqueued after the loop's last `await` resolved
      // with `null` (race between shift() and `closed` becoming true).
      while (messageQueue.length > 0) {
        const msg = popMessage();
        if (msg === undefined) break;
        if (processText(msg)) {
          controller.close();
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
    },
    cancel() {
      try {
        ws.close(1000);
      } catch {
        // ignore
      }
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
  };
}
