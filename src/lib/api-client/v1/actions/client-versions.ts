import { apiGet, toActionResult, unwrapItems } from "./_compat";

export function fetchClientVersionStats() {
  return toActionResult(
    apiGet<{ items?: unknown[] }>("/api/v1/dashboard/client-versions").then(unwrapItems)
  );
}
