import { apiGet, toActionResult } from "./_compat";

export function getConcurrentSessions() {
  return toActionResult(
    apiGet<{ count: number }>("/api/v1/dashboard/concurrent-sessions").then((body) => body.count)
  );
}
