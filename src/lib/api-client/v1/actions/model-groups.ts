import type {
  ModelGroupCreateInput,
  ModelGroupResponse,
  ModelGroupUpdateInput,
} from "@/lib/api/v1/schemas/model-groups";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  searchParams,
  toActionResult,
  toVoidActionResult,
  unwrapItems,
} from "./_compat";

export type {
  ModelGroupCreateInput,
  ModelGroupResponse,
  ModelGroupUpdateInput,
} from "@/lib/api/v1/schemas/model-groups";

export function listModelGroups() {
  return toActionResult(
    apiGet<{ items?: ModelGroupResponse[] }>("/api/v1/model-groups").then(unwrapItems)
  );
}

export function createModelGroup(body: ModelGroupCreateInput) {
  return toActionResult(apiPost<ModelGroupResponse>("/api/v1/model-groups", body));
}

export function updateModelGroup(id: number, body: ModelGroupUpdateInput) {
  return toActionResult(apiPatch<ModelGroupResponse>(`/api/v1/model-groups/${id}`, body));
}

export function deleteModelGroup(id: number) {
  return toVoidActionResult(apiDelete(`/api/v1/model-groups/${id}`));
}

export function addModelGroupMember(id: number, model: string) {
  return toVoidActionResult(apiPost(`/api/v1/model-groups/${id}/members`, { model }));
}

export function removeModelGroupMember(id: number, model: string) {
  const qs = searchParams({ model });
  return toVoidActionResult(apiDelete(`/api/v1/model-groups/${id}/members${qs}`));
}

export function createSingletonModelGroup(model: string, name?: string) {
  return toActionResult(
    apiPost<ModelGroupResponse>("/api/v1/model-groups/singleton", { model, name })
  );
}
