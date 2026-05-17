import type { ProviderGroupWithCount } from "@/actions/provider-groups";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  toActionResult,
  toVoidActionResult,
} from "./_compat";

export type { ProviderGroupWithCount } from "@/actions/provider-groups";

export function getProviderGroups() {
  return toActionResult(
    apiGet<{ items?: ProviderGroupWithCount[] }>("/api/v1/provider-groups").then(
      (body) => body.items ?? []
    )
  );
}

export function createProviderGroup(data: unknown) {
  return toActionResult(apiPost("/api/v1/provider-groups", data));
}

export function updateProviderGroup(id: number, data: unknown) {
  return toActionResult(apiPatch(`/api/v1/provider-groups/${id}`, data));
}

export function deleteProviderGroup(id: number) {
  return toVoidActionResult(apiDelete(`/api/v1/provider-groups/${id}`));
}
