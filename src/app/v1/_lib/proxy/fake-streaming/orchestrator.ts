import {
  type ProtocolFamily,
  type ValidationResult,
  validateUpstreamResponse,
} from "./response-validator";

export interface FakeStreamingAttemptOutcome {
  status: number;
  body: string;
  providerId: string;
}

export type AttemptPerformer = (
  attemptIndex: number,
  abortSignal: AbortSignal
) => Promise<FakeStreamingAttemptOutcome | null>;

export interface FakeStreamingAttemptRecord {
  providerId: string;
  status: number;
  validation: ValidationResult;
}

export type FakeStreamingErrorCode =
  | "upstream_all_attempts_failed"
  | "client_abort"
  | "no_providers";

export interface OrchestrateInput {
  family: ProtocolFamily;
  performAttempt: AttemptPerformer;
  abortSignal: AbortSignal;
  maxAttempts: number;
  isStream?: boolean; // default true: orchestrator runs while client expects a stream
}

export interface OrchestrateResult {
  ok: boolean;
  finalBody?: string;
  finalProviderId?: string;
  attempts: FakeStreamingAttemptRecord[];
  errorCode?: FakeStreamingErrorCode;
  errorMessage?: string;
}

/**
 * Run upstream attempts strictly serially. Each attempt is a complete buffered
 * upstream fetch (the caller is responsible for converting stream upstream into
 * a buffered body). The validator decides whether the buffered body is
 * deliverable; on failure, we move on to the next provider.
 *
 * The function exits as soon as:
 * - validator returns ok (success), or
 * - performAttempt returns null (no more providers / loop exhausted), or
 * - the abort signal fires (client disconnected — no further fallback), or
 * - maxAttempts is reached.
 */
export async function orchestrateFakeStreamingAttempts(
  input: OrchestrateInput
): Promise<OrchestrateResult> {
  const attempts: FakeStreamingAttemptRecord[] = [];
  // The validator default is "stream === false" semantics, but for fake
  // streaming we always buffer upstream as non-stream and rely on the
  // protocol-family validation rules. Allow callers to override.
  const validateAsStream = input.isStream === true ? true : false;

  for (let attemptIndex = 0; attemptIndex < input.maxAttempts; attemptIndex += 1) {
    if (input.abortSignal.aborted) {
      return {
        ok: false,
        attempts,
        errorCode: "client_abort",
        errorMessage: "client disconnected",
      };
    }

    const attemptAbort = new AbortController();
    const onParentAbort = () => attemptAbort.abort();
    input.abortSignal.addEventListener("abort", onParentAbort, { once: true });

    let outcome: FakeStreamingAttemptOutcome | null;
    try {
      outcome = await input.performAttempt(attemptIndex, attemptAbort.signal);
    } catch (error) {
      input.abortSignal.removeEventListener("abort", onParentAbort);
      if (input.abortSignal.aborted || isAbortError(error)) {
        return {
          ok: false,
          attempts,
          errorCode: "client_abort",
          errorMessage: error instanceof Error ? error.message : "client disconnected",
        };
      }
      // Re-throw non-abort errors so the caller can decide what to do.
      throw error;
    } finally {
      input.abortSignal.removeEventListener("abort", onParentAbort);
    }

    if (outcome === null) {
      if (attempts.length === 0) {
        return {
          ok: false,
          attempts,
          errorCode: "no_providers",
          errorMessage: "no providers available",
        };
      }
      return {
        ok: false,
        attempts,
        errorCode: "upstream_all_attempts_failed",
        errorMessage: "all upstream attempts failed and no more providers",
      };
    }

    const validation = validateUpstreamResponse({
      family: input.family,
      status: outcome.status,
      body: outcome.body,
      isStream: validateAsStream,
    });

    attempts.push({
      providerId: outcome.providerId,
      status: outcome.status,
      validation,
    });

    if (validation.ok) {
      return {
        ok: true,
        finalBody: outcome.body,
        finalProviderId: outcome.providerId,
        attempts,
      };
    }
  }

  return {
    ok: false,
    attempts,
    errorCode: "upstream_all_attempts_failed",
    errorMessage: "all upstream attempts failed",
  };
}

function isAbortError(error: unknown): boolean {
  if (!error) return false;
  const name = (error as { name?: unknown }).name;
  if (typeof name === "string" && name === "AbortError") return true;
  return false;
}
