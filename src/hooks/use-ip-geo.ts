"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { getMyIpGeoDetails } from "@/lib/api-client/v1/actions/my-usage";
import type { IpGeoLookupResponse } from "@/types/ip-geo";

export type IpGeoLookupMode = "default" | "my-usage";

interface UseIpGeoOptions {
  mode?: IpGeoLookupMode;
}

export function useIpGeo(ip: string | null | undefined, options?: UseIpGeoOptions) {
  // Pass the dashboard UI locale to the upstream so country / city names come
  // back localized rather than always in English.
  const locale = useLocale();
  const t = useTranslations("ipDetails");
  const mode = options?.mode ?? "default";
  return useQuery<IpGeoLookupResponse>({
    queryKey: ["ip-geo", mode, ip, locale],
    queryFn: async () => {
      if (!ip) throw new Error("no ip");

      if (mode === "my-usage") {
        const result = await getMyIpGeoDetails({ ip, lang: locale });
        if (!result.ok) {
          return { status: "error", error: result.error ?? t("error") };
        }
        return result.data;
      }

      const qs = new URLSearchParams({ lang: locale });
      const response = await fetch(`/api/ip-geo/${encodeURIComponent(ip)}?${qs}`);
      if (!response.ok) throw new Error(t("error"));
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
