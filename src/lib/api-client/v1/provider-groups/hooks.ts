"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ProviderGroupCreateInput,
  ProviderGroupResponse,
  ProviderGroupUpdateInput,
} from "@/lib/api/v1/schemas/provider-groups";
import { apiClient } from "@/lib/api-client/v1/client";
import { v1Keys } from "@/lib/api-client/v1/keys";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

type ListResponse = { items: ProviderGroupResponse[] };

export function useProviderGroups() {
  return useQuery({
    queryKey: v1Keys.providerGroups.list(),
    queryFn: () => apiClient.get<ListResponse>("/api/v1/provider-groups"),
  });
}

export function useCreateProviderGroup() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input: ProviderGroupCreateInput) =>
      apiClient.post<ProviderGroupResponse>("/api/v1/provider-groups", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.providerGroups.all }),
  });
}

export function useUpdateProviderGroup(id: number) {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input: ProviderGroupUpdateInput) =>
      apiClient.patch<ProviderGroupResponse>(`/api/v1/provider-groups/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.providerGroups.all }),
  });
}

export function useDeleteProviderGroup() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (id: number) => apiClient.delete<void>(`/api/v1/provider-groups/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.providerGroups.all }),
  });
}
