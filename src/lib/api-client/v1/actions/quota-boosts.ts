import type {
  QuotaBoostGrantCreateInput,
  QuotaBoostGrantResponse,
} from "@/lib/api/v1/schemas/quota-boosts";
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
  QuotaBoostGrantCreateInput,
  QuotaBoostGrantResponse,
} from "@/lib/api/v1/schemas/quota-boosts";

export function listQuotaBoosts(filter: { userId?: number; modelGroupId?: number } = {}) {
  const qs = searchParams(filter);
  return toActionResult(
    apiGet<{ items?: QuotaBoostGrantResponse[] }>(`/api/v1/quota-boosts${qs}`).then(unwrapItems)
  );
}

export function createQuotaBoost(body: QuotaBoostGrantCreateInput) {
  return toActionResult(apiPost<QuotaBoostGrantResponse>("/api/v1/quota-boosts", body));
}

export function deleteQuotaBoost(id: number) {
  return toVoidActionResult(apiDelete(`/api/v1/quota-boosts/${id}`));
}
