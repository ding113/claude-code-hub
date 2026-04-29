"use client";

/**
 * /api/v1/provider-vendors + /api/v1/provider-endpoints TanStack Query hooks
 */

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type {
  ProviderEndpointCreateInput,
  ProviderEndpointListResponse,
  ProviderEndpointProbeInput,
  ProviderEndpointResponse,
  ProviderEndpointUpdateInput,
  ProviderVendorListResponse,
  ProviderVendorResponse,
  ProviderVendorUpdateInput,
} from "@/lib/api/v1/schemas/provider-endpoints";
import type { ApiError } from "@/lib/api-client/v1/client";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

import { providerEndpointsClient, providerVendorsClient } from "./index";
import { providerEndpointsKeys, providerVendorsKeys } from "./keys";

// ==================== Vendor queries ====================

export function useProviderVendorsList(params?: {
  dashboard?: boolean;
}): UseQueryResult<ProviderVendorListResponse, ApiError | Error> {
  return useQuery<ProviderVendorListResponse, ApiError | Error>({
    queryKey: providerVendorsKeys.list(params),
    queryFn: () => providerVendorsClient.list(params),
  });
}

export function useProviderVendorDetail(
  id: number
): UseQueryResult<ProviderVendorResponse, ApiError | Error> {
  return useQuery<ProviderVendorResponse, ApiError | Error>({
    queryKey: providerVendorsKeys.detail(id),
    queryFn: () => providerVendorsClient.detail(id),
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useEndpointsForVendor(
  vendorId: number,
  params?: { providerType?: string }
): UseQueryResult<ProviderEndpointListResponse, ApiError | Error> {
  return useQuery<ProviderEndpointListResponse, ApiError | Error>({
    queryKey: providerVendorsKeys.endpoints(vendorId, params),
    queryFn: () => providerVendorsClient.listEndpoints(vendorId, params),
    enabled: Number.isInteger(vendorId) && vendorId > 0,
  });
}

// ==================== Endpoint queries ====================

export function useEndpointProbeLogs(
  id: number,
  params?: { limit?: number; offset?: number }
): UseQueryResult<unknown, ApiError | Error> {
  return useQuery<unknown, ApiError | Error>({
    queryKey: providerEndpointsKeys.probeLogs(id, params),
    queryFn: () => providerEndpointsClient.probeLogs(id, params),
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useEndpointCircuitInfo(id: number): UseQueryResult<unknown, ApiError | Error> {
  return useQuery<unknown, ApiError | Error>({
    queryKey: providerEndpointsKeys.circuit(id),
    queryFn: () => providerEndpointsClient.circuit(id),
    enabled: Number.isInteger(id) && id > 0,
  });
}

// ==================== Mutations ====================

export function useUpdateProviderVendor(id: number) {
  return useApiMutation<ProviderVendorUpdateInput, ProviderVendorResponse>({
    mutationFn: (patch) => providerVendorsClient.update(id, patch),
    invalidates: [providerVendorsKeys.all],
  });
}

export function useDeleteProviderVendor(id: number) {
  return useApiMutation<void, void>({
    mutationFn: () => providerVendorsClient.remove(id),
    invalidates: [providerVendorsKeys.all],
  });
}

export function useCreateEndpointForVendor(vendorId: number) {
  return useApiMutation<ProviderEndpointCreateInput, ProviderEndpointResponse>({
    mutationFn: (input) => providerVendorsClient.createEndpoint(vendorId, input),
    invalidates: [providerVendorsKeys.all, providerEndpointsKeys.all],
  });
}

export function useUpdateProviderEndpoint(id: number) {
  return useApiMutation<ProviderEndpointUpdateInput, ProviderEndpointResponse>({
    mutationFn: (patch) => providerEndpointsClient.update(id, patch),
    invalidates: [providerVendorsKeys.all, providerEndpointsKeys.all],
  });
}

export function useDeleteProviderEndpoint(id: number) {
  return useApiMutation<void, void>({
    mutationFn: () => providerEndpointsClient.remove(id),
    invalidates: [providerVendorsKeys.all, providerEndpointsKeys.all],
  });
}

export function useProbeProviderEndpoint(id: number) {
  return useApiMutation<ProviderEndpointProbeInput | undefined, unknown>({
    mutationFn: (input) => providerEndpointsClient.probe(id, input),
    invalidates: [providerEndpointsKeys.all],
  });
}

export function useResetProviderEndpointCircuit(id: number) {
  return useApiMutation<void, { ok: boolean }>({
    mutationFn: () => providerEndpointsClient.resetCircuit(id),
    invalidates: [providerEndpointsKeys.all],
  });
}
