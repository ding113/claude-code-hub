/**
 * /api/v1/me 路由模块（read tier；self-scoped）
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  MyIpGeoResponseSchema,
  MyMetadataResponseSchema,
  MyQuotaResponseSchema,
  MyStatsSummaryResponseSchema,
  MyTodayStatsResponseSchema,
  MyUsageLogsEndpointsResponseSchema,
  MyUsageLogsFullResponseSchema,
  MyUsageLogsListResponseSchema,
  MyUsageLogsModelsResponseSchema,
} from "@/lib/api/v1/schemas/me";

import {
  getEndpoints,
  getIpGeo,
  getMetadata,
  getModels,
  getQuota,
  getStatsSummary,
  getToday,
  getUsageLogsFull,
  getUsageLogsList,
} from "./handlers";

const TAG = "Me";

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
  500: {
    description: "服务器内部错误",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

const IpParamSchema = z
  .object({ ip: z.string().min(1).describe("待查询的 IP") })
  .openapi({ example: { ip: "8.8.8.8" } });

export function createMeRouter(): OpenAPIHono {
  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return fromZodError(c, result.error);
      }
    },
  });

  router.use("/me", requireAuth({ tier: "read" }));
  router.use("/me/*", requireAuth({ tier: "read" }));

  router.openapi(
    {
      method: "get",
      path: "/me/metadata",
      tags: [TAG],
      summary: "获取当前用户元数据",
      security: SECURITY,
      responses: {
        200: {
          description: "元数据",
          content: { "application/json": { schema: MyMetadataResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getMetadata as never
  );

  router.openapi(
    {
      method: "get",
      path: "/me/quota",
      tags: [TAG],
      summary: "获取当前用户配额",
      security: SECURITY,
      responses: {
        200: {
          description: "配额",
          content: { "application/json": { schema: MyQuotaResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getQuota as never
  );

  router.openapi(
    {
      method: "get",
      path: "/me/today",
      tags: [TAG],
      summary: "获取今日统计",
      security: SECURITY,
      responses: {
        200: {
          description: "今日统计",
          content: { "application/json": { schema: MyTodayStatsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getToday as never
  );

  router.openapi(
    {
      method: "get",
      path: "/me/usage-logs",
      tags: [TAG],
      summary: "我的使用日志（cursor-based）",
      security: SECURITY,
      responses: {
        200: {
          description: "使用日志列表",
          content: { "application/json": { schema: MyUsageLogsListResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getUsageLogsList as never
  );

  router.openapi(
    {
      method: "get",
      path: "/me/usage-logs/full",
      tags: [TAG],
      summary: "我的使用日志（完整字段）",
      security: SECURITY,
      responses: {
        200: {
          description: "完整使用日志",
          content: { "application/json": { schema: MyUsageLogsFullResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getUsageLogsFull as never
  );

  router.openapi(
    {
      method: "get",
      path: "/me/usage-logs/models",
      tags: [TAG],
      summary: "我可用的模型列表",
      security: SECURITY,
      responses: {
        200: {
          description: "模型列表",
          content: { "application/json": { schema: MyUsageLogsModelsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getModels as never
  );

  router.openapi(
    {
      method: "get",
      path: "/me/usage-logs/endpoints",
      tags: [TAG],
      summary: "我可用的 endpoint 列表",
      security: SECURITY,
      responses: {
        200: {
          description: "Endpoint 列表",
          content: { "application/json": { schema: MyUsageLogsEndpointsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getEndpoints as never
  );

  router.openapi(
    {
      method: "get",
      path: "/me/usage-logs/stats-summary",
      tags: [TAG],
      summary: "我的统计摘要",
      security: SECURITY,
      responses: {
        200: {
          description: "统计摘要",
          content: { "application/json": { schema: MyStatsSummaryResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getStatsSummary as never
  );

  router.openapi(
    {
      method: "get",
      path: "/me/ip-geo/{ip}",
      tags: [TAG],
      summary: "查询 IP 地理信息（自助）",
      security: SECURITY,
      request: { params: IpParamSchema },
      responses: {
        200: {
          description: "IP 地理信息",
          content: { "application/json": { schema: MyIpGeoResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getIpGeo as never
  );

  return router;
}

export const meRouter = createMeRouter();
