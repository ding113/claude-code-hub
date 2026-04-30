"use client";

/**
 * /api/v1/ip-geo TanStack Query hooks
 */

import type { z } from "@hono/zod-openapi";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { IpGeoResponseSchema } from "@/lib/api/v1/schemas/ip-geo";
import type { ApiError } from "@/lib/api-client/v1/client";

import { ipGeoClient } from "./index";
import { ipGeoKeys } from "./keys";

type IpGeoResponse = z.infer<typeof IpGeoResponseSchema>;

export function useIpGeo(
  ip: string,
  lang?: string
): UseQueryResult<IpGeoResponse, ApiError | Error> {
  return useQuery<IpGeoResponse, ApiError | Error>({
    queryKey: ipGeoKeys.detail(ip, lang),
    queryFn: () => ipGeoClient.get(ip, lang),
    enabled: typeof ip === "string" && ip.length > 0,
  });
}
