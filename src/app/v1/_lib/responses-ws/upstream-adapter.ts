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
}

export type UpstreamWsResult = UpstreamWsOutcome | UpstreamWsFailure;

const TERMINAL_EVENT_TYPES = new Set([
  "response.completed",
  "response.failed",
  "response.incomplete",
  "error",
]);

const HANDSHAKE_TIMEOUT_MS = 10_000;

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
    return { failed: true, reason: "ws_module_unavailable" };
  }

  const wssUrl = toWsUrl(options.upstreamUrl);
  const headers: Record<string, string> = {};
  if (options.upstreamHeaders instanceof Headers) {
    options.upstreamHeaders.forEach((value, key) => {
      const lower = key.toLowerCase();
      // ws package handles Connection/Upgrade/Sec-WebSocket-* itself.
      if (
        lower === "connection" ||
        lower === "upgrade" ||
        lower === "sec-websocket-key" ||
        lower === "sec-websocket-version" ||
        lower === "sec-websocket-extensions" ||
        lower === "sec-websocket-protocol" ||
        lower === "host" ||
        lower === "content-length" ||
        lower === "transfer-encoding" ||
        lower === "accept" ||
        lower === "content-type"
      ) {
        return;
      }
      headers[key] = value;
    });
  } else {
    for (const [k, v] of Object.entries(options.upstreamHeaders)) {
      headers[k] = v;
    }
  }

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
    };
  }

  let firstEventSeen = false;
  let openResolved = false;
  let openPromiseResolve: (
    v: { ok: true } | { ok: false; reason: UpstreamWsFallbackReason; message?: string }
  ) => void;
  const openPromise = new Promise<
    { ok: true } | { ok: false; reason: UpstreamWsFallbackReason; message?: string }
  >((resolve) => {
    openPromiseResolve = resolve;
  });

  const finishOpen = (
    result: { ok: true } | { ok: false; reason: UpstreamWsFallbackReason; message?: string }
  ) => {
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
      finishOpen({
        ok: false,
        reason: "ws_upgrade_rejected",
        message: `HTTP ${res.statusCode ?? "?"} ${res.statusMessage ?? ""}`.trim(),
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
  let closeReason: UpstreamWsFallbackReason | null = null;

  ws.on("message", (data: Buffer | string) => {
    const text = typeof data === "string" ? data : data.toString("utf8");
    if (!firstEventSeen) {
      firstEventSeen = true;
      finishOpen({ ok: true });
    }
    if (queueResolver) {
      const resolve = queueResolver;
      queueResolver = null;
      resolve(text);
    } else {
      messageQueue.push(text);
    }
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
      });
    }
    closed = true;
    closeReason = firstEventSeen ? null : "ws_error_pre_first_event";
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

  const openResult = await openPromise;
  if (!openResult.ok) {
    try {
      ws.terminate?.();
    } catch {
      // ignore
    }
    return { failed: true, reason: openResult.reason, message: openResult.message };
  }

  // Upstream WS is open and at least one event was received. Build an SSE
  // ReadableStream that replays queued messages and streams future ones until
  // a terminal event arrives or the connection closes.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const writeLine = (obj: string) => {
        controller.enqueue(encoder.encode(`data: ${obj}\n\n`));
      };

      const processText = (text: string): boolean => {
        writeLine(text);
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed.type === "string" && TERMINAL_EVENT_TYPES.has(parsed.type)) {
            return true;
          }
        } catch {
          // Non-JSON upstream text: still forwarded, not terminal.
        }
        return false;
      };

      // Drain queued first-event(s)
      while (messageQueue.length > 0) {
        const msg = messageQueue.shift();
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
            resolve(messageQueue.shift() ?? null);
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

      if (closeReason === "ws_error_pre_first_event") {
        // Shouldn't happen: we only reach here if firstEventSeen=true.
        controller.error(new Error("upstream_ws_mid_stream_error"));
        return;
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
