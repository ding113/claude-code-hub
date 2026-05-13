import { apiGet, toActionResult, unwrapItems } from "./_compat";

export function getProviderSlots() {
  return toActionResult(
    apiGet<{ items?: unknown[] }>("/api/v1/dashboard/provider-slots").then(unwrapItems)
  );
}
