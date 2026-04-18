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
    // 禁用本地缓存：每次打开 IP 详情都强制拉取最新数据，服务端已有缓存
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
}
