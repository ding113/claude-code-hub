"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  IpGeoLookupResponse,
  PublicStatusSettingsUpdateInput,
  PublicStatusSettingsUpdateResponse,
} from "@/lib/api/v1/schemas/public";
import { apiClient } from "@/lib/api-client/v1/client";
import { v1Keys } from "@/lib/api-client/v1/keys";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

export function usePublicStatus(params?: Record<string, string | number | boolean | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) query.set(key, String(value));
  }
  const suffix = query.toString();
  return useQuery({
    queryKey: v1Keys.publicStatus.current(params),
    queryFn: () =>
      apiClient.get<Record<string, unknown>>(
        suffix ? `/api/v1/public/status?${suffix}` : "/api/v1/public/status"
      ),
  });
}

export function useUpdatePublicStatusSettings() {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input: PublicStatusSettingsUpdateInput) =>
      apiClient.put<PublicStatusSettingsUpdateResponse>("/api/v1/public/status/settings", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: v1Keys.publicStatus.all }),
  });
}

export function useIpGeoLookup(ip: string, lang?: string) {
  const query = lang ? `?lang=${encodeURIComponent(lang)}` : "";
  return useQuery({
    queryKey: v1Keys.ipGeo.lookup(ip, lang),
    queryFn: () =>
      apiClient.get<IpGeoLookupResponse>(`/api/v1/ip-geo/${encodeURIComponent(ip)}${query}`),
    enabled: ip.length > 0,
  });
}
