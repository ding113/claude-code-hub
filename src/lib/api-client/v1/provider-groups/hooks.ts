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
