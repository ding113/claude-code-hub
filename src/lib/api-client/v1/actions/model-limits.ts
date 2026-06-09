import type {
  ModelGroupLimitResponse,
  ModelGroupLimitUpsertInput,
} from "@/lib/api/v1/schemas/model-limits";
import {
  apiDelete,
  apiGet,
  apiPost,
  searchParams,
  toActionResult,
  toVoidActionResult,
  unwrapItems,
} from "./_compat";

export type {
  ModelGroupLimitResponse,
  ModelGroupLimitUpsertInput,
} from "@/lib/api/v1/schemas/model-limits";

export function listModelGroupLimits(
  filter: { subjectType?: string; subjectId?: number; modelGroupId?: number } = {}
) {
  const qs = searchParams(filter);
  return toActionResult(
    apiGet<{ items?: ModelGroupLimitResponse[] }>(`/api/v1/model-limits${qs}`).then(unwrapItems)
  );
}

export function upsertModelGroupLimit(body: ModelGroupLimitUpsertInput) {
  return toActionResult(apiPost<ModelGroupLimitResponse>("/api/v1/model-limits", body));
}

export function deleteModelGroupLimit(id: number) {
  return toVoidActionResult(apiDelete(`/api/v1/model-limits/${id}`));
}
