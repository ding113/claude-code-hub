"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  SystemSettingsResponse,
  SystemSettingsUpdateInput,
  SystemTimezoneResponse,
} from "@/lib/api/v1/schemas/system-config";
import { apiClient } from "@/lib/api-client/v1/client";
import { v1Keys } from "@/lib/api-client/v1/keys";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

export function useSystemSettings() {
  return useQuery({
    queryKey: v1Keys.system.settings(),
    queryFn: () => apiClient.get<SystemSettingsResponse>("/api/v1/system/settings"),
  });
}

export function useUpdateSystemSettings() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input: SystemSettingsUpdateInput) =>
      apiClient.put<SystemSettingsResponse>("/api/v1/system/settings", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.system.all }),
  });
}

export function useSystemTimezone() {
  return useQuery({
    queryKey: v1Keys.system.timezone(),
    queryFn: () => apiClient.get<SystemTimezoneResponse>("/api/v1/system/timezone"),
  });
}
