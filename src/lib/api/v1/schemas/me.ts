/**
 * /api/v1 me 自助资源 schema
 */

import { z } from "@hono/zod-openapi";

export const MyMetadataResponseSchema = z
  .object({})
  .passthrough()
  .describe("用户元数据（passthrough）")
  .openapi({ example: { keyName: "default", userName: "alice" } });

export const MyQuotaResponseSchema = z.object({}).passthrough().describe("用户配额（passthrough）");

export const MyTodayStatsResponseSchema = z
  .object({})
  .passthrough()
  .describe("今日使用统计（passthrough）");

export const MyUsageLogsListResponseSchema = z
  .object({
    logs: z.array(z.unknown()).describe("使用日志列表"),
    nextCursor: z.unknown().nullable().optional(),
    hasMore: z.boolean().optional(),
  })
  .passthrough()
  .describe("我的使用日志（cursor-based）")
  .openapi({ example: { logs: [], nextCursor: null, hasMore: false } });

export const MyUsageLogsFullResponseSchema = z
  .object({})
  .passthrough()
  .describe("我的使用日志（完整字段）");

export const MyUsageLogsModelsResponseSchema = z
  .object({
    items: z.array(z.string()),
  })
  .describe("我的可用模型列表")
  .openapi({ example: { items: ["claude-sonnet-4"] } });

export const MyUsageLogsEndpointsResponseSchema = z
  .object({
    items: z.array(z.string()),
  })
  .describe("我的可用 endpoint 列表")
  .openapi({ example: { items: ["/v1/messages"] } });

export const MyStatsSummaryResponseSchema = z
  .object({})
  .passthrough()
  .describe("我的统计摘要（passthrough）");

export const MyIpGeoResponseSchema = z
  .object({})
  .passthrough()
  .describe("我的 IP 地理信息（passthrough）");

export const IpParamSchema = z
  .object({
    ip: z.string().min(1),
  })
  .openapi({ example: { ip: "8.8.8.8" } });

export const IpGeoQuerySchema = z
  .object({
    lang: z.string().optional(),
  })
  .openapi({ example: { lang: "zh-CN" } });
