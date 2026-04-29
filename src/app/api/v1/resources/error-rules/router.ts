/**
 * /api/v1/error-rules 路由模块
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler, Next } from "hono";

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { requireCsrf } from "@/lib/api/v1/_shared/csrf";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema, ResourceIdParamSchema } from "@/lib/api/v1/schemas/_common";
import {
  ErrorRuleCreateSchema,
  ErrorRuleSchema,
  ErrorRulesCacheRefreshResponseSchema,
  ErrorRulesCacheStatsResponseSchema,
  ErrorRulesListResponseSchema,
  ErrorRuleTestRequestSchema,
  ErrorRuleTestResponseSchema,
  ErrorRuleUpdateSchema,
} from "@/lib/api/v1/schemas/error-rules";

import {
  createErrorRule,
  deleteErrorRule,
  getErrorRulesCacheStats,
  listErrorRules,
  refreshErrorRulesCache,
  testErrorRule,
  updateErrorRule,
} from "./handlers";

const TAG = "Error Rules";

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

export function createErrorRulesRouter(): OpenAPIHono {
  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return fromZodError(c, result.error);
      }
    },
  });

  router.use("/error-rules", requireAuth({ tier: "admin" }));
  router.use("/error-rules/*", requireAuth({ tier: "admin" }));
  router.use("/error-rules", csrfForMutating());
  router.use("/error-rules/*", csrfForMutating());

  // GET /error-rules
  router.openapi(
    {
      method: "get",
      path: "/error-rules",
      tags: [TAG],
      summary: "列出错误规则",
      security: SECURITY,
      responses: {
        200: {
          description: "错误规则列表",
          content: { "application/json": { schema: ErrorRulesListResponseSchema } },
        },
        ...errorResponses,
      },
    },
    listErrorRules as never
  );

  // POST /error-rules
  router.openapi(
    {
      method: "post",
      path: "/error-rules",
      tags: [TAG],
      summary: "创建错误规则",
      security: SECURITY,
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: ErrorRuleCreateSchema } },
        },
      },
      responses: {
        201: {
          description: "创建成功",
          headers: {
            Location: { description: "新规则的相对 URL", schema: { type: "string" } },
          },
          content: { "application/json": { schema: ErrorRuleSchema } },
        },
        ...errorResponses,
      },
    },
    createErrorRule as never
  );

  // GET /error-rules/cache/stats
  router.openapi(
    {
      method: "get",
      path: "/error-rules/cache/stats",
      tags: [TAG],
      summary: "获取错误规则缓存统计",
      security: SECURITY,
      responses: {
        200: {
          description: "缓存统计",
          content: { "application/json": { schema: ErrorRulesCacheStatsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getErrorRulesCacheStats as never
  );

  // POST /error-rules/cache:refresh
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/error-rules/cache:refresh",
    tags: [TAG],
    summary: "刷新错误规则缓存",
    security: SECURITY,
    responses: {
      200: {
        description: "刷新结果",
        content: { "application/json": { schema: ErrorRulesCacheRefreshResponseSchema } },
      },
      ...errorResponses,
    },
  });
  router.post("/error-rules/cache:refresh", refreshErrorRulesCache);

  // POST /error-rules:test
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/error-rules:test",
    tags: [TAG],
    summary: "测试错误规则匹配",
    security: SECURITY,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: ErrorRuleTestRequestSchema } },
      },
    },
    responses: {
      200: {
        description: "测试结果",
        content: { "application/json": { schema: ErrorRuleTestResponseSchema } },
      },
      ...errorResponses,
    },
  });
  router.post("/error-rules:test", testErrorRule);

  // PATCH /error-rules/{id}
  router.openapi(
    {
      method: "patch",
      path: "/error-rules/{id}",
      tags: [TAG],
      summary: "更新错误规则",
      security: SECURITY,
      request: {
        params: ResourceIdParamSchema,
        body: {
          required: true,
          content: { "application/json": { schema: ErrorRuleUpdateSchema } },
        },
      },
      responses: {
        200: {
          description: "更新后的规则",
          content: { "application/json": { schema: ErrorRuleSchema } },
        },
        ...errorResponses,
      },
    },
    updateErrorRule as never
  );

  // DELETE /error-rules/{id}
  router.openapi(
    {
      method: "delete",
      path: "/error-rules/{id}",
      tags: [TAG],
      summary: "删除错误规则",
      security: SECURITY,
      request: { params: ResourceIdParamSchema },
      responses: {
        204: { description: "删除成功（无响应体）" },
        ...errorResponses,
      },
    },
    deleteErrorRule as never
  );

  return router;
}

export const errorRulesRouter = createErrorRulesRouter();
