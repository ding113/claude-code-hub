import { apiGet, toActionResult } from "./_compat";

export function getSessionOriginChain(sessionId: string) {
  return toActionResult(apiGet(`/api/v1/sessions/${encodeURIComponent(sessionId)}/origin-chain`));
}
