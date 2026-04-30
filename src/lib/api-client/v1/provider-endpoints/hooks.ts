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
import { callLegacyAction, type LegacyActionResult } from "@/lib/api-client/v1/legacy-action";
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

// ==================== Legacy bridges ====================
// The legacy server actions still cover several screens that are not yet on
// the v1 surface (notably `getProviderEndpoints` aggregation, vendor-grouped
// listings, batch circuit fetches and probe-history pulls). These shims wrap
// the legacy adapter so client code can switch off `@/actions/*` today; each
// MUST be replaced when the corresponding v1 endpoint lands.

/** TODO: replace once /api/v1/provider-endpoints aggregated list lands. */
export function callGetProviderEndpoints<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("provider-endpoints", "getProviderEndpoints", args);
}

/** TODO: replace once /api/v1/provider-vendors/{id}/endpoints (vendor-grouped) lands. */
export function callGetProviderEndpointsByVendor<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("provider-endpoints", "getProviderEndpointsByVendor", args);
}

/** TODO: replace once /api/v1/provider-endpoints:batchCircuitInfo lands. */
export function callBatchGetEndpointCircuitInfo<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("provider-endpoints", "batchGetEndpointCircuitInfo", args);
}

/** TODO: replace once /api/v1/provider-vendors/{vendorId}/endpoints (POST) supports the legacy add semantics. */
export function callAddProviderEndpoint<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("provider-endpoints", "addProviderEndpoint", args);
}

/** TODO: replace once /api/v1/provider-endpoints/{id} PATCH parity is achieved. */
export function callEditProviderEndpoint<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("provider-endpoints", "editProviderEndpoint", args);
}

/** TODO: replace once /api/v1/provider-endpoints/{id}:probe is wired through the typed client. */
export function callProbeProviderEndpoint<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("provider-endpoints", "probeProviderEndpoint", args);
}

/** TODO: replace once /api/v1/provider-endpoints/{id} DELETE is wired through the typed client. */
export function callRemoveProviderEndpoint<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("provider-endpoints", "removeProviderEndpoint", args);
}

/** TODO: replace once /api/v1/provider-endpoints/{id}/circuit:reset is wired through the typed client. */
export function callResetEndpointCircuit<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("provider-endpoints", "resetEndpointCircuit", args);
}

/** TODO: replace once /api/v1/provider-endpoints/{id}/probe-logs is wired through the typed client. */
export function callGetEndpointProbeHistory<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("provider-endpoints", "getEndpointProbeHistory", args);
}

/** TODO: replace once /api/v1/provider-vendors:batchTypeStats lands. */
export function callBatchGetVendorTypeEndpointStats<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("provider-endpoints", "batchGetVendorTypeEndpointStats", args);
}

/** TODO: replace once /api/v1/dashboard/provider-vendors lands. */
export function callGetDashboardProviderVendors<TData>(): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("provider-endpoints", "getDashboardProviderVendors", {});
}

/** TODO: replace once /api/v1/dashboard/provider-endpoints lands. */
export function callGetDashboardProviderEndpoints<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("provider-endpoints", "getDashboardProviderEndpoints", args);
}

/** TODO: replace once /api/v1/provider-endpoints/{id}/probe-logs uses the typed v1 client. */
export function callGetProviderEndpointProbeLogs<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("provider-endpoints", "getProviderEndpointProbeLogs", args);
}
