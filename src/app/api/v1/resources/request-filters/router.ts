/**
 * /api/v1/request-filters 路由模块
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler, Next } from "hono";

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { requireCsrf } from "@/lib/api/v1/_shared/csrf";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema, ResourceIdParamSchema } from "@/lib/api/v1/schemas/_common";
import {
  RequestFilterCreateSchema,
  RequestFilterSchema,
  RequestFiltersCacheRefreshResponseSchema,
  RequestFiltersGroupOptionsResponseSchema,
  RequestFiltersListResponseSchema,
  RequestFiltersProviderOptionsResponseSchema,
  RequestFilterUpdateSchema,
} from "@/lib/api/v1/schemas/request-filters";

import {
  createRequestFilter,
  deleteRequestFilter,
  listGroupsForFilter,
  listProvidersForFilter,
  listRequestFilters,
  refreshRequestFiltersCache,
  updateRequestFilter,
} from "./handlers";

const TAG = "Request Filters";

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

export function createRequestFiltersRouter(): OpenAPIHono {
  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return fromZodError(c, result.error);
      }
    },
  });

  router.use("/request-filters", requireAuth({ tier: "admin" }));
  router.use("/request-filters/*", requireAuth({ tier: "admin" }));
  router.use("/request-filters", csrfForMutating());
  router.use("/request-filters/*", csrfForMutating());

  router.openapi(
    {
      method: "get",
      path: "/request-filters",
      tags: [TAG],
      summary: "列出 request filters",
      security: SECURITY,
      responses: {
        200: {
          description: "Request filters 列表",
          content: { "application/json": { schema: RequestFiltersListResponseSchema } },
        },
        ...errorResponses,
      },
    },
    listRequestFilters as never
  );

  router.openapi(
    {
      method: "post",
      path: "/request-filters",
      tags: [TAG],
      summary: "创建 request filter",
      security: SECURITY,
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: RequestFilterCreateSchema } },
        },
      },
      responses: {
        201: {
          description: "创建成功",
          headers: { Location: { description: "新规则的相对 URL", schema: { type: "string" } } },
          content: { "application/json": { schema: RequestFilterSchema } },
        },
        ...errorResponses,
      },
    },
    createRequestFilter as never
  );

  // GET /request-filters/options/providers
  router.openapi(
    {
      method: "get",
      path: "/request-filters/options/providers",
      tags: [TAG],
      summary: "获取可绑定的 provider 列表",
      security: SECURITY,
      responses: {
        200: {
          description: "Provider 选项",
          content: { "application/json": { schema: RequestFiltersProviderOptionsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    listProvidersForFilter as never
  );

  // GET /request-filters/options/groups
  router.openapi(
    {
      method: "get",
      path: "/request-filters/options/groups",
      tags: [TAG],
      summary: "获取可绑定的 provider group 列表",
      security: SECURITY,
      responses: {
        200: {
          description: "Provider group 选项",
          content: { "application/json": { schema: RequestFiltersGroupOptionsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    listGroupsForFilter as never
  );

  // POST /request-filters/cache:refresh
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/request-filters/cache:refresh",
    tags: [TAG],
    summary: "刷新 request filters 缓存",
    security: SECURITY,
    responses: {
      200: {
        description: "刷新结果",
        content: { "application/json": { schema: RequestFiltersCacheRefreshResponseSchema } },
      },
      ...errorResponses,
    },
  });
  router.post("/request-filters/cache:refresh", refreshRequestFiltersCache);

  router.openapi(
    {
      method: "patch",
      path: "/request-filters/{id}",
      tags: [TAG],
      summary: "更新 request filter",
      security: SECURITY,
      request: {
        params: ResourceIdParamSchema,
        body: {
          required: true,
          content: { "application/json": { schema: RequestFilterUpdateSchema } },
        },
      },
      responses: {
        200: {
          description: "更新后的规则",
          content: { "application/json": { schema: RequestFilterSchema } },
        },
        ...errorResponses,
      },
    },
    updateRequestFilter as never
  );

  router.openapi(
    {
      method: "delete",
      path: "/request-filters/{id}",
      tags: [TAG],
      summary: "删除 request filter",
      security: SECURITY,
      request: { params: ResourceIdParamSchema },
      responses: {
        204: { description: "删除成功（无响应体）" },
        ...errorResponses,
      },
    },
    deleteRequestFilter as never
  );

  return router;
}

export const requestFiltersRouter = createRequestFiltersRouter();
