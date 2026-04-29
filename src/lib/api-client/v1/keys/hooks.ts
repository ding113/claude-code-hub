"use client";

/**
 * /api/v1/keys TanStack Query hooks
 */

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type {
  KeyCreatedResponse,
  KeyCreateInput,
  KeyEnableInput,
  KeyLimitUsageResponse,
  KeyListResponse,
  KeyQuotaUsageResponse,
  KeyRenewInput,
  KeyUpdateInput,
} from "@/lib/api/v1/schemas/keys";
import type { ApiError } from "@/lib/api-client/v1/client";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

import { keysClient } from "./index";
import { keysKeys } from "./keys";

export function useUserKeysList(
  userId: number,
  options?: { includeStatistics?: boolean }
): UseQueryResult<KeyListResponse, ApiError | Error> {
  return useQuery<KeyListResponse, ApiError | Error>({
    queryKey: keysKeys.listForUser(userId, options?.includeStatistics),
    queryFn: () => keysClient.listForUser(userId, options),
    enabled: Number.isInteger(userId) && userId > 0,
  });
}

export function useKeyLimitUsage(
  id: number
): UseQueryResult<KeyLimitUsageResponse, ApiError | Error> {
  return useQuery<KeyLimitUsageResponse, ApiError | Error>({
    queryKey: keysKeys.limitUsage(id),
    queryFn: () => keysClient.limitUsage(id),
    enabled: Number.isInteger(id) && id > 0,
  });
}

/**
 * Real-time quota usage matching legacy `getKeyQuotaUsage` shape.
 * Uses GET /api/v1/keys/{id}/quota-usage. Pass `enabled` to control re-fetching
 * (the dialog re-fetches on demand without auto-firing on mount).
 */
export function useKeyQuotaUsage(
  id: number,
  options?: { enabled?: boolean }
): UseQueryResult<KeyQuotaUsageResponse, ApiError | Error> {
  return useQuery<KeyQuotaUsageResponse, ApiError | Error>({
    queryKey: keysKeys.quotaUsage(id),
    queryFn: () => keysClient.quotaUsage(id),
    enabled: Number.isInteger(id) && id > 0 && (options?.enabled === undefined || options.enabled),
  });
}

// ==================== 变更 ====================

export function useCreateKey(userId: number) {
  return useApiMutation<KeyCreateInput, KeyCreatedResponse>({
    mutationFn: (input) => keysClient.create(userId, input),
    invalidates: [keysKeys.all],
  });
}

export function useUpdateKey(id: number) {
  return useApiMutation<KeyUpdateInput, { ok: boolean; id: number }>({
    mutationFn: (patch) => keysClient.update(id, patch),
    invalidates: [keysKeys.all],
  });
}

export function useDeleteKey(id: number) {
  return useApiMutation<void, void>({
    mutationFn: () => keysClient.remove(id),
    invalidates: [keysKeys.all],
  });
}

export function useEnableKey(id: number) {
  return useApiMutation<KeyEnableInput, { ok: boolean }>({
    mutationFn: (body) => keysClient.enable(id, body),
    invalidates: [keysKeys.all],
  });
}

export function useRenewKey(id: number) {
  return useApiMutation<KeyRenewInput, { ok: boolean }>({
    mutationFn: (body) => keysClient.renew(id, body),
    invalidates: [keysKeys.all],
  });
}

export function useResetKeyLimits(id: number) {
  return useApiMutation<void, { ok: boolean }>({
    mutationFn: () => keysClient.resetLimits(id),
    invalidates: [keysKeys.all],
  });
}
