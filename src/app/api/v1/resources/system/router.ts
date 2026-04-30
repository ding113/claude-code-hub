/**
 * /api/v1/system 路由模块
 *
 * 端点：
 *   GET /api/v1/system/settings  (admin)
 *   PUT /api/v1/system/settings  (admin + CSRF)
 *   GET /api/v1/system/timezone  (read)
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler, Next } from "hono";

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { requireCsrf } from "@/lib/api/v1/_shared/csrf";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  SystemSettingsResponseSchema,
  SystemSettingsUpdateSchema,
  SystemTimezoneResponseSchema,
} from "@/lib/api/v1/schemas/system";

import { getSystemSettings, getSystemTimezone, updateSystemSettings } from "./handlers";

const TAG = "System";

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

export function createSystemRouter(): OpenAPIHono {
  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return fromZodError(c, result.error);
      }
    },
  });

  // /system/settings: admin tier
  router.use("/system/settings", requireAuth({ tier: "admin" }));
  router.use("/system/settings", csrfForMutating());

  // /system/timezone: read tier
  router.use("/system/timezone", requireAuth({ tier: "read" }));

  // ============== GET /system/settings ==============
  router.openapi(
    {
      method: "get",
      path: "/system/settings",
      tags: [TAG],
      summary: "获取系统设置",
      description: "返回完整的 SystemSettings 行（含所有功能开关与配置）。需要管理员权限。",
      security: SECURITY,
      responses: {
        200: {
          description: "系统设置",
          content: { "application/json": { schema: SystemSettingsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getSystemSettings as never
  );

  // ============== PUT /system/settings ==============
  router.openapi(
    {
      method: "put",
      path: "/system/settings",
      tags: [TAG],
      summary: "更新系统设置（局部更新）",
      description:
        "局部更新 SystemSettings；未提供的字段保持原值。需要管理员权限；Cookie 鉴权时必须携带 X-CCH-CSRF。",
      security: SECURITY,
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: SystemSettingsUpdateSchema } },
        },
      },
      responses: {
        200: {
          description: "更新后的系统设置",
          content: { "application/json": { schema: SystemSettingsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    updateSystemSettings as never
  );

  // ============== GET /system/timezone ==============
  router.openapi(
    {
      method: "get",
      path: "/system/timezone",
      tags: [TAG],
      summary: "获取系统解析后的时区",
      description: "返回 { timeZone: string }。任意已认证身份均可访问。",
      security: SECURITY,
      responses: {
        200: {
          description: "时区",
          content: { "application/json": { schema: SystemTimezoneResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getSystemTimezone as never
  );

  return router;
}

export const systemRouter = createSystemRouter();
