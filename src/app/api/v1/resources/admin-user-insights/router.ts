/**
 * /api/v1/admin/users/{id}/insights/* 路由模块
 *
 * 4 个 admin-only 端点：
 *   GET /admin/users/{id}/insights/overview
 *   GET /admin/users/{id}/insights/key-trend
 *   GET /admin/users/{id}/insights/model-breakdown
 *   GET /admin/users/{id}/insights/provider-breakdown
 */

import { OpenAPIHono } from "@hono/zod-openapi";

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { ProblemJsonSchema, ResourceIdParamSchema } from "@/lib/api/v1/schemas/_common";
import {
  InsightsDateRangeQuerySchema,
  InsightsKeyTrendQuerySchema,
  InsightsKeyTrendResponseSchema,
  InsightsModelBreakdownQuerySchema,
  InsightsModelBreakdownResponseSchema,
  InsightsOverviewResponseSchema,
  InsightsProviderBreakdownQuerySchema,
  InsightsProviderBreakdownResponseSchema,
} from "@/lib/api/v1/schemas/admin-user-insights";

import { getKeyTrend, getModelBreakdown, getOverview, getProviderBreakdown } from "./handlers";

const TAG = "Admin User Insights";

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

export function createAdminUserInsightsRouter(): OpenAPIHono {
  const router = new OpenAPIHono();

  router.use("/admin/users/:id/insights/*", requireAuth({ tier: "admin" }));

  // ============== overview ==============
  router.openapi(
    {
      method: "get",
      path: "/admin/users/{id}/insights/overview",
      tags: [TAG],
      summary: "用户洞察 - 概览指标",
      description: "返回指定用户在给定日期范围内的请求数 / 总花费 / 平均响应时间 / 错误率。",
      security: SECURITY,
      request: {
        params: ResourceIdParamSchema,
        query: InsightsDateRangeQuerySchema,
      },
      responses: {
        200: {
          description: "概览指标",
          content: { "application/json": { schema: InsightsOverviewResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getOverview as never
  );

  // ============== key-trend ==============
  router.openapi(
    {
      method: "get",
      path: "/admin/users/{id}/insights/key-trend",
      tags: [TAG],
      summary: "用户洞察 - Key 趋势",
      description:
        "按预设的 timeRange 聚合，返回该用户每个 key 每日（或每小时）的调用 / 花费数据。",
      security: SECURITY,
      request: {
        params: ResourceIdParamSchema,
        query: InsightsKeyTrendQuerySchema,
      },
      responses: {
        200: {
          description: "Key 趋势数据",
          content: { "application/json": { schema: InsightsKeyTrendResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getKeyTrend as never
  );

  // ============== model-breakdown ==============
  router.openapi(
    {
      method: "get",
      path: "/admin/users/{id}/insights/model-breakdown",
      tags: [TAG],
      summary: "用户洞察 - 模型维度统计",
      description:
        "按模型聚合用户的调用次数 / 花费 / token 等数据；可附加 keyId / providerId 过滤。",
      security: SECURITY,
      request: {
        params: ResourceIdParamSchema,
        query: InsightsModelBreakdownQuerySchema,
      },
      responses: {
        200: {
          description: "模型维度统计",
          content: { "application/json": { schema: InsightsModelBreakdownResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getModelBreakdown as never
  );

  // ============== provider-breakdown ==============
  router.openapi(
    {
      method: "get",
      path: "/admin/users/{id}/insights/provider-breakdown",
      tags: [TAG],
      summary: "用户洞察 - Provider 维度统计",
      description:
        "按 provider 聚合用户的调用次数 / 花费 / token 等数据；可附加 keyId / model 过滤。",
      security: SECURITY,
      request: {
        params: ResourceIdParamSchema,
        query: InsightsProviderBreakdownQuerySchema,
      },
      responses: {
        200: {
          description: "Provider 维度统计",
          content: { "application/json": { schema: InsightsProviderBreakdownResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getProviderBreakdown as never
  );

  return router;
}

export const adminUserInsightsRouter = createAdminUserInsightsRouter();
