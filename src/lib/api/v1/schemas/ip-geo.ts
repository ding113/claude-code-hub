/**
 * /api/v1 ip-geo 资源 schema
 */

import { z } from "@hono/zod-openapi";

export const IpGeoResponseSchema = z
  .object({})
  .passthrough()
  .describe("IP 地理信息（passthrough）")
  .openapi({ example: { status: "ok", data: { country: "United States" } } });

export const IpGeoIpParamSchema = z
  .object({
    ip: z.string().min(1).describe("待查询的 IP"),
  })
  .openapi({ example: { ip: "8.8.8.8" } });

export const IpGeoQuerySchema = z
  .object({
    lang: z.string().optional().describe("可选的语言"),
  })
  .openapi({ example: { lang: "zh-CN" } });
