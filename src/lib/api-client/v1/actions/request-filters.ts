import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  toActionResult,
  toVoidActionResult,
  unwrapItems,
} from "./_compat";

export function listRequestFilters() {
  return toActionResult(apiGet<{ items?: unknown[] }>("/api/v1/request-filters").then(unwrapItems));
}

export function createRequestFilterAction(data: unknown) {
  return toActionResult(apiPost("/api/v1/request-filters", data));
}

export function updateRequestFilterAction(id: number, data: unknown) {
  return toActionResult(apiPatch(`/api/v1/request-filters/${id}`, data));
}

export function deleteRequestFilterAction(id: number) {
  return toVoidActionResult(apiDelete(`/api/v1/request-filters/${id}`));
}

export function refreshRequestFiltersCache() {
  return toActionResult(apiPost("/api/v1/request-filters/cache:refresh"));
}

export function listProvidersForFilterAction() {
  return toActionResult(
    apiGet<{ items?: Array<{ id: number; name: string }> }>(
      "/api/v1/request-filters/options/providers"
    ).then(unwrapItems)
  );
}

export function getDistinctProviderGroupsAction() {
  return toActionResult(
    apiGet<{ items?: string[] }>("/api/v1/request-filters/options/groups").then(unwrapItems)
  );
}
