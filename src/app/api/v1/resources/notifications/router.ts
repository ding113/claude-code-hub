/**
 * /api/v1/notifications 路由模块
 *
 * 端点：
 *   GET  /notifications/settings        (admin)
 *   PUT  /notifications/settings        (admin + CSRF)
 *   POST /notifications/test-webhook    (admin + CSRF)
 *
 * 注意：notification-bindings (`/notifications/types/{type}/bindings`) 由独立 router
 * 模块处理，避免本路由覆盖到 /notifications/types/* 子树。
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler, Next } from "hono";

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { requireCsrf } from "@/lib/api/v1/_shared/csrf";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  NotificationSettingsResponseSchema,
  NotificationSettingsUpdateSchema,
  TestWebhookRequestSchema,
  TestWebhookResponseSchema,
} from "@/lib/api/v1/schemas/notifications";

import { getNotificationSettings, testWebhook, updateNotificationSettings } from "./handlers";

const TAG = "Notifications";

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

export function createNotificationsRouter(): OpenAPIHono {
  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return fromZodError(c, result.error);
      }
    },
  });

  router.use("/notifications/settings", requireAuth({ tier: "admin" }));
  router.use("/notifications/settings", csrfForMutating());
  router.use("/notifications/test-webhook", requireAuth({ tier: "admin" }));
  router.use("/notifications/test-webhook", csrfForMutating());

  // ============== GET /notifications/settings ==============
  router.openapi(
    {
      method: "get",
      path: "/notifications/settings",
      tags: [TAG],
      summary: "获取通知设置",
      description:
        "返回完整的 NotificationSettings 行（含熔断器 / 排行榜 / 成本 / 缓存命中率四组配置）。",
      security: SECURITY,
      responses: {
        200: {
          description: "通知设置",
          content: { "application/json": { schema: NotificationSettingsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getNotificationSettings as never
  );

  // ============== PUT /notifications/settings ==============
  router.openapi(
    {
      method: "put",
      path: "/notifications/settings",
      tags: [TAG],
      summary: "更新通知设置（局部更新）",
      description: "局部更新通知设置。需要管理员权限；Cookie 鉴权时必须携带 X-CCH-CSRF。",
      security: SECURITY,
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: NotificationSettingsUpdateSchema } },
        },
      },
      responses: {
        200: {
          description: "更新后的通知设置",
          content: { "application/json": { schema: NotificationSettingsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    updateNotificationSettings as never
  );

  // ============== POST /notifications/test-webhook ==============
  router.openapi(
    {
      method: "post",
      path: "/notifications/test-webhook",
      tags: [TAG],
      summary: "测试任意 webhook 连通性",
      description:
        "向指定 URL 发送一次测试通知。Cookie 鉴权时必须携带 X-CCH-CSRF；响应带 Cache-Control: no-store。",
      security: SECURITY,
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: TestWebhookRequestSchema } },
        },
      },
      responses: {
        200: {
          description: "测试结果",
          content: { "application/json": { schema: TestWebhookResponseSchema } },
        },
        ...errorResponses,
      },
    },
    testWebhook as never
  );

  return router;
}

export const notificationsRouter = createNotificationsRouter();
