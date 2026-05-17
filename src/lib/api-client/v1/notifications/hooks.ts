"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  NotificationBindingResponse,
  NotificationBindingUpdateInput,
  NotificationSettingsResponse,
  NotificationSettingsUpdateInput,
} from "@/lib/api/v1/schemas/notifications";
import { apiClient } from "@/lib/api-client/v1/client";
import { v1Keys } from "@/lib/api-client/v1/keys";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

type NotificationBindingListResponse = { items: NotificationBindingResponse[] };

export function useNotificationSettings() {
  return useQuery({
    queryKey: v1Keys.notifications.settings(),
    queryFn: () => apiClient.get<NotificationSettingsResponse>("/api/v1/notifications/settings"),
  });
}

export function useUpdateNotificationSettings() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input: NotificationSettingsUpdateInput) =>
      apiClient.put<NotificationSettingsResponse>("/api/v1/notifications/settings", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.notifications.all }),
  });
}

export function useTestNotificationWebhook() {
  return useApiMutation({
    mutationFn: (input: { webhookUrl: string; type: string }) =>
      apiClient.post<{ success: boolean; error?: string }>(
        "/api/v1/notifications/test-webhook",
        input
      ),
  });
}

export function useNotificationBindings(type: string) {
  return useQuery({
    queryKey: v1Keys.notifications.bindings(type),
    queryFn: () =>
      apiClient.get<NotificationBindingListResponse>(
        `/api/v1/notifications/types/${type}/bindings`
      ),
    enabled: type.length > 0,
  });
}

export function useUpdateNotificationBindings(type: string) {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input: NotificationBindingUpdateInput) =>
      apiClient.put<void>(`/api/v1/notifications/types/${type}/bindings`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.notifications.all }),
  });
}
