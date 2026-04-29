"use client";

/**
 * /api/v1/system TanStack Query hooks
 */

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type {
  SystemSettingsResponse,
  SystemSettingsUpdateInput,
  SystemTimezoneResponse,
} from "@/lib/api/v1/schemas/system";
import type { ApiError } from "@/lib/api-client/v1/client";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

import { systemClient } from "./index";
import { systemKeys } from "./keys";

export function useSystemSettings(): UseQueryResult<SystemSettingsResponse, ApiError | Error> {
  return useQuery<SystemSettingsResponse, ApiError | Error>({
    queryKey: systemKeys.settings(),
    queryFn: () => systemClient.getSettings(),
  });
}

export function useSystemTimezone(): UseQueryResult<SystemTimezoneResponse, ApiError | Error> {
  return useQuery<SystemTimezoneResponse, ApiError | Error>({
    queryKey: systemKeys.timezone(),
    queryFn: () => systemClient.getTimezone(),
  });
}

export function useUpdateSystemSettings() {
  return useApiMutation<SystemSettingsUpdateInput, SystemSettingsResponse>({
    mutationFn: (input) => systemClient.updateSettings(input),
    invalidates: [systemKeys.all],
  });
}
