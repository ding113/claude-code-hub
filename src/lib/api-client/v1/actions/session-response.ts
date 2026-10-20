import { apiGet, searchParams, toActionResult } from "./_compat";

export function getSessionResponse(
  sessionId: string,
  requestSequence?: number,
  sourceSessionId?: string
) {
  return toActionResult(
    apiGet<{ response: string | null }>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/response${searchParams({
        requestSequence,
        sourceSessionId,
      })}`
    ).then((body) => body.response)
  );
}
