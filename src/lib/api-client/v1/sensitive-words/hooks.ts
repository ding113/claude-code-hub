"use client";

/**
 * /api/v1/sensitive-words TanStack Query hooks
 */

import type { z } from "@hono/zod-openapi";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type {
  SensitiveWordCreateSchema,
  SensitiveWordSchema,
  SensitiveWordsCacheRefreshResponseSchema,
  SensitiveWordsCacheStatsResponseSchema,
  SensitiveWordsListResponseSchema,
  SensitiveWordUpdateSchema,
} from "@/lib/api/v1/schemas/sensitive-words";
import type { ApiError } from "@/lib/api-client/v1/client";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

import { sensitiveWordsClient } from "./index";
import { sensitiveWordsKeys } from "./keys";

type SensitiveWord = z.infer<typeof SensitiveWordSchema>;
type SensitiveWordsListResponse = z.infer<typeof SensitiveWordsListResponseSchema>;
type SensitiveWordCreateInput = z.infer<typeof SensitiveWordCreateSchema>;
type SensitiveWordUpdateInput = z.infer<typeof SensitiveWordUpdateSchema>;
type SensitiveWordsCacheRefreshResponse = z.infer<typeof SensitiveWordsCacheRefreshResponseSchema>;
type SensitiveWordsCacheStatsResponse = z.infer<typeof SensitiveWordsCacheStatsResponseSchema>;

// ==================== 查询 ====================

export function useSensitiveWordsList(): UseQueryResult<
  SensitiveWordsListResponse,
  ApiError | Error
> {
  return useQuery<SensitiveWordsListResponse, ApiError | Error>({
    queryKey: sensitiveWordsKeys.list(),
    queryFn: () => sensitiveWordsClient.list(),
  });
}

export function useSensitiveWordsCacheStats(): UseQueryResult<
  SensitiveWordsCacheStatsResponse,
  ApiError | Error
> {
  return useQuery<SensitiveWordsCacheStatsResponse, ApiError | Error>({
    queryKey: sensitiveWordsKeys.cacheStats(),
    queryFn: () => sensitiveWordsClient.cacheStats(),
  });
}

// ==================== 变更 ====================

export function useCreateSensitiveWord() {
  return useApiMutation<SensitiveWordCreateInput, SensitiveWord>({
    mutationFn: (input) => sensitiveWordsClient.create(input),
    invalidates: [sensitiveWordsKeys.all],
  });
}

export function useUpdateSensitiveWord(id: number) {
  return useApiMutation<SensitiveWordUpdateInput, SensitiveWord>({
    mutationFn: (patch) => sensitiveWordsClient.update(id, patch),
    invalidates: [sensitiveWordsKeys.all],
  });
}

export function useDeleteSensitiveWord(id: number) {
  return useApiMutation<void, void>({
    mutationFn: () => sensitiveWordsClient.remove(id),
    invalidates: [sensitiveWordsKeys.all],
  });
}

export function useRefreshSensitiveWordsCache() {
  return useApiMutation<void, SensitiveWordsCacheRefreshResponse>({
    mutationFn: () => sensitiveWordsClient.refreshCache(),
    invalidates: [sensitiveWordsKeys.all],
  });
}
