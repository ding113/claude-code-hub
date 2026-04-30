"use client";

/**
 * /api/v1/error-rules TanStack Query hooks
 */

import type { z } from "@hono/zod-openapi";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type {
  ErrorRuleCreateSchema,
  ErrorRuleSchema,
  ErrorRulesCacheRefreshResponseSchema,
  ErrorRulesCacheStatsResponseSchema,
  ErrorRulesListResponseSchema,
  ErrorRuleTestRequestSchema,
  ErrorRuleTestResponseSchema,
  ErrorRuleUpdateSchema,
} from "@/lib/api/v1/schemas/error-rules";
import type { ApiError } from "@/lib/api-client/v1/client";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

import { errorRulesClient } from "./index";
import { errorRulesKeys } from "./keys";

type ErrorRule = z.infer<typeof ErrorRuleSchema>;
type ErrorRulesListResponse = z.infer<typeof ErrorRulesListResponseSchema>;
type ErrorRuleCreateInput = z.infer<typeof ErrorRuleCreateSchema>;
type ErrorRuleUpdateInput = z.infer<typeof ErrorRuleUpdateSchema>;
type ErrorRuleTestRequest = z.infer<typeof ErrorRuleTestRequestSchema>;
type ErrorRuleTestResponse = z.infer<typeof ErrorRuleTestResponseSchema>;
type ErrorRulesCacheRefreshResponse = z.infer<typeof ErrorRulesCacheRefreshResponseSchema>;
type ErrorRulesCacheStatsResponse = z.infer<typeof ErrorRulesCacheStatsResponseSchema>;

// ==================== 查询 ====================

export function useErrorRulesList(): UseQueryResult<ErrorRulesListResponse, ApiError | Error> {
  return useQuery<ErrorRulesListResponse, ApiError | Error>({
    queryKey: errorRulesKeys.list(),
    queryFn: () => errorRulesClient.list(),
  });
}

export function useErrorRulesCacheStats(): UseQueryResult<
  ErrorRulesCacheStatsResponse,
  ApiError | Error
> {
  return useQuery<ErrorRulesCacheStatsResponse, ApiError | Error>({
    queryKey: errorRulesKeys.cacheStats(),
    queryFn: () => errorRulesClient.cacheStats(),
  });
}

// ==================== 变更 ====================

export function useCreateErrorRule() {
  return useApiMutation<ErrorRuleCreateInput, ErrorRule>({
    mutationFn: (input) => errorRulesClient.create(input),
    invalidates: [errorRulesKeys.all],
  });
}

export function useUpdateErrorRule(id: number) {
  return useApiMutation<ErrorRuleUpdateInput, ErrorRule>({
    mutationFn: (patch) => errorRulesClient.update(id, patch),
    invalidates: [errorRulesKeys.all],
  });
}

export function useDeleteErrorRule(id: number) {
  return useApiMutation<void, void>({
    mutationFn: () => errorRulesClient.remove(id),
    invalidates: [errorRulesKeys.all],
  });
}

export function useRefreshErrorRulesCache() {
  return useApiMutation<void, ErrorRulesCacheRefreshResponse>({
    mutationFn: () => errorRulesClient.refreshCache(),
    invalidates: [errorRulesKeys.all],
  });
}

export function useTestErrorRule() {
  return useApiMutation<ErrorRuleTestRequest, ErrorRuleTestResponse>({
    mutationFn: (input) => errorRulesClient.test(input),
    invalidates: [],
  });
}
