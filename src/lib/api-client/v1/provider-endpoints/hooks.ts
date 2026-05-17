"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ProviderEndpointCreateInput,
  ProviderEndpointProbeInput,
  ProviderEndpointUpdateInput,
  ProviderVendorUpdateInput,
} from "@/lib/api/v1/schemas/provider-endpoints";
import { apiClient } from "@/lib/api-client/v1/client";
import { v1Keys } from "@/lib/api-client/v1/keys";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

function toQuery(params?: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function useProviderVendors(params?: { dashboard?: boolean }) {
  return useQuery({
    queryKey: v1Keys.providerEndpoints.vendors(params),
    queryFn: () => apiClient.get(`/api/v1/provider-vendors${toQuery(params)}`),
  });
}

export function useProviderVendor(vendorId: number) {
  return useQuery({
    queryKey: v1Keys.providerEndpoints.vendor(vendorId),
    queryFn: () => apiClient.get(`/api/v1/provider-vendors/${vendorId}`),
  });
}

export function useProviderVendorEndpoints(
  vendorId: number,
  params?: { providerType?: string; dashboard?: boolean }
) {
  return useQuery({
    queryKey: v1Keys.providerEndpoints.endpoints(vendorId, params),
    queryFn: () =>
      apiClient.get(`/api/v1/provider-vendors/${vendorId}/endpoints${toQuery(params)}`),
  });
}

export function useUpdateProviderVendor(vendorId: number) {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input: ProviderVendorUpdateInput) =>
      apiClient.patch(`/api/v1/provider-vendors/${vendorId}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.providerEndpoints.all }),
  });
}

export function useDeleteProviderVendor() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (vendorId: number) => apiClient.delete(`/api/v1/provider-vendors/${vendorId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.providerEndpoints.all }),
  });
}

export function useCreateProviderEndpoint(vendorId: number) {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input: ProviderEndpointCreateInput) =>
      apiClient.post(`/api/v1/provider-vendors/${vendorId}/endpoints`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.providerEndpoints.all }),
  });
}

export function useUpdateProviderEndpoint(endpointId: number) {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input: ProviderEndpointUpdateInput) =>
      apiClient.patch(`/api/v1/provider-endpoints/${endpointId}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.providerEndpoints.all }),
  });
}

export function useDeleteProviderEndpoint() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (endpointId: number) =>
      apiClient.delete(`/api/v1/provider-endpoints/${endpointId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.providerEndpoints.all }),
  });
}

export function useProbeProviderEndpoint(endpointId: number) {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input?: ProviderEndpointProbeInput) =>
      apiClient.post(`/api/v1/provider-endpoints/${endpointId}:probe`, input ?? {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.providerEndpoints.all }),
  });
}
