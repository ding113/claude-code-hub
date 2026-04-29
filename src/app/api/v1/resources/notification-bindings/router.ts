/**
 * /api/v1/notifications/types/{type}/bindings 路由模块
 *
 * 端点：
 *   GET /notifications/types/{type}/bindings  (admin)
 *   PUT /notifications/types/{type}/bindings  (admin + CSRF)
 *
 * type ∈ { circuit_breaker, daily_leaderboard, cost_alert, cache_hit_rate_alert }。
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler, Next } from "hono";

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { requireCsrf } from "@/lib/api/v1/_shared/csrf";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  NotificationBindingListResponseSchema,
  NotificationBindingsUpdateSchema,
  NotificationTypeParamSchema,
} from "@/lib/api/v1/schemas/notification-bindings";

import { listBindings, updateBindings } from "./handlers";

const TAG = "Notification Bindings";

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

export function createNotificationBindingsRouter(): OpenAPIHono {
  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return fromZodError(c, result.error);
      }
    },
  });

  router.use("/notifications/types/*", requireAuth({ tier: "admin" }));
  router.use("/notifications/types/*", csrfForMutating());

  // ============== GET /notifications/types/{type}/bindings ==============
  router.openapi(
    {
      method: "get",
      path: "/notifications/types/{type}/bindings",
      tags: [TAG],
      summary: "列出某通知类型下的全部绑定",
      description:
        "返回该 type 下的全部绑定（含已脱敏的 target）。type ∈ { circuit_breaker | daily_leaderboard | cost_alert | cache_hit_rate_alert }。",
      security: SECURITY,
      request: { params: NotificationTypeParamSchema },
      responses: {
        200: {
          description: "绑定列表",
          content: { "application/json": { schema: NotificationBindingListResponseSchema } },
        },
        ...errorResponses,
      },
    },
    listBindings as never
  );

  // ============== PUT /notifications/types/{type}/bindings ==============
  router.openapi(
    {
      method: "put",
      path: "/notifications/types/{type}/bindings",
      tags: [TAG],
      summary: "整体替换某通知类型下的绑定",
      description:
        "PUT 是整体替换语义：未在 bindings 列表中的绑定会被删除。Cookie 鉴权时必须携带 X-CCH-CSRF。",
      security: SECURITY,
      request: {
        params: NotificationTypeParamSchema,
        body: {
          required: true,
          content: { "application/json": { schema: NotificationBindingsUpdateSchema } },
        },
      },
      responses: {
        200: {
          description: "更新后的绑定列表",
          content: { "application/json": { schema: NotificationBindingListResponseSchema } },
        },
        ...errorResponses,
      },
    },
    updateBindings as never
  );

  return router;
}

export const notificationBindingsRouter = createNotificationBindingsRouter();
