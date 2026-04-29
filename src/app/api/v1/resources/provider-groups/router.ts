/**
 * /api/v1/provider-groups 路由模块
 *
 * 端点：
 *   GET    /provider-groups
 *   POST   /provider-groups
 *   PATCH  /provider-groups/{id}
 *   DELETE /provider-groups/{id}
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler, Next } from "hono";

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { requireCsrf } from "@/lib/api/v1/_shared/csrf";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema, ResourceIdParamSchema } from "@/lib/api/v1/schemas/_common";
import {
  ProviderGroupCreateSchema,
  ProviderGroupListResponseSchema,
  ProviderGroupResponseSchema,
  ProviderGroupUpdateSchema,
} from "@/lib/api/v1/schemas/provider-groups";

import {
  createProviderGroupHandler,
  deleteProviderGroupHandler,
  listProviderGroups,
  patchProviderGroupHandler,
} from "./handlers";

const TAG = "Provider Groups";

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

export function createProviderGroupsRouter(): OpenAPIHono {
  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return fromZodError(c, result.error);
      }
    },
  });

  router.use("/provider-groups", requireAuth({ tier: "admin" }));
  router.use("/provider-groups/*", requireAuth({ tier: "admin" }));
  router.use("/provider-groups", csrfForMutating());
  router.use("/provider-groups/*", csrfForMutating());

  // ============== GET /provider-groups ==============
  router.openapi(
    {
      method: "get",
      path: "/provider-groups",
      tags: [TAG],
      summary: "列出 provider groups",
      description: "返回所有分组及每个分组下的 provider 数量。",
      security: SECURITY,
      responses: {
        200: {
          description: "Provider groups 列表",
          content: { "application/json": { schema: ProviderGroupListResponseSchema } },
        },
        ...errorResponses,
      },
    },
    listProviderGroups as never
  );

  // ============== POST /provider-groups ==============
  router.openapi(
    {
      method: "post",
      path: "/provider-groups",
      tags: [TAG],
      summary: "创建 provider group",
      security: SECURITY,
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: ProviderGroupCreateSchema } },
        },
      },
      responses: {
        201: {
          description: "创建成功",
          headers: {
            Location: { description: "新分组的相对 URL", schema: { type: "string" } },
          },
          content: { "application/json": { schema: ProviderGroupResponseSchema } },
        },
        ...errorResponses,
      },
    },
    createProviderGroupHandler as never
  );

  // ============== PATCH /provider-groups/{id} ==============
  router.openapi(
    {
      method: "patch",
      path: "/provider-groups/{id}",
      tags: [TAG],
      summary: "更新 provider group",
      security: SECURITY,
      request: {
        params: ResourceIdParamSchema,
        body: {
          required: true,
          content: { "application/json": { schema: ProviderGroupUpdateSchema } },
        },
      },
      responses: {
        200: {
          description: "更新后的分组",
          content: { "application/json": { schema: ProviderGroupResponseSchema } },
        },
        ...errorResponses,
      },
    },
    patchProviderGroupHandler as never
  );

  // ============== DELETE /provider-groups/{id} ==============
  router.openapi(
    {
      method: "delete",
      path: "/provider-groups/{id}",
      tags: [TAG],
      summary: "删除 provider group",
      description: "默认分组不可删除；存在引用时会返回 409。",
      security: SECURITY,
      request: { params: ResourceIdParamSchema },
      responses: {
        204: { description: "删除成功（无响应体）" },
        ...errorResponses,
      },
    },
    deleteProviderGroupHandler
  );

  return router;
}

export const providerGroupsRouter = createProviderGroupsRouter();
