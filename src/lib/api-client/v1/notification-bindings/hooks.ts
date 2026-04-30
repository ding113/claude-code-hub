"use client";

/**
 * /api/v1/notifications/types/{type}/bindings TanStack Query hooks
 */

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type {
  NotificationBindingListResponse,
  NotificationBindingsUpdateInput,
} from "@/lib/api/v1/schemas/notification-bindings";
import type { ApiError } from "@/lib/api-client/v1/client";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";
import type { NotificationType } from "@/repository/notification-bindings";

import { notificationBindingsClient } from "./index";
import { notificationBindingsKeys } from "./keys";

export function useNotificationBindings(
  type: NotificationType
): UseQueryResult<NotificationBindingListResponse, ApiError | Error> {
  return useQuery<NotificationBindingListResponse, ApiError | Error>({
    queryKey: notificationBindingsKeys.list(type),
    queryFn: () => notificationBindingsClient.list(type),
    enabled: !!type,
  });
}

export function useUpdateNotificationBindings(type: NotificationType) {
  return useApiMutation<NotificationBindingsUpdateInput, NotificationBindingListResponse>({
    mutationFn: (input) => notificationBindingsClient.update(type, input),
    invalidates: [notificationBindingsKeys.all],
  });
}
