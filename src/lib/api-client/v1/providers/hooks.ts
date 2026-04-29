"use client";

/**
 * /api/v1/providers TanStack Query hooks
 */

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type {
  ProviderAutoSortPriorityInput,
  ProviderBatchResetCircuitsInput,
  ProviderBatchUpdateInput,
  ProviderCreateInput,
  ProviderListResponse,
  ProviderResponse,
  ProviderUpdateInput,
} from "@/lib/api/v1/schemas/providers";
import type { ApiError } from "@/lib/api-client/v1/client";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

import { providersClient } from "./index";
import { providersKeys } from "./keys";

// ==================== Queries ====================

export function useProvidersList(params?: {
  include?: "statistics";
}): UseQueryResult<ProviderListResponse, ApiError | Error> {
  return useQuery<ProviderListResponse, ApiError | Error>({
    queryKey: providersKeys.list(params),
    queryFn: () => providersClient.list(params),
  });
}

export function useProviderDetail(id: number): UseQueryResult<ProviderResponse, ApiError | Error> {
  return useQuery<ProviderResponse, ApiError | Error>({
    queryKey: providersKeys.detail(id),
    queryFn: () => providersClient.detail(id),
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useProvidersHealth(): UseQueryResult<Record<string, unknown>, ApiError | Error> {
  return useQuery<Record<string, unknown>, ApiError | Error>({
    queryKey: providersKeys.health(),
    queryFn: () => providersClient.health(),
  });
}

export function useProviderGroupsList(params?: {
  include?: "count";
}): UseQueryResult<{ items: unknown[] }, ApiError | Error> {
  return useQuery<{ items: unknown[] }, ApiError | Error>({
    queryKey: providersKeys.groups(params),
    queryFn: () => providersClient.groups(params),
  });
}

// ==================== Mutations ====================

export function useCreateProvider() {
  return useApiMutation<ProviderCreateInput, ProviderResponse>({
    mutationFn: (input) => providersClient.create(input),
    invalidates: [providersKeys.all],
  });
}

export function useUpdateProvider(id: number) {
  return useApiMutation<ProviderUpdateInput, ProviderResponse>({
    mutationFn: (patch) => providersClient.update(id, patch),
    invalidates: [providersKeys.all],
  });
}

export function useDeleteProvider(id: number) {
  return useApiMutation<void, void>({
    mutationFn: () => providersClient.remove(id),
    invalidates: [providersKeys.all],
  });
}

export function useResetProviderCircuit(id: number) {
  return useApiMutation<void, { ok: boolean }>({
    mutationFn: () => providersClient.resetCircuit(id),
    invalidates: [providersKeys.all],
  });
}

export function useResetProviderUsage(id: number) {
  return useApiMutation<void, { ok: boolean }>({
    mutationFn: () => providersClient.resetUsage(id),
    invalidates: [providersKeys.all],
  });
}

export function useBatchResetProviderCircuits() {
  return useApiMutation<ProviderBatchResetCircuitsInput, { resetCount: number }>({
    mutationFn: (input) => providersClient.batchResetCircuits(input),
    invalidates: [providersKeys.all],
  });
}

export function useAutoSortProviderPriority() {
  return useApiMutation<ProviderAutoSortPriorityInput, unknown>({
    mutationFn: (input) => providersClient.autoSortPriority(input),
    invalidates: [providersKeys.all],
  });
}

export function useBatchUpdateProviders() {
  return useApiMutation<ProviderBatchUpdateInput, { updatedCount: number }>({
    mutationFn: (input) => providersClient.batchUpdate(input),
    invalidates: [providersKeys.all],
  });
}
