import { apiGet, apiPut, toActionResult, toVoidActionResult, unwrapItems } from "./_compat";

export function getBindingsForTypeAction(type: string) {
  return toActionResult(
    apiGet<{ items?: unknown[] }>(`/api/v1/notifications/types/${type}/bindings`).then(unwrapItems)
  );
}

export function updateBindingsAction(type: string, items: unknown[]) {
  return toVoidActionResult(apiPut(`/api/v1/notifications/types/${type}/bindings`, { items }));
}
