/**
 * /api/v1/usage-logs 路由模块
 *
 * 端点：read tier（自助场景；action 自身按 admin / user 区分过滤）
 *  POST /usage-logs/exports 需要 admin（action 自身已检查；这里也保持 read tier，
 *  让 action 决定是否拒绝）。CSRF 仍对写动作生效。
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler, Next } from "hono";

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { requireCsrf } from "@/lib/api/v1/_shared/csrf";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";

const JobIdParamSchema = z
  .object({ jobId: z.string().min(1).describe("导出 job id") })
  .openapi({ example: { jobId: "abc-123" } });

import {
  UsageLogsExportAcceptedResponseSchema,
  UsageLogsExportRequestSchema,
  UsageLogsExportStatusResponseSchema,
  UsageLogsFilterOptionsResponseSchema,
  UsageLogsListResponseSchema,
  UsageLogsSessionIdSuggestionsResponseSchema,
  UsageLogsStatsResponseSchema,
} from "@/lib/api/v1/schemas/usage-logs";

import {
  downloadExport,
  getExportStatus,
  getSessionIdSuggestions,
  getUsageLogsFilterOptions,
  getUsageLogsStats,
  listUsageLogs,
  startOrSyncExport,
} from "./handlers";

const TAG = "Usage Logs";

const SECURITY: Array<Record<string, string[]>> = [
  { bearerAuth: [] },
  { apiKeyAuth: [] },
  { cookieAuth: [] },
];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function csrfForMutating(): MiddlewareHandler {
  const inner = requireCsrf();
  return async (c: Context, next: Next) => {
    if (SAFE_METHODS.has(c.req.method.toUpperCase())) {
      return next();
    }
    return inner(c, next);
  };
}

const errorResponses = {
  400: {
    description: "请求参数无效",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  401: {
    description: "未认证",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  403: {
    description: "无权限或 CSRF 校验失败",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  404: {
    description: "资源不存在",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  500: {
    description: "服务器内部错误",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

export function createUsageLogsRouter(): OpenAPIHono {
  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return fromZodError(c, result.error);
      }
    },
  });

  router.use("/usage-logs", requireAuth({ tier: "read" }));
  router.use("/usage-logs/*", requireAuth({ tier: "read" }));
  router.use("/usage-logs", csrfForMutating());
  router.use("/usage-logs/*", csrfForMutating());

  // GET /usage-logs
  router.openapi(
    {
      method: "get",
      path: "/usage-logs",
      tags: [TAG],
      summary: "列出 usage logs（cursor-based）",
      security: SECURITY,
      responses: {
        200: {
          description: "Usage logs 列表",
          content: { "application/json": { schema: UsageLogsListResponseSchema } },
        },
        ...errorResponses,
      },
    },
    listUsageLogs as never
  );

  // GET /usage-logs/stats
  router.openapi(
    {
      method: "get",
      path: "/usage-logs/stats",
      tags: [TAG],
      summary: "Usage logs 聚合统计",
      security: SECURITY,
      responses: {
        200: {
          description: "聚合统计",
          content: { "application/json": { schema: UsageLogsStatsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getUsageLogsStats as never
  );

  // GET /usage-logs/filter-options
  router.openapi(
    {
      method: "get",
      path: "/usage-logs/filter-options",
      tags: [TAG],
      summary: "获取筛选器选项",
      security: SECURITY,
      responses: {
        200: {
          description: "筛选器选项",
          content: { "application/json": { schema: UsageLogsFilterOptionsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getUsageLogsFilterOptions as never
  );

  // GET /usage-logs/session-id-suggestions
  router.openapi(
    {
      method: "get",
      path: "/usage-logs/session-id-suggestions",
      tags: [TAG],
      summary: "Session ID 联想",
      security: SECURITY,
      responses: {
        200: {
          description: "Session ID 列表",
          content: { "application/json": { schema: UsageLogsSessionIdSuggestionsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getSessionIdSuggestions as never
  );

  // POST /usage-logs/exports
  router.openapi(
    {
      method: "post",
      path: "/usage-logs/exports",
      tags: [TAG],
      summary: "导出 usage logs（同步或异步）",
      description:
        "默认同步返回 CSV 流；如需异步，请发送 `Prefer: respond-async`，将返回 202 + jobId。",
      security: SECURITY,
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: UsageLogsExportRequestSchema } },
        },
      },
      responses: {
        200: {
          description: "同步模式：CSV",
          content: { "text/csv": { schema: { type: "string" } } },
        },
        202: {
          description: "异步模式：已受理",
          content: { "application/json": { schema: UsageLogsExportAcceptedResponseSchema } },
        },
        ...errorResponses,
      },
    },
    startOrSyncExport as never
  );

  // GET /usage-logs/exports/{jobId}
  router.openapi(
    {
      method: "get",
      path: "/usage-logs/exports/{jobId}",
      tags: [TAG],
      summary: "查询导出 job 状态",
      security: SECURITY,
      request: { params: JobIdParamSchema },
      responses: {
        200: {
          description: "Job 状态",
          content: { "application/json": { schema: UsageLogsExportStatusResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getExportStatus as never
  );

  // GET /usage-logs/exports/{jobId}/download
  router.openapi(
    {
      method: "get",
      path: "/usage-logs/exports/{jobId}/download",
      tags: [TAG],
      summary: "下载导出 CSV",
      security: SECURITY,
      request: { params: JobIdParamSchema },
      responses: {
        200: {
          description: "CSV 文件",
          content: { "text/csv": { schema: { type: "string" } } },
        },
        ...errorResponses,
      },
    },
    downloadExport as never
  );

  return router;
}

export const usageLogsRouter = createUsageLogsRouter();
