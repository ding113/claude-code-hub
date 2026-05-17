"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ProviderCreateInput,
  ProviderListQuery,
  ProviderSummaryResponse,
  ProviderUpdateInput,
} from "@/lib/api/v1/schemas/providers";
import { apiClient } from "@/lib/api-client/v1/client";
import { v1Keys } from "@/lib/api-client/v1/keys";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

type ProviderListResponse = { items: ProviderSummaryResponse[] };

function toSearchParams(params?: ProviderListQuery): string {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.providerType) search.set("providerType", params.providerType);
  if (params?.include) search.set("include", params.include);
  const value = search.toString();
  return value ? `?${value}` : "";
}

export function useProviders(params?: ProviderListQuery) {
  return useQuery({
    queryKey: v1Keys.providers.list(params),
    queryFn: () =>
      apiClient.get<ProviderListResponse>(`/api/v1/providers${toSearchParams(params)}`),
  });
}

export function useProvider(id: number) {
  return useQuery({
    queryKey: v1Keys.providers.detail(id),
    queryFn: () => apiClient.get<ProviderSummaryResponse>(`/api/v1/providers/${id}`),
    enabled: Number.isFinite(id) && id > 0,
  });
}

export function useCreateProvider() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input: ProviderCreateInput) =>
      apiClient.post<ProviderSummaryResponse>("/api/v1/providers", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.providers.all }),
  });
}

export function useUpdateProvider(id: number) {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input: ProviderUpdateInput) =>
      apiClient.patch<ProviderSummaryResponse>(`/api/v1/providers/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.providers.all }),
  });
}

export function useDeleteProvider() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (id: number) => apiClient.delete<void>(`/api/v1/providers/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.providers.all }),
  });
}

export function revealProviderKey(id: number): Promise<{ key: string }> {
  return apiClient.get<{ key: string }>(`/api/v1/providers/${id}/key:reveal`, {
    cache: "no-store",
  });
}
