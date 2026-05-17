import type { KeyQuotaUsageResult } from "@/actions/key-quota";
import { apiGet, toActionResult } from "./_compat";

export type { KeyQuotaItem, KeyQuotaUsageResult } from "@/actions/key-quota";

export function getKeyQuotaUsage(keyId: number) {
  return toActionResult(apiGet<KeyQuotaUsageResult>(`/api/v1/keys/${keyId}/quota`));
}
