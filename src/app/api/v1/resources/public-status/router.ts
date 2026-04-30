/**
 * /api/v1/public/status 路由模块
 *
 * - GET /public/status：完全公开，无鉴权；
 * - PUT /public/status/settings：admin + CSRF。
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler, Next } from "hono";

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { requireCsrf } from "@/lib/api/v1/_shared/csrf";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  PublicStatusResponseSchema,
  PublicStatusSettingsRequestSchema,
  PublicStatusSettingsResponseSchema,
} from "@/lib/api/v1/schemas/public-status";

import { getPublicStatus, updatePublicStatusSettings } from "./handlers";

const TAG = "Public Status";

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
  500: {
    description: "服务器内部错误",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

export function createPublicStatusRouter(): OpenAPIHono {
  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return fromZodError(c, result.error);
      }
    },
  });

  // GET /public/status 完全公开
  router.use("/public/status", requireAuth({ tier: "public" }));
  // settings 端点 admin + CSRF
  router.use("/public/status/settings", requireAuth({ tier: "admin" }));
  router.use("/public/status/settings", csrfForMutating());

  router.openapi(
    {
      method: "get",
      path: "/public/status",
      tags: [TAG],
      summary: "公开 status 端点（无需认证）",
      security: [],
      responses: {
        200: {
          description: "公开 status 数据",
          content: { "application/json": { schema: PublicStatusResponseSchema } },
        },
        503: {
          description: "服务暂时不可用（rebuilding）",
          content: { "application/json": { schema: PublicStatusResponseSchema } },
        },
      },
    },
    getPublicStatus as never
  );

  router.openapi(
    {
      method: "put",
      path: "/public/status/settings",
      tags: [TAG],
      summary: "更新 public status 设置（admin）",
      security: SECURITY,
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: PublicStatusSettingsRequestSchema } },
        },
      },
      responses: {
        200: {
          description: "更新结果",
          content: { "application/json": { schema: PublicStatusSettingsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    updatePublicStatusSettings as never
  );

  return router;
}

export const publicStatusRouter = createPublicStatusRouter();
