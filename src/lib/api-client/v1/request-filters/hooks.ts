"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  RequestFilterCreateInput,
  RequestFilterResponse,
  RequestFilterUpdateInput,
} from "@/lib/api/v1/schemas/request-filters";
import { apiClient } from "@/lib/api-client/v1/client";
import { v1Keys } from "@/lib/api-client/v1/keys";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

type RequestFilterListResponse = { items: RequestFilterResponse[] };
type ProviderOptionsResponse = { items: Array<{ id: number; name: string }> };
type GroupOptionsResponse = { items: string[] };

export function useRequestFilters() {
  return useQuery({
    queryKey: v1Keys.requestFilters.list(),
    queryFn: () => apiClient.get<RequestFilterListResponse>("/api/v1/request-filters"),
  });
}

export function useCreateRequestFilter() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input: RequestFilterCreateInput) =>
      apiClient.post<RequestFilterResponse>("/api/v1/request-filters", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.requestFilters.all }),
  });
}

export function useUpdateRequestFilter() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: ({ id, input }: { id: number; input: RequestFilterUpdateInput }) =>
      apiClient.patch<RequestFilterResponse>(`/api/v1/request-filters/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.requestFilters.all }),
  });
}

export function useDeleteRequestFilter() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (id: number) => apiClient.delete<void>(`/api/v1/request-filters/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.requestFilters.all }),
  });
}

export function useRefreshRequestFiltersCache() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: () => apiClient.post<{ count: number }>("/api/v1/request-filters/cache:refresh"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.requestFilters.all }),
  });
}

export function useRequestFilterProviderOptions() {
  return useQuery({
    queryKey: v1Keys.requestFilters.providerOptions(),
    queryFn: () =>
      apiClient.get<ProviderOptionsResponse>("/api/v1/request-filters/options/providers"),
  });
}

export function useRequestFilterGroupOptions() {
  return useQuery({
    queryKey: v1Keys.requestFilters.groupOptions(),
    queryFn: () => apiClient.get<GroupOptionsResponse>("/api/v1/request-filters/options/groups"),
  });
}
