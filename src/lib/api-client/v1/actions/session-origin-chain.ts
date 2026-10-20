import { apiGet, searchParams, toActionResult } from "./_compat";

export function getSessionOriginChain(
  sessionId: string,
  requestSequence?: number,
  sourceSessionId?: string
) {
  return toActionResult(
    apiGet(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/origin-chain${searchParams({
        requestSequence,
        sourceSessionId,
      })}`
    )
  );
}
