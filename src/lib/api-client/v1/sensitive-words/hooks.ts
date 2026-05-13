"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  SensitiveWordCreateInput,
  SensitiveWordResponse,
  SensitiveWordUpdateInput,
} from "@/lib/api/v1/schemas/sensitive-words";
import { apiClient } from "@/lib/api-client/v1/client";
import { v1Keys } from "@/lib/api-client/v1/keys";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

type SensitiveWordListResponse = { items: SensitiveWordResponse[] };

export function useSensitiveWords() {
  return useQuery({
    queryKey: v1Keys.sensitiveWords.list(),
    queryFn: () => apiClient.get<SensitiveWordListResponse>("/api/v1/sensitive-words"),
  });
}

export function useCreateSensitiveWord() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input: SensitiveWordCreateInput) =>
      apiClient.post<SensitiveWordResponse>("/api/v1/sensitive-words", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.sensitiveWords.all }),
  });
}

export function useUpdateSensitiveWord() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: ({ id, input }: { id: number; input: SensitiveWordUpdateInput }) =>
      apiClient.patch<SensitiveWordResponse>(`/api/v1/sensitive-words/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.sensitiveWords.all }),
  });
}

export function useDeleteSensitiveWord() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (id: number) => apiClient.delete<void>(`/api/v1/sensitive-words/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.sensitiveWords.all }),
  });
}

export function useRefreshSensitiveWordsCache() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: () =>
      apiClient.post<{ stats: Record<string, unknown> }>("/api/v1/sensitive-words/cache:refresh"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.sensitiveWords.all }),
  });
}

export function useSensitiveWordsCacheStats() {
  return useQuery({
    queryKey: v1Keys.sensitiveWords.cacheStats(),
    queryFn: () => apiClient.get<Record<string, unknown>>("/api/v1/sensitive-words/cache/stats"),
  });
}
