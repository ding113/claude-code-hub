/**
 * /api/v1/ip-geo 客户端查询键
 */

import { v1Keys } from "@/lib/api-client/v1/keys";

export const ipGeoKeys = {
  all: [...v1Keys.all, "ip-geo"] as const,
  detail: (ip: string, lang?: string) => [...ipGeoKeys.all, "detail", ip, lang ?? ""] as const,
};

export type IpGeoQueryKey = ReturnType<(typeof ipGeoKeys)[Exclude<keyof typeof ipGeoKeys, "all">]>;
