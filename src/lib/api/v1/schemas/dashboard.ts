/**
 * /api/v1 dashboard 资源 schema
 */

import { z } from "@hono/zod-openapi";

export const DashboardOverviewResponseSchema = z
  .object({})
  .passthrough()
  .describe("Dashboard overview 数据（passthrough）")
  .openapi({ example: { totalRequests: 100 } });

export const DashboardRealtimeResponseSchema = z
  .object({})
  .passthrough()
  .describe("Dashboard realtime 数据（passthrough）");

export const DashboardStatisticsResponseSchema = z
  .object({})
  .passthrough()
  .describe("Dashboard 用户统计（passthrough）");

export const DashboardConcurrentSessionsResponseSchema = z
  .object({
    count: z.number().int().nonnegative(),
    generatedAt: z.string().describe("ISO 时间戳"),
  })
  .describe("当前并发 session 数")
  .openapi({ example: { count: 0, generatedAt: "2026-04-28T00:00:00Z" } });

export const DashboardProviderSlotsResponseSchema = z
  .object({
    items: z.array(z.unknown()),
    generatedAt: z.string(),
  })
  .describe("Provider 槽位状态")
  .openapi({ example: { items: [], generatedAt: "2026-04-28T00:00:00Z" } });

export const DashboardRateLimitStatsResponseSchema = z
  .object({})
  .passthrough()
  .describe("速率限制统计");

export const DashboardClientVersionsResponseSchema = z
  .object({
    items: z.array(z.unknown()),
    generatedAt: z.string(),
  })
  .describe("客户端版本统计")
  .openapi({ example: { items: [], generatedAt: "2026-04-28T00:00:00Z" } });

export const DashboardProxyStatusResponseSchema = z.object({}).passthrough().describe("代理状态");

export const DispatchSimulatorRequestSchema = z
  .object({})
  .passthrough()
  .describe("Dispatch simulator 输入（passthrough）")
  .openapi({ example: { keyId: 1 } });

export const DispatchSimulatorResponseSchema = z
  .object({})
  .passthrough()
  .describe("Dispatch simulator 结果（passthrough）");

export const StatisticsTimeRangeQuerySchema = z
  .object({
    timeRange: z.enum(["today", "7days", "30days", "thisMonth"]).optional(),
  })
  .openapi({ example: { timeRange: "today" } });
