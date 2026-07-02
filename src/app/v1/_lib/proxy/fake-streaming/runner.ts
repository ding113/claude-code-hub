import { emitFinalNonStream, emitFinalStream, emitStreamError } from "./emitters";
import {
  type AttemptPerformer,
  type OrchestrateResult,
  orchestrateFakeStreamingAttempts,
} from "./orchestrator";
import type { ProtocolFamily } from "./response-validator";

export type { AttemptPerformer } from "./orchestrator";

const HEARTBEAT_FRAME = ": ping\n\n";

/**
 * Optional lifecycle hook fired ONCE per fake-streaming run, regardless of
 * outcome (success / all-failed / client_abort / runner error). Wired by
 * `tryFakeStreamingPath` so it can persist the terminal status_code,
 * provider_chain, tokens, and tracker.endRequest that the normal
 * ProxyResponseHandler / ProxyErrorHandler path would have written — since
 * fake streaming bypasses both handlers.
 *
 * The callback MUST NOT throw; runner swallows any errors from it to avoid
 * leaking into the SSE stream or breaking the non-stream response.
 */
export type FakeStreamingCompletionHook = (outcome: {
  result: OrchestrateResult;
  errorFromRunner?: unknown;
}) => void | Promise<void>;

export interface FakeStreamingRunInput {
  family: ProtocolFamily;
  isStream: boolean;
  performAttempt: AttemptPerformer;
  abortSignal: AbortSignal;
  maxAttempts: number;
  heartbeatIntervalMs: number;
  onCompletion?: FakeStreamingCompletionHook;
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

      // The completion hook must fire EXACTLY once per run: either from the
      // orchestrator's terminal state, or — if orchestrator never settles
      // (upstream fetch hung with no provider-level timeout) — from the abort
      // listener as soon as the client disconnects. `completionFired` guards
      // the once-only contract across both paths.
      let completionFired = false;
      const invokeCompletion = async (
        result: OrchestrateResult,
        errorFromRunner?: unknown
      ): Promise<void> => {
        if (completionFired) return;
        completionFired = true;
        if (!input.onCompletion) return;
        try {
          await input.onCompletion({ result, errorFromRunner });
        } catch {
          // Lifecycle persistence errors must not leak into the SSE stream.
        }
      };

      const onAbort = () => {
        cleanupHeartbeat();
        safeClose();
        // Do NOT block on the persistence write — the response stream must
        // close immediately for abort semantics. `invokeCompletion` returns
        // void here, and its own body is fully try/catched so it cannot
        // reject synchronously or via an unhandled rejection.
        if (!completionFired) {
          void invokeCompletion({
            ok: false,
            attempts: [],
            errorCode: "client_abort",
            errorMessage: "client disconnected before upstream settled",
          });
        }
      };
      input.abortSignal.addEventListener("abort", onAbort, { once: true });

      void orchestrateFakeStreamingAttempts({
        family: input.family,
        performAttempt: input.performAttempt,
        abortSignal: input.abortSignal,
        maxAttempts: input.maxAttempts,
        isStream: false,
      })
        .then(async (result) => {
          cleanupHeartbeat();
          input.abortSignal.removeEventListener("abort", onAbort);
          if (input.abortSignal.aborted) {
            safeClose();
            await invokeCompletion(result);
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
          await invokeCompletion(result);
        })
        .catch(async (error: unknown) => {
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
          await invokeCompletion(
            {
              ok: false,
              attempts: [],
              errorCode: "upstream_all_attempts_failed",
              errorMessage: error instanceof Error ? error.message : "fake streaming runner failed",
            },
            error
          );
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
  const invokeCompletion = async (
    result: OrchestrateResult,
    errorFromRunner?: unknown
  ): Promise<void> => {
    if (!input.onCompletion) return;
    try {
      await input.onCompletion({ result, errorFromRunner });
    } catch {
      // Lifecycle persistence errors must not affect the HTTP response.
    }
  };

  let result: Awaited<ReturnType<typeof orchestrateFakeStreamingAttempts>>;
  try {
    result = await orchestrateFakeStreamingAttempts({
      family: input.family,
      performAttempt: input.performAttempt,
      abortSignal: input.abortSignal,
      maxAttempts: input.maxAttempts,
    });
  } catch (error) {
    // Orchestrator only re-throws non-abort exceptions (e.g., transport
    // failures). Surface a structured 502 here so non-stream clients get the
    // same JSON contract they would for "all attempts failed", instead of the
    // outer ProxyErrorHandler turning this into a different shape.
    await invokeCompletion(
      {
        ok: false,
        attempts: [],
        errorCode: "upstream_all_attempts_failed",
        errorMessage: error instanceof Error ? error.message : "fake streaming runner failed",
      },
      error
    );
    return new Response(
      JSON.stringify({
        error: {
          code: "runner_error",
          message: error instanceof Error ? error.message : "fake streaming runner failed",
        },
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  await invokeCompletion(result);

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
