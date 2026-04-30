/**
 * Legacy `/api/actions/{module}/{action}` bridge.
 *
 * Browser-safe shim used by Wave 4 frontend migration to invoke legacy server
 * actions while their `/api/v1/*` counterparts are still being built. Each call
 * site that uses this helper MUST be tagged with a TODO referencing the future
 * v1 endpoint so it can be replaced in a follow-up wave.
 *
 * Behaviour:
 *  - Always POSTs JSON to `/api/actions/{module}/{action}`;
 *  - Bypasses `fetchApi` so we can return the raw `ActionResult<T>` envelope
 *    even when the legacy adapter answers HTTP 4xx (it always wraps the body
 *    as `{ ok: false, error }`). This preserves the legacy semantics existing
 *    UI code expects.
 *  - Still relies on cookie auth (`credentials: "include"`).
 *
 * Forbidden: importing this module from server-side code. Server callers
 * should invoke the action directly.
 */

/**
 * Legacy server-action result envelope. Mirrors `ActionResult<T>` from the
 * server-only `@/actions/types` module — duplicated here so client bundles do
 * not pull `next/server` and friends.
 */
export type LegacyActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      errorCode?: string;
      errorParams?: Record<string, string | number>;
    };

/**
 * Invoke a legacy `/api/actions/{module}/{action}` endpoint.
 *
 * Returns the parsed JSON payload regardless of HTTP status code; if the
 * response cannot be parsed (rare), an `{ ok: false, error }` envelope is
 * synthesised with the HTTP status text.
 *
 * @param module action module slug (matches `src/actions/<module>.ts`)
 * @param action exported function name on that module
 * @param body   single JSON-serialisable argument (legacy adapter passes it as the first arg)
 * @param init   extra `RequestInit` (e.g. `signal`)
 *
 * Note: callers MUST add `// TODO: replace once /api/v1/<resource>:<action> lands`.
 */
export async function callLegacyAction<TInput, TData>(
  module: string,
  action: string,
  body: TInput,
  init?: { signal?: AbortSignal }
): Promise<LegacyActionResult<TData>> {
  const response = await fetch(`/api/actions/${module}/${action}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: init?.signal,
  });
  try {
    const data = (await response.json()) as LegacyActionResult<TData>;
    return data;
  } catch {
    return {
      ok: false,
      error: response.statusText || `HTTP ${response.status}`,
    };
  }
}
