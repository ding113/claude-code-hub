import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  toActionResult,
  toVoidActionResult,
  unwrapItems,
} from "./_compat";

export function listErrorRules() {
  return toActionResult(apiGet<{ items?: unknown[] }>("/api/v1/error-rules").then(unwrapItems));
}

export function createErrorRuleAction(data: unknown) {
  return toActionResult(apiPost("/api/v1/error-rules", data));
}

export function updateErrorRuleAction(id: number, data: unknown) {
  return toActionResult(apiPatch(`/api/v1/error-rules/${id}`, data));
}

export function deleteErrorRuleAction(id: number) {
  return toVoidActionResult(apiDelete(`/api/v1/error-rules/${id}`));
}

export function refreshCacheAction() {
  return toActionResult(apiPost("/api/v1/error-rules/cache:refresh"));
}

export function testErrorRuleAction(data: unknown) {
  return toActionResult(apiPost("/api/v1/error-rules:test", data));
}

export function getCacheStats() {
  return toActionResult(apiGet("/api/v1/error-rules/cache/stats"));
}
