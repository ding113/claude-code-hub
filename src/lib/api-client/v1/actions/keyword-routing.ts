import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  toActionResult,
  toVoidActionResult,
  unwrapItems,
} from "./_compat";

export function listKeywordRoutingRules() {
  return toActionResult(
    apiGet<{ items?: unknown[] }>("/api/v1/keyword-routing-rules").then(unwrapItems)
  );
}

export function createKeywordRoutingRuleAction(data: unknown) {
  return toActionResult(apiPost("/api/v1/keyword-routing-rules", data));
}

export function updateKeywordRoutingRuleAction(id: number, data: unknown) {
  return toActionResult(apiPatch(`/api/v1/keyword-routing-rules/${id}`, data));
}

export function deleteKeywordRoutingRuleAction(id: number) {
  return toVoidActionResult(apiDelete(`/api/v1/keyword-routing-rules/${id}`));
}

export function refreshKeywordRoutingCacheAction() {
  return toActionResult(apiPost("/api/v1/keyword-routing-rules/cache:refresh"));
}

export function getKeywordRoutingCacheStats() {
  return toActionResult(apiGet("/api/v1/keyword-routing-rules/cache/stats"));
}
