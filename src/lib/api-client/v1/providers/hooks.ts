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
  ProviderModelSuggestionsResponse,
  ProviderResponse,
  ProviderUpdateInput,
} from "@/lib/api/v1/schemas/providers";
import type { ApiError } from "@/lib/api-client/v1/client";
import { callLegacyAction, type LegacyActionResult } from "@/lib/api-client/v1/legacy-action";
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

/**
 * Returns deduplicated allowedModels from enabled providers in the given group.
 * GET /api/v1/providers/model-suggestions?providerGroup=...
 */
export function useModelSuggestionsByProviderGroup(
  providerGroup?: string | null
): UseQueryResult<ProviderModelSuggestionsResponse, ApiError | Error> {
  return useQuery<ProviderModelSuggestionsResponse, ApiError | Error>({
    queryKey: providersKeys.modelSuggestions(providerGroup),
    queryFn: () => providersClient.modelSuggestions(providerGroup),
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

// ==================== Dev-tooling bridges (legacy) ====================
// Each helper below wraps `/api/actions/providers/<action>` because the
// equivalent v1 endpoint has not yet shipped. They MUST be migrated to
// `/api/v1/providers:test*` / `/api/v1/providers:simulate*` when those land.

export interface ProviderProxyTestArgs {
  providerUrl: string;
  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean;
}

export interface ProviderProxyTestData {
  success: boolean;
  message: string;
  details?: {
    statusCode?: number;
    responseTime?: number;
    usedProxy?: boolean;
    proxyUrl?: string;
    error?: string;
    errorType?: string;
  };
}

/** TODO: replace once /api/v1/providers:testProxy lands. */
export function callProviderProxyTest(
  args: ProviderProxyTestArgs
): Promise<LegacyActionResult<ProviderProxyTestData>> {
  return callLegacyAction("providers", "testProviderProxy", args);
}

/** TODO: replace once /api/v1/providers:testGemini lands. */
export function callProviderGeminiTest<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("providers", "testProviderGemini", args);
}

/** TODO: replace once /api/v1/providers:testUnified lands. */
export function callProviderUnifiedTest<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("providers", "testProviderUnified", args);
}

/** TODO: replace once /api/v1/providers:autoCluster lands. */
export function callRevendorProviders<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("providers", "autoClusterProvidersByVendor", args);
}

/** TODO: replace once /api/v1/providers:reclusterPreview lands. */
export function callReclusterPreview<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("providers", "previewVendorRecluster", args);
}

/** TODO: replace once /api/v1/providers/{id} PATCH covers legacy editProvider semantics. */
export function callEditProvider<TArgs, TData>(args: TArgs): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("providers", "editProvider", args);
}

/** TODO: replace once /api/v1/providers/{id}/key:reveal returns this exact shape. */
export function callGetUnmaskedProviderKey<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("providers", "getUnmaskedProviderKey", args);
}

/** TODO: replace once /api/v1/providers/{id} DELETE matches legacy soft-delete behaviour. */
export function callRemoveProvider<TArgs, TData>(args: TArgs): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("providers", "removeProvider", args);
}

/** TODO: replace once /api/v1/providers/{id}/circuit:reset returns this exact shape. */
export function callResetProviderCircuit<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("providers", "resetProviderCircuit", args);
}

/** TODO: replace once /api/v1/providers/{id}/usage:reset returns this exact shape. */
export function callResetProviderTotalUsage<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("providers", "resetProviderTotalUsage", args);
}

/** TODO: replace once /api/v1/providers/{id}/restore lands. */
export function callUndoProviderDelete<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("providers", "undoProviderDelete", args);
}

/** TODO: replace once /api/v1/providers:reclusterByVendor lands. */
export function callReclusterProviderVendors<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("providers", "reclusterProviderVendors", args);
}

/** TODO: replace once /api/v1/providers:fetchUpstreamModels lands. */
export function callFetchUpstreamModels<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("providers", "fetchUpstreamModels", args);
}

/** TODO: replace once /api/v1/providers/full-list lands (full provider listing). */
export function callGetProviders<TData>(): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("providers", "getProviders", {});
}

/** TODO: replace once /api/v1/providers POST returns the legacy result shape. */
export function callAddProvider<TArgs, TData>(args: TArgs): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("providers", "addProvider", args);
}

/** TODO: replace once /api/v1/providers/{id} PATCH returns the legacy undo metadata. */
export function callUndoProviderPatch<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("providers", "undoProviderPatch", args);
}

/** TODO: replace once /api/v1/providers:previewBatchPatch lands. */
export function callPreviewProviderBatchPatch<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("providers", "previewProviderBatchPatch", args);
}

/** TODO: replace once /api/v1/providers:applyBatchPatch lands. */
export function callApplyProviderBatchPatch<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("providers", "applyProviderBatchPatch", args);
}

/** TODO: replace once /api/v1/providers:batchDelete lands. */
export function callBatchDeleteProviders<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("providers", "batchDeleteProviders", args);
}

/** TODO: replace once /api/v1/providers:batchResetCircuits returns the legacy result shape. */
export function callBatchResetProviderCircuits<TArgs, TData>(
  args: TArgs
): Promise<LegacyActionResult<TData>> {
  return callLegacyAction("providers", "batchResetProviderCircuits", args);
}
