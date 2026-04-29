"use client";

/**
 * /api/v1/notifications TanStack Query hooks
 */

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type {
  NotificationSettingsResponse,
  NotificationSettingsUpdateInput,
  TestWebhookRequest,
  TestWebhookResponse,
} from "@/lib/api/v1/schemas/notifications";
import type { ApiError } from "@/lib/api-client/v1/client";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

import { notificationsClient } from "./index";
import { notificationsKeys } from "./keys";

export function useNotificationSettings(): UseQueryResult<
  NotificationSettingsResponse,
  ApiError | Error
> {
  return useQuery<NotificationSettingsResponse, ApiError | Error>({
    queryKey: notificationsKeys.settings(),
    queryFn: () => notificationsClient.getSettings(),
  });
}

export function useUpdateNotificationSettings() {
  return useApiMutation<NotificationSettingsUpdateInput, NotificationSettingsResponse>({
    mutationFn: (input) => notificationsClient.updateSettings(input),
    invalidates: [notificationsKeys.all],
  });
}

export function useTestWebhook() {
  return useApiMutation<TestWebhookRequest, TestWebhookResponse>({
    mutationFn: (input) => notificationsClient.testWebhook(input),
    invalidates: [],
  });
}
