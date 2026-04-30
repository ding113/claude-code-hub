"use client";

/**
 * /api/v1/request-filters TanStack Query hooks
 */

import type { z } from "@hono/zod-openapi";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type {
  RequestFilterCreateSchema,
  RequestFilterSchema,
  RequestFiltersCacheRefreshResponseSchema,
  RequestFiltersGroupOptionsResponseSchema,
  RequestFiltersListResponseSchema,
  RequestFiltersProviderOptionsResponseSchema,
  RequestFilterUpdateSchema,
} from "@/lib/api/v1/schemas/request-filters";
import type { ApiError } from "@/lib/api-client/v1/client";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

import { requestFiltersClient } from "./index";
import { requestFiltersKeys } from "./keys";

type RequestFilter = z.infer<typeof RequestFilterSchema>;
type RequestFiltersListResponse = z.infer<typeof RequestFiltersListResponseSchema>;
type RequestFilterCreateInput = z.infer<typeof RequestFilterCreateSchema>;
type RequestFilterUpdateInput = z.infer<typeof RequestFilterUpdateSchema>;
type RequestFiltersCacheRefreshResponse = z.infer<typeof RequestFiltersCacheRefreshResponseSchema>;
type RequestFiltersProviderOptionsResponse = z.infer<
  typeof RequestFiltersProviderOptionsResponseSchema
>;
type RequestFiltersGroupOptionsResponse = z.infer<typeof RequestFiltersGroupOptionsResponseSchema>;

// ==================== 查询 ====================

export function useRequestFiltersList(): UseQueryResult<
  RequestFiltersListResponse,
  ApiError | Error
> {
  return useQuery<RequestFiltersListResponse, ApiError | Error>({
    queryKey: requestFiltersKeys.list(),
    queryFn: () => requestFiltersClient.list(),
  });
}

export function useRequestFilterProviderOptions(): UseQueryResult<
  RequestFiltersProviderOptionsResponse,
  ApiError | Error
> {
  return useQuery<RequestFiltersProviderOptionsResponse, ApiError | Error>({
    queryKey: requestFiltersKeys.providerOptions(),
    queryFn: () => requestFiltersClient.providerOptions(),
  });
}

export function useRequestFilterGroupOptions(): UseQueryResult<
  RequestFiltersGroupOptionsResponse,
  ApiError | Error
> {
  return useQuery<RequestFiltersGroupOptionsResponse, ApiError | Error>({
    queryKey: requestFiltersKeys.groupOptions(),
    queryFn: () => requestFiltersClient.groupOptions(),
  });
}

// ==================== 变更 ====================

export function useCreateRequestFilter() {
  return useApiMutation<RequestFilterCreateInput, RequestFilter>({
    mutationFn: (input) => requestFiltersClient.create(input),
    invalidates: [requestFiltersKeys.all],
  });
}

export function useUpdateRequestFilter(id: number) {
  return useApiMutation<RequestFilterUpdateInput, RequestFilter>({
    mutationFn: (patch) => requestFiltersClient.update(id, patch),
    invalidates: [requestFiltersKeys.all],
  });
}

export function useDeleteRequestFilter(id: number) {
  return useApiMutation<void, void>({
    mutationFn: () => requestFiltersClient.remove(id),
    invalidates: [requestFiltersKeys.all],
  });
}

export function useRefreshRequestFiltersCache() {
  return useApiMutation<void, RequestFiltersCacheRefreshResponse>({
    mutationFn: () => requestFiltersClient.refreshCache(),
    invalidates: [requestFiltersKeys.all],
  });
}
