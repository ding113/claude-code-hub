import { apiPost, toActionResult } from "./_compat";

export function simulateDispatchAction(input: unknown) {
  return toActionResult(apiPost("/api/v1/dashboard/dispatch-simulator:simulate", input));
}
