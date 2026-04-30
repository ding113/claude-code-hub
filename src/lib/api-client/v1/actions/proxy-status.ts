import { apiGet, toActionResult } from "./_compat";

export function getProxyStatus() {
  return toActionResult(apiGet("/api/v1/dashboard/proxy-status"));
}
