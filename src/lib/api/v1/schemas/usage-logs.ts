/**
 * /api/v1 usage-logs 资源 schema
 *
 * 设计要点：
 * - usage logs 字段繁多且 dependent on raw repository row（含 priceData / providers chain），
 *   使用 passthrough 透明回传；
 * - 列表 API 收纳 page-based + cursor-based（cursor 模式由参数 cursor 决定）。
 */

import { z } from "@hono/zod-openapi";
import { CursorResponseSchema } from "../_shared/pagination";

export const UsageLogItemSchema = z
  .object({
    id: z.number().int(),
    createdAt: z.string().nullable().optional(),
    sessionId: z.string().nullable().optional(),
    requestSequence: z.number().int().nullable().optional(),
    model: z.string().nullable().optional(),
    statusCode: z.number().int().nullable().optional(),
    endpoint: z.string().nullable().optional(),
  })
  .passthrough()
  .describe("单条 usage log 行（passthrough，保留全部底层字段）")
  .openapi({ example: { id: 1, model: "claude-sonnet-4-20250514", statusCode: 200 } });

export type UsageLogItem = z.infer<typeof UsageLogItemSchema>;

export const UsageLogsListResponseSchema = CursorResponseSchema(UsageLogItemSchema)
  .describe("Usage logs 列表（cursor-based 分页）")
  .openapi({ example: { items: [], pageInfo: { nextCursor: null, hasMore: false, limit: 20 } } });

export type UsageLogsListResponse = z.infer<typeof UsageLogsListResponseSchema>;

export const UsageLogsStatsResponseSchema = z
  .object({})
  .passthrough()
  .describe("Usage logs 聚合统计（passthrough）")
  .openapi({ example: { totalRequests: 100, totalCost: "1.23" } });

export type UsageLogsStatsResponse = z.infer<typeof UsageLogsStatsResponseSchema>;

export const UsageLogsFilterOptionsResponseSchema = z
  .object({
    models: z.array(z.string()).describe("可用模型列表"),
    statusCodes: z.array(z.number().int()).describe("可用状态码列表"),
    endpoints: z.array(z.string()).describe("可用 endpoint 列表"),
  })
  .describe("Usage logs 筛选器选项")
  .openapi({
    example: { models: ["claude-sonnet-4"], statusCodes: [200, 429], endpoints: ["/v1/messages"] },
  });

export type UsageLogsFilterOptionsResponse = z.infer<typeof UsageLogsFilterOptionsResponseSchema>;

export const UsageLogsSessionIdSuggestionsResponseSchema = z
  .object({
    items: z.array(z.string()).describe("匹配的 session id 列表"),
  })
  .describe("Session ID 联想响应")
  .openapi({ example: { items: ["sess_abc123"] } });

export type UsageLogsSessionIdSuggestionsResponse = z.infer<
  typeof UsageLogsSessionIdSuggestionsResponseSchema
>;

export const UsageLogsExportRequestSchema = z
  .object({})
  .passthrough()
  .describe("Usage logs 导出请求（filters 字段；passthrough）")
  .openapi({ example: { filters: { startDate: "2026-01-01", endDate: "2026-04-28" } } });

export type UsageLogsExportRequest = z.infer<typeof UsageLogsExportRequestSchema>;

export const UsageLogsExportStatusResponseSchema = z
  .object({
    jobId: z.string(),
    status: z.enum(["queued", "running", "completed", "failed"]),
    processedRows: z.number().int().nonnegative(),
    totalRows: z.number().int().nonnegative(),
    progressPercent: z.number(),
    error: z.string().optional(),
  })
  .describe("Usage logs 导出 job 状态")
  .openapi({
    example: {
      jobId: "abc-123",
      status: "running",
      processedRows: 500,
      totalRows: 1000,
      progressPercent: 50,
    },
  });

export type UsageLogsExportStatusResponse = z.infer<typeof UsageLogsExportStatusResponseSchema>;

export const UsageLogsExportAcceptedResponseSchema = z
  .object({
    jobId: z.string(),
    status: z.string(),
    statusUrl: z.string(),
  })
  .describe("Usage logs 异步导出已受理")
  .openapi({
    example: {
      jobId: "abc-123",
      status: "queued",
      statusUrl: "/api/v1/usage-logs/exports/abc-123",
    },
  });

export type UsageLogsExportAcceptedResponse = z.infer<typeof UsageLogsExportAcceptedResponseSchema>;
