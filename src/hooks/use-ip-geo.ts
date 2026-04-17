"use client";

import { useQuery } from "@tanstack/react-query";
import type { IpGeoLookupResponse } from "@/types/ip-geo";

export function useIpGeo(ip: string | null | undefined) {
  return useQuery<IpGeoLookupResponse>({
    queryKey: ["ip-geo", ip],
    queryFn: async () => {
      if (!ip) throw new Error("no ip");
      const response = await fetch(`/api/ip-geo/${encodeURIComponent(ip)}`);
      if (!response.ok) throw new Error(`ip-geo fetch failed: ${response.status}`);
      return (await response.json()) as IpGeoLookupResponse;
    },
    enabled: !!ip,
    staleTime: 60 * 60 * 1000, // 1h, matches server cache default
    gcTime: 24 * 60 * 60 * 1000,
    retry: false,
  });
}
