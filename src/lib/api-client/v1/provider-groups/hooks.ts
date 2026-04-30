"use client";

/**
 * /api/v1/provider-groups TanStack Query hooks
 */

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type {
  ProviderGroupCreateInput,
  ProviderGroupListResponse,
  ProviderGroupResponse,
  ProviderGroupUpdateInput,
} from "@/lib/api/v1/schemas/provider-groups";
import type { ApiError } from "@/lib/api-client/v1/client";
import { callLegacyAction, type LegacyActionResult } from "@/lib/api-client/v1/legacy-action";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

import { providerGroupsClient } from "./index";
import { providerGroupsKeys } from "./keys";

export function useProviderGroupsList(): UseQueryResult<
  ProviderGroupListResponse,
  ApiError | Error
> {
  return useQuery<ProviderGroupListResponse, ApiError | Error>({
    queryKey: providerGroupsKeys.list(),
    queryFn: () => providerGroupsClient.list(),
  });
}

export function useCreateProviderGroup() {
  return useApiMutation<ProviderGroupCreateInput, ProviderGroupResponse>({
    mutationFn: (input) => providerGroupsClient.create(input),
    invalidates: [providerGroupsKeys.all],
  });
}

export function useUpdateProviderGroup(id: number) {
  return useApiMutation<ProviderGroupUpdateInput, ProviderGroupResponse>({
    mutationFn: (patch) => providerGroupsClient.update(id, patch),
    invalidates: [providerGroupsKeys.all],
  });
}

export function useDeleteProviderGroup(id: number) {
  return useApiMutation<void, void>({
    mutationFn: () => providerGroupsClient.remove(id),
    invalidates: [providerGroupsKeys.all],
  });
}

// ==================== Legacy bridges ====================
// The legacy actions return `ActionResult<T>` and include richer metadata
// (counts, validation errors) than the typed v1 client today. Until the v1
// shapes are upgraded these shims preserve the legacy semantics callers expect.

/** TODO: replace once /api/v1/provider-groups GET returns enriched group counts. */
export function callGetProviderGroups<TData>(): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("provider-groups", "getProviderGroups", {});
}

/** TODO: replace once /api/v1/provider-groups POST returns the legacy result shape. */
export function callCreateProviderGroup<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("provider-groups", "createProviderGroup", args);
}

/** TODO: replace once /api/v1/provider-groups/{id} PATCH returns the legacy result shape. */
export function callUpdateProviderGroup<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("provider-groups", "updateProviderGroup", args);
}

/** TODO: replace once /api/v1/provider-groups/{id} DELETE returns the legacy result shape. */
export function callDeleteProviderGroup<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("provider-groups", "deleteProviderGroup", args);
}
