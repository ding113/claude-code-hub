/**
 * /api/v1/audit-logs 路由模块（admin tier）
 */

import { OpenAPIHono } from "@hono/zod-openapi";

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema, ResourceIdParamSchema } from "@/lib/api/v1/schemas/_common";
import {
  AuditLogDetailResponseSchema,
  AuditLogsListResponseSchema,
} from "@/lib/api/v1/schemas/audit-logs";

import { getAuditLogDetail, listAuditLogs } from "./handlers";

const TAG = "Audit Logs";

const SECURITY: Array<Record<string, string[]>> = [
  { bearerAuth: [] },
  { apiKeyAuth: [] },
  { cookieAuth: [] },
];

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
    description: "无权限",
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

export function createAuditLogsRouter(): OpenAPIHono {
  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return fromZodError(c, result.error);
      }
    },
  });

  router.use("/audit-logs", requireAuth({ tier: "admin" }));
  router.use("/audit-logs/*", requireAuth({ tier: "admin" }));

  router.openapi(
    {
      method: "get",
      path: "/audit-logs",
      tags: [TAG],
      summary: "列出审计日志（cursor-based）",
      security: SECURITY,
      responses: {
        200: {
          description: "审计日志列表",
          content: { "application/json": { schema: AuditLogsListResponseSchema } },
        },
        ...errorResponses,
      },
    },
    listAuditLogs as never
  );

  router.openapi(
    {
      method: "get",
      path: "/audit-logs/{id}",
      tags: [TAG],
      summary: "获取审计日志详情",
      security: SECURITY,
      request: { params: ResourceIdParamSchema },
      responses: {
        200: {
          description: "审计日志详情",
          content: { "application/json": { schema: AuditLogDetailResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getAuditLogDetail as never
  );

  return router;
}

export const auditLogsRouter = createAuditLogsRouter();
