/**
 * /api/v1/sensitive-words 路由模块
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler, Next } from "hono";

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { requireCsrf } from "@/lib/api/v1/_shared/csrf";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema, ResourceIdParamSchema } from "@/lib/api/v1/schemas/_common";
import {
  SensitiveWordCreateSchema,
  SensitiveWordSchema,
  SensitiveWordsCacheRefreshResponseSchema,
  SensitiveWordsCacheStatsResponseSchema,
  SensitiveWordsListResponseSchema,
  SensitiveWordUpdateSchema,
} from "@/lib/api/v1/schemas/sensitive-words";

import {
  createSensitiveWord,
  deleteSensitiveWord,
  getSensitiveWordsCacheStats,
  listSensitiveWords,
  refreshSensitiveWordsCache,
  updateSensitiveWord,
} from "./handlers";

const TAG = "Sensitive Words";

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

export function createSensitiveWordsRouter(): OpenAPIHono {
  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return fromZodError(c, result.error);
      }
    },
  });

  router.use("/sensitive-words", requireAuth({ tier: "admin" }));
  router.use("/sensitive-words/*", requireAuth({ tier: "admin" }));
  router.use("/sensitive-words", csrfForMutating());
  router.use("/sensitive-words/*", csrfForMutating());

  router.openapi(
    {
      method: "get",
      path: "/sensitive-words",
      tags: [TAG],
      summary: "列出敏感词",
      security: SECURITY,
      responses: {
        200: {
          description: "敏感词列表",
          content: { "application/json": { schema: SensitiveWordsListResponseSchema } },
        },
        ...errorResponses,
      },
    },
    listSensitiveWords as never
  );

  router.openapi(
    {
      method: "post",
      path: "/sensitive-words",
      tags: [TAG],
      summary: "创建敏感词",
      security: SECURITY,
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: SensitiveWordCreateSchema } },
        },
      },
      responses: {
        201: {
          description: "创建成功",
          headers: { Location: { description: "新敏感词的相对 URL", schema: { type: "string" } } },
          content: { "application/json": { schema: SensitiveWordSchema } },
        },
        ...errorResponses,
      },
    },
    createSensitiveWord as never
  );

  router.openapi(
    {
      method: "get",
      path: "/sensitive-words/cache/stats",
      tags: [TAG],
      summary: "获取敏感词缓存统计",
      security: SECURITY,
      responses: {
        200: {
          description: "缓存统计",
          content: { "application/json": { schema: SensitiveWordsCacheStatsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getSensitiveWordsCacheStats as never
  );

  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/sensitive-words/cache:refresh",
    tags: [TAG],
    summary: "刷新敏感词缓存",
    security: SECURITY,
    responses: {
      200: {
        description: "刷新结果",
        content: { "application/json": { schema: SensitiveWordsCacheRefreshResponseSchema } },
      },
      ...errorResponses,
    },
  });
  router.post("/sensitive-words/cache:refresh", refreshSensitiveWordsCache);

  router.openapi(
    {
      method: "patch",
      path: "/sensitive-words/{id}",
      tags: [TAG],
      summary: "更新敏感词",
      security: SECURITY,
      request: {
        params: ResourceIdParamSchema,
        body: {
          required: true,
          content: { "application/json": { schema: SensitiveWordUpdateSchema } },
        },
      },
      responses: {
        200: {
          description: "更新后的敏感词",
          content: { "application/json": { schema: SensitiveWordSchema } },
        },
        ...errorResponses,
      },
    },
    updateSensitiveWord as never
  );

  router.openapi(
    {
      method: "delete",
      path: "/sensitive-words/{id}",
      tags: [TAG],
      summary: "删除敏感词",
      security: SECURITY,
      request: { params: ResourceIdParamSchema },
      responses: {
        204: { description: "删除成功（无响应体）" },
        ...errorResponses,
      },
    },
    deleteSensitiveWord as never
  );

  return router;
}

export const sensitiveWordsRouter = createSensitiveWordsRouter();
