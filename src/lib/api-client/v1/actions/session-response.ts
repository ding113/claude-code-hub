import { apiGet, toActionResult } from "./_compat";

export function getSessionResponse(sessionId: string) {
  return toActionResult(
    apiGet<{ response: string | null }>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/response`
    ).then((body) => body.response)
  );
}
