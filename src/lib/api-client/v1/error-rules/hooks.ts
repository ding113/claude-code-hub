"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ErrorRuleCreateInput,
  ErrorRuleResponse,
  ErrorRuleUpdateInput,
} from "@/lib/api/v1/schemas/error-rules";
import { apiClient } from "@/lib/api-client/v1/client";
import { v1Keys } from "@/lib/api-client/v1/keys";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

type ErrorRuleListResponse = { items: ErrorRuleResponse[] };
type ErrorRuleTestInput = { message: string };
type ErrorRuleTestResponse = {
  matched: boolean;
  finalResponse: Record<string, unknown> | null;
  finalStatusCode: number | null;
  warnings?: string[];
};

export function useErrorRules() {
  return useQuery({
    queryKey: v1Keys.errorRules.list(),
    queryFn: () => apiClient.get<ErrorRuleListResponse>("/api/v1/error-rules"),
  });
}

export function useCreateErrorRule() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input: ErrorRuleCreateInput) =>
      apiClient.post<ErrorRuleResponse>("/api/v1/error-rules", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.errorRules.all }),
  });
}

export function useUpdateErrorRule() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: ({ id, input }: { id: number; input: ErrorRuleUpdateInput }) =>
      apiClient.patch<ErrorRuleResponse>(`/api/v1/error-rules/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.errorRules.all }),
  });
}

export function useDeleteErrorRule() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (id: number) => apiClient.delete<void>(`/api/v1/error-rules/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.errorRules.all }),
  });
}

export function useRefreshErrorRulesCache() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: () =>
      apiClient.post<{
        stats: Record<string, unknown>;
        syncResult: { inserted: number; updated: number; skipped: number; deleted: number };
      }>("/api/v1/error-rules/cache:refresh"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.errorRules.all }),
  });
}

export function useErrorRulesCacheStats() {
  return useQuery({
    queryKey: v1Keys.errorRules.cacheStats(),
    queryFn: () => apiClient.get<Record<string, unknown>>("/api/v1/error-rules/cache/stats"),
  });
}

export function useTestErrorRule() {
  return useApiMutation({
    mutationFn: (input: ErrorRuleTestInput) =>
      apiClient.post<ErrorRuleTestResponse>("/api/v1/error-rules:test", input),
  });
}
