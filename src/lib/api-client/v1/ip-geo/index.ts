/**
 * /api/v1/ip-geo 类型化客户端方法
 */

import type { z } from "@hono/zod-openapi";
import type { IpGeoResponseSchema } from "@/lib/api/v1/schemas/ip-geo";
import { apiClient, fetchApi } from "@/lib/api-client/v1/client";

type IpGeoResponse = z.infer<typeof IpGeoResponseSchema>;

const BASE_PATH = "/api/v1/ip-geo";

export interface IpGeoClient {
  get(ip: string, lang?: string): Promise<IpGeoResponse>;
}

async function get(ip: string, lang?: string): Promise<IpGeoResponse> {
  const query = lang ? `?lang=${encodeURIComponent(lang)}` : "";
  const r = await fetchApi(`${BASE_PATH}/${encodeURIComponent(ip)}${query}`, { method: "GET" });
  return (await r.json()) as IpGeoResponse;
}

export const ipGeoClient: IpGeoClient = {
  get,
};

Object.assign(apiClient, { ipGeo: ipGeoClient });
