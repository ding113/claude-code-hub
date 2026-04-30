/**
 * /api/v1/webhook-targets 路由模块
 *
 * - 通过 OpenAPIHono 注册 6 个端点：
 *     GET    /webhook-targets
 *     POST   /webhook-targets
 *     GET    /webhook-targets/{id}
 *     PATCH  /webhook-targets/{id}
 *     DELETE /webhook-targets/{id}
 *     POST   /webhook-targets/{id}:test
 * - 所有端点要求 admin tier；写方法（POST/PATCH/DELETE）额外强制 CSRF；
 * - 由于 Hono 的路由解析器不支持 `:id` 参数后紧跟另一个冒号字面量，
 *   `/{id}:test` 这种「action verb」端点采用「正则约束捕获 :test 后缀」的
 *   写法 `:idTest{[0-9]+:test}`，handler 内自行剥离前缀；
 * - OpenAPI 文档中仍以人类可读的 `/{id}:test` 路径暴露，便于 SDK 与文档生成。
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler, Next } from "hono";

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { requireCsrf } from "@/lib/api/v1/_shared/csrf";
import { ProblemJsonSchema, ResourceIdParamSchema } from "@/lib/api/v1/schemas/_common";
import {
  WebhookTargetCreateSchema,
  WebhookTargetListResponseSchema,
  WebhookTargetResponseSchema,
  WebhookTargetTestResponseSchema,
  WebhookTargetTestSchema,
  WebhookTargetUpdateSchema,
} from "@/lib/api/v1/schemas/webhook-targets";

import {
  createWebhookTarget,
  deleteWebhookTarget,
  getWebhookTarget,
  listWebhookTargets,
  patchWebhookTarget,
  testWebhookTarget,
} from "./handlers";

const TAG = "Webhook Targets";

const SECURITY: Array<Record<string, string[]>> = [
  { bearerAuth: [] },
  { apiKeyAuth: [] },
  { cookieAuth: [] },
];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * 仅对写方法应用 CSRF 中间件；GET/HEAD/OPTIONS 跳过。
 *
 * 注意：requireCsrf() 自身已对安全方法 short-circuit，但显式封装一次便于将
 * 来调整策略（例如希望某些 GET 也需 CSRF 的极端场景）。
 */
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

export function createWebhookTargetsRouter(): OpenAPIHono {
  const router = new OpenAPIHono();

  // Scope middleware to /webhook-targets/* only — using "*" would catch every
  // path under the parent app's basePath, including /messages which must fall
  // through to the parent's 404 handler unauthenticated.
  router.use("/webhook-targets", requireAuth({ tier: "admin" }));
  router.use("/webhook-targets/*", requireAuth({ tier: "admin" }));
  router.use("/webhook-targets", csrfForMutating());
  router.use("/webhook-targets/*", csrfForMutating());

  // ============== GET /webhook-targets ==============
  router.openapi(
    {
      method: "get",
      path: "/webhook-targets",
      tags: [TAG],
      summary: "列出所有 webhook 推送目标",
      description: "返回全部 webhook 推送目标；敏感字段已脱敏。需要管理员权限。",
      security: SECURITY,
      responses: {
        200: {
          description: "推送目标列表",
          content: { "application/json": { schema: WebhookTargetListResponseSchema } },
        },
        ...errorResponses,
      },
    },
    listWebhookTargets as never
  );

  // ============== POST /webhook-targets ==============
  router.openapi(
    {
      method: "post",
      path: "/webhook-targets",
      tags: [TAG],
      summary: "创建 webhook 推送目标",
      description:
        "创建一个新的 webhook 推送目标。需要管理员权限，cookie 鉴权时必须携带 X-CCH-CSRF。响应中敏感字段已脱敏。",
      security: SECURITY,
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: WebhookTargetCreateSchema } },
        },
      },
      responses: {
        201: {
          description: "创建成功；Location 头指向新资源",
          headers: {
            Location: {
              description: "新资源的相对 URL",
              schema: { type: "string" },
            },
          },
          content: { "application/json": { schema: WebhookTargetResponseSchema } },
        },
        ...errorResponses,
      },
    },
    createWebhookTarget as never
  );

  // ============== GET /webhook-targets/{id} ==============
  router.openapi(
    {
      method: "get",
      path: "/webhook-targets/{id}",
      tags: [TAG],
      summary: "查询单个 webhook 推送目标",
      description: "通过数字 id 获取单个推送目标；敏感字段已脱敏。",
      security: SECURITY,
      request: { params: ResourceIdParamSchema },
      responses: {
        200: {
          description: "推送目标详情",
          content: { "application/json": { schema: WebhookTargetResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getWebhookTarget as never
  );

  // ============== PATCH /webhook-targets/{id} ==============
  router.openapi(
    {
      method: "patch",
      path: "/webhook-targets/{id}",
      tags: [TAG],
      summary: "更新 webhook 推送目标",
      description: "局部更新一个推送目标；未提供的字段保持原值。Cookie 鉴权时必须携带 X-CCH-CSRF。",
      security: SECURITY,
      request: {
        params: ResourceIdParamSchema,
        body: {
          required: true,
          content: { "application/json": { schema: WebhookTargetUpdateSchema } },
        },
      },
      responses: {
        200: {
          description: "更新后的推送目标",
          content: { "application/json": { schema: WebhookTargetResponseSchema } },
        },
        ...errorResponses,
      },
    },
    patchWebhookTarget as never
  );

  // ============== DELETE /webhook-targets/{id} ==============
  router.openapi(
    {
      method: "delete",
      path: "/webhook-targets/{id}",
      tags: [TAG],
      summary: "删除 webhook 推送目标",
      description: "删除指定的推送目标；幂等。Cookie 鉴权时必须携带 X-CCH-CSRF。",
      security: SECURITY,
      request: { params: ResourceIdParamSchema },
      responses: {
        204: { description: "删除成功（无响应体）" },
        ...errorResponses,
      },
    },
    deleteWebhookTarget
  );

  // ============== POST /webhook-targets/{id}:test ==============
  // OpenAPI 元数据使用 `/{id}:test`；运行时路径使用正则约束 `:idTest{[0-9]+:test}`。
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/webhook-targets/{id}:test",
    tags: [TAG],
    summary: "向 webhook 推送目标发送测试通知",
    description:
      "向指定的推送目标发送一次测试通知，便于排查配置问题。响应包含本次发送耗时；带 Cache-Control: no-store。Cookie 鉴权时必须携带 X-CCH-CSRF。",
    security: SECURITY,
    request: {
      params: ResourceIdParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: WebhookTargetTestSchema } },
      },
    },
    responses: {
      200: {
        description: "测试已发送",
        content: { "application/json": { schema: WebhookTargetTestResponseSchema } },
      },
      ...errorResponses,
    },
  });

  // 实际路由：`:idTest{[0-9]+:test}` 把 "42:test" 整段捕获，
  // handler 通过 `c.req.param("idTest")` 读取并自行剥离 `:test` 后缀。
  router.post("/webhook-targets/:idTest{[0-9]+:test}", testWebhookTarget);

  return router;
}

export const webhookTargetsRouter = createWebhookTargetsRouter();
