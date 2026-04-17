"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import type { IpGeoLookupResponse } from "@/types/ip-geo";

export function useIpGeo(ip: string | null | undefined) {
  // Pass the dashboard UI locale to the upstream so country / city names come
  // back localized rather than always in English.
  const locale = useLocale();
  return useQuery<IpGeoLookupResponse>({
    queryKey: ["ip-geo", ip, locale],
    queryFn: async () => {
      if (!ip) throw new Error("no ip");
      const qs = new URLSearchParams({ lang: locale });
      const response = await fetch(`/api/ip-geo/${encodeURIComponent(ip)}?${qs}`);
      if (!response.ok) throw new Error(`ip-geo fetch failed: ${response.status}`);
      return (await response.json()) as IpGeoLookupResponse;
    },
    enabled: !!ip,
    staleTime: 60 * 60 * 1000, // 1h, matches server cache default
    gcTime: 24 * 60 * 60 * 1000,
    retry: false,
  });
}
