"use client";

/**
 * /api/v1/public/status TanStack Query hooks
 */

import type { z } from "@hono/zod-openapi";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type {
  PublicStatusResponseSchema,
  PublicStatusSettingsRequest,
  PublicStatusSettingsResponseSchema,
} from "@/lib/api/v1/schemas/public-status";
import type { ApiError } from "@/lib/api-client/v1/client";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

import { publicStatusClient } from "./index";
import { publicStatusKeys } from "./keys";

type PublicStatusResponse = z.infer<typeof PublicStatusResponseSchema>;
type PublicStatusSettingsResponse = z.infer<typeof PublicStatusSettingsResponseSchema>;

export function usePublicStatus(): UseQueryResult<PublicStatusResponse, ApiError | Error> {
  return useQuery<PublicStatusResponse, ApiError | Error>({
    queryKey: publicStatusKeys.status(),
    queryFn: () => publicStatusClient.get(),
  });
}

export function useUpdatePublicStatusSettings() {
  return useApiMutation<PublicStatusSettingsRequest, PublicStatusSettingsResponse>({
    mutationFn: (input) => publicStatusClient.updateSettings(input),
    invalidates: [publicStatusKeys.all],
  });
}
