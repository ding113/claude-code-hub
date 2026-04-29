"use client";

/**
 * /api/v1/model-prices TanStack Query hooks
 */

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type {
  ModelPriceCatalogResponse,
  ModelPriceListResponse,
  ModelPriceResponse,
  ModelPriceSyncInput,
  ModelPriceUpdateResult,
  ModelPriceUploadInput,
  SingleModelPriceUpsertInput,
  SyncConflictCheckResponse,
} from "@/lib/api/v1/schemas/model-prices";
import type { ApiError } from "@/lib/api-client/v1/client";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

import { modelPricesClient } from "./index";
import { modelPricesKeys } from "./keys";

// ==================== 查询 ====================

export function useModelPricesList(params?: {
  page?: number;
  limit?: number;
  q?: string;
}): UseQueryResult<ModelPriceListResponse, ApiError | Error> {
  return useQuery<ModelPriceListResponse, ApiError | Error>({
    queryKey: modelPricesKeys.list(params),
    queryFn: () => modelPricesClient.list(params),
  });
}

export function useModelPricesExists(): UseQueryResult<{ exists: boolean }, ApiError | Error> {
  return useQuery<{ exists: boolean }, ApiError | Error>({
    queryKey: modelPricesKeys.exists(),
    queryFn: () => modelPricesClient.exists(),
  });
}

export function useModelPricesCatalog(
  scope?: "chat" | "all"
): UseQueryResult<ModelPriceCatalogResponse, ApiError | Error> {
  return useQuery<ModelPriceCatalogResponse, ApiError | Error>({
    queryKey: modelPricesKeys.catalog(scope),
    queryFn: () => modelPricesClient.catalog(scope),
  });
}

export function useModelPriceDetail(
  modelName: string
): UseQueryResult<ModelPriceResponse, ApiError | Error> {
  return useQuery<ModelPriceResponse, ApiError | Error>({
    queryKey: modelPricesKeys.detail(modelName),
    queryFn: () => modelPricesClient.detail(modelName),
    enabled: !!modelName,
  });
}

// ==================== 变更 ====================

export function useUploadModelPrices() {
  return useApiMutation<ModelPriceUploadInput, ModelPriceUpdateResult>({
    mutationFn: (input) => modelPricesClient.upload(input),
    invalidates: [modelPricesKeys.all],
  });
}

export function useSyncLitellmCheck() {
  return useApiMutation<void, SyncConflictCheckResponse>({
    mutationFn: () => modelPricesClient.syncLitellmCheck(),
    invalidates: [],
  });
}

export function useSyncLitellm() {
  return useApiMutation<ModelPriceSyncInput | void, ModelPriceUpdateResult>({
    mutationFn: (input) => modelPricesClient.syncLitellm(input ?? undefined),
    invalidates: [modelPricesKeys.all],
  });
}

export function useUpsertModelPrice(modelName: string) {
  return useApiMutation<SingleModelPriceUpsertInput, ModelPriceResponse>({
    mutationFn: (input) => modelPricesClient.upsert(modelName, input),
    invalidates: [modelPricesKeys.all],
  });
}

export function useDeleteModelPrice(modelName: string) {
  return useApiMutation<void, void>({
    mutationFn: () => modelPricesClient.remove(modelName),
    invalidates: [modelPricesKeys.all],
  });
}

export function usePinModelPricingProvider(modelName: string) {
  return useApiMutation<{ providerType: string }, ModelPriceResponse>({
    mutationFn: ({ providerType }) => modelPricesClient.pinManual(modelName, providerType),
    invalidates: [modelPricesKeys.all],
  });
}
