"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  WebhookTargetCreateInput,
  WebhookTargetResponse,
  WebhookTargetUpdateInput,
} from "@/lib/api/v1/schemas/webhook-targets";
import { apiClient } from "@/lib/api-client/v1/client";
import { v1Keys } from "@/lib/api-client/v1/keys";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

type ListResponse = { items: WebhookTargetResponse[] };

export function useWebhookTargets() {
  return useQuery({
    queryKey: v1Keys.webhookTargets.list(),
    queryFn: () => apiClient.get<ListResponse>("/api/v1/webhook-targets"),
  });
}

export function useCreateWebhookTarget() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input: WebhookTargetCreateInput) =>
      apiClient.post<WebhookTargetResponse>("/api/v1/webhook-targets", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.webhookTargets.all }),
  });
}

export function useUpdateWebhookTarget(id: number) {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input: WebhookTargetUpdateInput) =>
      apiClient.patch<WebhookTargetResponse>(`/api/v1/webhook-targets/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.webhookTargets.all }),
  });
}

export function useDeleteWebhookTarget() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (id: number) => apiClient.delete<void>(`/api/v1/webhook-targets/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.webhookTargets.all }),
  });
}

export function useTestWebhookTarget(id: number) {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (notificationType: string) =>
      apiClient.post<{ latencyMs: number }>(`/api/v1/webhook-targets/${id}:test`, {
        notificationType,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.webhookTargets.all }),
  });
}
