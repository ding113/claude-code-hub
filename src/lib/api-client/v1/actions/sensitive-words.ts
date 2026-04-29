import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  toActionResult,
  toVoidActionResult,
  unwrapItems,
} from "./_compat";

export function listSensitiveWords() {
  return toActionResult(apiGet<{ items?: unknown[] }>("/api/v1/sensitive-words").then(unwrapItems));
}

export function createSensitiveWordAction(data: unknown) {
  return toActionResult(apiPost("/api/v1/sensitive-words", data));
}

export function updateSensitiveWordAction(id: number, data: unknown) {
  return toActionResult(apiPatch(`/api/v1/sensitive-words/${id}`, data));
}

export function deleteSensitiveWordAction(id: number) {
  return toVoidActionResult(apiDelete(`/api/v1/sensitive-words/${id}`));
}

export function refreshCacheAction() {
  return toActionResult(apiPost("/api/v1/sensitive-words/cache:refresh"));
}

export function getCacheStats() {
  return toActionResult(apiGet("/api/v1/sensitive-words/cache/stats"));
}
