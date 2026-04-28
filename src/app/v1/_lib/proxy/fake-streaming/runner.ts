import { emitFinalNonStream, emitFinalStream, emitStreamError } from "./emitters";
import { type AttemptPerformer, orchestrateFakeStreamingAttempts } from "./orchestrator";
import type { ProtocolFamily } from "./response-validator";

export type { AttemptPerformer } from "./orchestrator";

const HEARTBEAT_FRAME = ": ping\n\n";

export interface FakeStreamingRunInput {
  family: ProtocolFamily;
  isStream: boolean;
  performAttempt: AttemptPerformer;
  abortSignal: AbortSignal;
  maxAttempts: number;
  heartbeatIntervalMs: number;
}

/**
 * Synchronous entry for the stream client path: returns a Response immediately
 * so the SSE heartbeat can flush before the orchestrator finishes.
 *
 * For non-stream clients, use `buildFakeStreamingNonStreamResponse` directly —
 * it awaits the orchestrator and returns an accurate HTTP status code (200 /
 * 502 / 499). Calling this synchronous entry with `isStream: false` cannot
 * surface a non-200 status (Response status is locked at construction), so we
 * fail fast rather than silently report 200 on upstream failure.
 */
export function buildFakeStreamingResponse(input: FakeStreamingRunInput): Response {
  if (!input.isStream) {
    throw new Error(
      "buildFakeStreamingResponse requires isStream=true. " +
        "Use buildFakeStreamingNonStreamResponse for non-stream clients."
    );
  }
  return buildStreamResponse(input);
}

function buildStreamResponse(input: FakeStreamingRunInput): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // First heartbeat goes out immediately so consumers see something on the
      // wire right away.
      safeEnqueue(HEARTBEAT_FRAME);

      const heartbeatTimer = setInterval(() => {
        safeEnqueue(HEARTBEAT_FRAME);
      }, input.heartbeatIntervalMs);

      const cleanupHeartbeat = () => clearInterval(heartbeatTimer);

      const onAbort = () => {
        cleanupHeartbeat();
        safeClose();
      };
      input.abortSignal.addEventListener("abort", onAbort, { once: true });

      void orchestrateFakeStreamingAttempts({
        family: input.family,
        performAttempt: input.performAttempt,
        abortSignal: input.abortSignal,
        maxAttempts: input.maxAttempts,
        isStream: false,
      })
        .then((result) => {
          cleanupHeartbeat();
          input.abortSignal.removeEventListener("abort", onAbort);
          if (input.abortSignal.aborted) {
            safeClose();
            return;
          }
          if (result.ok && typeof result.finalBody === "string") {
            try {
              safeEnqueue(emitFinalStream({ family: input.family, finalBody: result.finalBody }));
            } catch {
              safeEnqueue(
                emitStreamError({
                  family: input.family,
                  errorMessage: "fake streaming emitter failed",
                  errorCode: "emitter_error",
                })
              );
            }
          } else if (result.errorCode === "client_abort") {
            // Already handled by abort listener; nothing to emit.
          } else {
            safeEnqueue(
              emitStreamError({
                family: input.family,
                errorMessage: result.errorMessage ?? "all upstream attempts failed",
                errorCode: result.errorCode ?? "upstream_all_attempts_failed",
              })
            );
          }
          safeClose();
        })
        .catch((error: unknown) => {
          cleanupHeartbeat();
          input.abortSignal.removeEventListener("abort", onAbort);
          if (!input.abortSignal.aborted) {
            safeEnqueue(
              emitStreamError({
                family: input.family,
                errorMessage:
                  error instanceof Error ? error.message : "fake streaming runner failed",
                errorCode: "runner_error",
              })
            );
          }
          safeClose();
        });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Strict Promise<Response> variant for non-stream path. Always resolves with
 * an accurate HTTP status code (200 success / 502 all-failed / 499 abort).
 */
export async function buildFakeStreamingNonStreamResponse(
  input: Omit<FakeStreamingRunInput, "isStream" | "heartbeatIntervalMs">
): Promise<Response> {
  const result = await orchestrateFakeStreamingAttempts({
    family: input.family,
    performAttempt: input.performAttempt,
    abortSignal: input.abortSignal,
    maxAttempts: input.maxAttempts,
  });

  if (result.ok && typeof result.finalBody === "string") {
    return new Response(emitFinalNonStream({ family: input.family, finalBody: result.finalBody }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }

  if (result.errorCode === "client_abort") {
    return new Response(
      JSON.stringify({
        error: {
          code: "client_abort",
          message: result.errorMessage ?? "client disconnected",
        },
      }),
      {
        status: 499,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  return new Response(
    JSON.stringify({
      error: {
        code: result.errorCode ?? "upstream_all_attempts_failed",
        message: result.errorMessage ?? "all upstream attempts failed",
      },
    }),
    {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }
  );
}
