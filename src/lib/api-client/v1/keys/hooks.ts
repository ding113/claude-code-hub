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
