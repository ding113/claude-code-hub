/**
 * /api/v1/keys 路由模块
 *
 * 注册端点（注意 listForUser / createForUser 都挂在 /users/{userId}/keys 下，但仍属 keys 资源）：
 *
 *   GET    /users/{userId}/keys
 *   POST   /users/{userId}/keys
 *   PATCH  /keys/{id}
 *   DELETE /keys/{id}
 *   POST   /keys/{id}:enable
 *   POST   /keys/{id}:renew
 *   POST   /keys/{id}/limits:reset
 *   GET    /keys/{id}/limit-usage    // read tier，由 action 内部校验是否归属当前用户
 *
 * 参考 webhook-targets 的 `:idTest` 写法，使用正则约束 `:idEnable{[0-9]+:enable}` 等
 * 把动作动词分别匹配到不同 handler。
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler, Next } from "hono";

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { requireCsrf } from "@/lib/api/v1/_shared/csrf";
import { ProblemJsonSchema, ResourceIdParamSchema } from "@/lib/api/v1/schemas/_common";
import {
  KeyCreatedResponseSchema,
  KeyCreateSchema,
  KeyEnableSchema,
  KeyLimitUsageResponseSchema,
  KeyListResponseSchema,
  KeyRenewSchema,
  KeyUpdateSchema,
} from "@/lib/api/v1/schemas/keys";

import {
  createKeyHandler,
  deleteKeyHandler,
  enableKeyHandler,
  getKeyLimitUsageHandler,
  listKeysForUser,
  patchKey,
  renewKeyHandler,
  resetKeyLimitsHandler,
} from "./handlers";

const TAG = "Keys";

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

const UserIdParamSchema = z
  .object({
    userId: z.coerce.number().int().positive().describe("用户 ID"),
  })
  .describe("Path 参数：用户 ID")
  .openapi({ example: { userId: 1 } });

export function createKeysRouter(): OpenAPIHono {
  const router = new OpenAPIHono();

  // /users/{userId}/keys/* 与 /keys/* 都需要鉴权；GET /keys/{id}/limit-usage 是 read tier。
  router.use("/keys/:id/limit-usage", requireAuth({ tier: "read" }));
  // 其他 /keys/* 与 /users/.../keys/* 都需 admin。
  router.use("/users/:userId/keys", requireAuth({ tier: "admin" }));
  router.use("/users/:userId/keys/*", requireAuth({ tier: "admin" }));
  router.use("/keys", requireAuth({ tier: "admin" }));
  router.use("/keys/*", async (c, next) => {
    // limit-usage 已被前面的 read tier 处理；这里只在 path 不匹配时下沉到 admin。
    if (c.req.path.endsWith("/limit-usage")) {
      return next();
    }
    return requireAuth({ tier: "admin" })(c, next);
  });
  router.use("/users/:userId/keys", csrfForMutating());
  router.use("/users/:userId/keys/*", csrfForMutating());
  router.use("/keys", csrfForMutating());
  router.use("/keys/*", csrfForMutating());

  // ============== GET /users/{userId}/keys ==============
  router.openapi(
    {
      method: "get",
      path: "/users/{userId}/keys",
      tags: [TAG],
      summary: "列出用户的 keys",
      description:
        "返回指定用户的 key 列表（已脱敏）。可附 `?include=statistics` 同时返回各 key 的统计数据。",
      security: SECURITY,
      request: {
        params: UserIdParamSchema,
      },
      responses: {
        200: {
          description: "Key 列表",
          content: { "application/json": { schema: KeyListResponseSchema } },
        },
        ...errorResponses,
      },
    },
    listKeysForUser as never
  );

  // ============== POST /users/{userId}/keys ==============
  router.openapi(
    {
      method: "post",
      path: "/users/{userId}/keys",
      tags: [TAG],
      summary: "为用户创建 key",
      description:
        "为指定用户创建一个新的 key；响应中 `key` 字段是原始 API key 字符串，**仅在此响应里出现一次**，调用方应立即让用户保存。需要管理员权限。",
      security: SECURITY,
      request: {
        params: UserIdParamSchema,
        body: { required: true, content: { "application/json": { schema: KeyCreateSchema } } },
      },
      responses: {
        201: {
          description: "Key 创建成功；Location 指向新 key",
          headers: {
            Location: { description: "新 key 的相对 URL", schema: { type: "string" } },
          },
          content: { "application/json": { schema: KeyCreatedResponseSchema } },
        },
        ...errorResponses,
      },
    },
    createKeyHandler as never
  );

  // ============== PATCH /keys/{id} ==============
  router.openapi(
    {
      method: "patch",
      path: "/keys/{id}",
      tags: [TAG],
      summary: "更新 key",
      description: "局部更新一个 key；未提供的字段保持原值。Cookie 鉴权时必须携带 X-CCH-CSRF。",
      security: SECURITY,
      request: {
        params: ResourceIdParamSchema,
        body: { required: true, content: { "application/json": { schema: KeyUpdateSchema } } },
      },
      responses: {
        200: {
          description: "更新成功",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  id: { type: "integer" },
                },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
    patchKey as never
  );

  // ============== DELETE /keys/{id} ==============
  router.openapi(
    {
      method: "delete",
      path: "/keys/{id}",
      tags: [TAG],
      summary: "删除 key",
      description: "删除指定 key；幂等。Cookie 鉴权时必须携带 X-CCH-CSRF。",
      security: SECURITY,
      request: { params: ResourceIdParamSchema },
      responses: {
        204: { description: "删除成功（无响应体）" },
        ...errorResponses,
      },
    },
    deleteKeyHandler
  );

  // ============== POST /keys/{id}:enable ==============
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/keys/{id}:enable",
    tags: [TAG],
    summary: "切换 key 启用状态",
    description: "把 key 置为启用 / 禁用；Cookie 鉴权时必须携带 X-CCH-CSRF。",
    security: SECURITY,
    request: {
      params: ResourceIdParamSchema,
      body: { required: true, content: { "application/json": { schema: KeyEnableSchema } } },
    },
    responses: {
      200: {
        description: "切换成功",
        content: {
          "application/json": {
            schema: { type: "object", properties: { ok: { type: "boolean" } } },
          },
        },
      },
      ...errorResponses,
    },
  });
  router.post("/keys/:idEnable{[0-9]+:enable}", enableKeyHandler);

  // ============== POST /keys/{id}:renew ==============
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/keys/{id}:renew",
    tags: [TAG],
    summary: "续期 key",
    description: "更新 key 的过期时间；可选同时启用 key。Cookie 鉴权时必须携带 X-CCH-CSRF。",
    security: SECURITY,
    request: {
      params: ResourceIdParamSchema,
      body: { required: true, content: { "application/json": { schema: KeyRenewSchema } } },
    },
    responses: {
      200: {
        description: "续期成功",
        content: {
          "application/json": {
            schema: { type: "object", properties: { ok: { type: "boolean" } } },
          },
        },
      },
      ...errorResponses,
    },
  });
  router.post("/keys/:idRenew{[0-9]+:renew}", renewKeyHandler);

  // ============== POST /keys/{id}/limits:reset ==============
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/keys/{id}/limits:reset",
    tags: [TAG],
    summary: "重置 key 限额",
    description: "设置 key.costResetAt = NOW()，让所有花销重新累计；不删日志。需要管理员权限。",
    security: SECURITY,
    request: { params: ResourceIdParamSchema },
    responses: {
      200: {
        description: "重置成功",
        content: {
          "application/json": {
            schema: { type: "object", properties: { ok: { type: "boolean" } } },
          },
        },
      },
      ...errorResponses,
    },
  });
  router.post("/keys/:idLimitsReset{[0-9]+}/limits:reset", resetKeyLimitsHandler);

  // ============== GET /keys/{id}/limit-usage ==============
  router.openapi(
    {
      method: "get",
      path: "/keys/{id}/limit-usage",
      tags: [TAG],
      summary: "查询 key 实时限额使用情况",
      description:
        "返回 key 的 5h / daily / weekly / monthly / total / concurrentSessions 实时使用量。Read tier；普通用户只能查询自己的 key（由 action 内部校验）。",
      security: SECURITY,
      request: { params: ResourceIdParamSchema },
      responses: {
        200: {
          description: "限额使用情况",
          content: { "application/json": { schema: KeyLimitUsageResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getKeyLimitUsageHandler as never
  );

  return router;
}

export const keysRouter = createKeysRouter();
