import { apiGet, searchParams, toActionResult, unwrapItems } from "./_compat";
import type { ActionResult } from "./types";

export interface ProviderCacheEffectivenessWindowDto {
  id: number;
  providerId: number;
  model: string;
  cacheTtlBucket: string;
  windowStart: string;
  windowEnd: string;
  sampleCount: number;
  eligibleCount: number;
  theoreticalCacheTokens: number;
  observedCacheReadTokens: number;
  rawEffectivenessBp: number;
  confidenceBp: number;
  effectivenessBp: number;
  createdAt: string | null;
}

export interface GetProviderCacheEffectivenessParams {
  providerId?: number;
  limit?: number;
}

export function getProviderCacheEffectivenessWindows(
  params?: GetProviderCacheEffectivenessParams
): Promise<ActionResult<ProviderCacheEffectivenessWindowDto[]>> {
  return toActionResult(
    apiGet<{ items?: ProviderCacheEffectivenessWindowDto[] }>(
      `/api/v1/providers/cache-effectiveness${searchParams({
        providerId: params?.providerId,
        limit: params?.limit,
      })}`
    ).then(unwrapItems)
  );
}
