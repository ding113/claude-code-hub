"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ModelPriceListQuery,
  ModelPriceOverwriteInput,
  ModelPricePinRequest,
  ModelPriceUploadInput,
  SingleModelPriceInput,
} from "@/lib/api/v1/schemas/model-prices";
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

export function useModelPrices(params?: ModelPriceListQuery) {
  return useQuery({
    queryKey: v1Keys.modelPrices.list(params),
    queryFn: () => apiClient.get(`/api/v1/model-prices${toQuery(params)}`),
  });
}

export function useModelPriceCatalog(params?: { scope?: "chat" | "all" }) {
  return useQuery({
    queryKey: v1Keys.modelPrices.catalog(params),
    queryFn: () => apiClient.get(`/api/v1/model-prices/catalog${toQuery(params)}`),
  });
}

export function useHasModelPrices() {
  return useQuery({
    queryKey: v1Keys.modelPrices.exists(),
    queryFn: () => apiClient.get("/api/v1/model-prices/exists"),
  });
}

export function useUploadModelPrices() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input: ModelPriceUploadInput) =>
      apiClient.post("/api/v1/model-prices:upload", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.modelPrices.all }),
  });
}

export function useCheckLiteLlmSync() {
  return useApiMutation({
    mutationFn: () => apiClient.post("/api/v1/model-prices:syncLitellmCheck"),
  });
}

export function useSyncLiteLlmPrices() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input?: ModelPriceOverwriteInput) =>
      apiClient.post("/api/v1/model-prices:syncLitellm", input ?? {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.modelPrices.all }),
  });
}

export function useUpsertModelPrice() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input: SingleModelPriceInput) =>
      apiClient.put(`/api/v1/model-prices/${encodeURIComponent(input.modelName)}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.modelPrices.all }),
  });
}

export function useDeleteModelPrice() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (modelName: string) =>
      apiClient.delete(`/api/v1/model-prices/${encodeURIComponent(modelName)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.modelPrices.all }),
  });
}

export function usePinModelPriceProvider(modelName: string) {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input: ModelPricePinRequest) =>
      apiClient.post(
        `/api/v1/model-prices/${encodeURIComponent(modelName)}/pricing:pinManual`,
        input
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.modelPrices.all }),
  });
}
