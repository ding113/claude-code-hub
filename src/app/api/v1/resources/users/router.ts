/**
 * /api/v1/users 路由模块
 *
 * 注册端点：
 *   GET    /users
 *   POST   /users
 *   GET    /users/tags
 *   GET    /users/key-groups
 *   GET    /users/{id}
 *   PATCH  /users/{id}
 *   DELETE /users/{id}
 *   POST   /users/{id}:enable
 *   POST   /users/{id}:renew
 *   POST   /users/{id}/limits:reset
 *
 * 因为 Hono 路由解析器不支持 `:id` 参数后紧跟另一个冒号字面量，
 * "action verb" 端点采用 `:idEnable{[0-9]+:enable}` 这种正则约束写法，
 * handler 内自行剥离 `:enable` 后缀；OpenAPI 文档则保持 `/{id}:enable` 的人类可读形式。
 *
 * 对于 `/users/{id}/limits:reset`：因为 Hono 同样不允许 `:id/limits:reset` 这种
 * 嵌套冒号，我们用 `:idLimitsReset{[0-9]+}/limits:reset` 把 :reset 放在最末尾的
 * 字面量段，OpenAPI 元数据仍以 `/users/{id}/limits:reset` 展示。
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler, Next } from "hono";

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { requireCsrf } from "@/lib/api/v1/_shared/csrf";
import { ProblemJsonSchema, ResourceIdParamSchema } from "@/lib/api/v1/schemas/_common";
import {
  UserCreateResponseSchema,
  UserCreateSchema,
  UserEnableSchema,
  UserKeyGroupsResponseSchema,
  UserListResponseSchema,
  UserRenewSchema,
  UserResponseSchema,
  UserTagsResponseSchema,
  UserUpdateSchema,
} from "@/lib/api/v1/schemas/users";

import {
  createUserHandler,
  deleteUserHandler,
  enableUserHandler,
  getUser,
  listUserKeyGroups,
  listUsers,
  listUserTags,
  patchUser,
  renewUserHandler,
  resetUserAllStatisticsHandler,
  resetUserLimitsHandler,
} from "./handlers";

const TAG = "Users";

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

export function createUsersRouter(): OpenAPIHono {
  const router = new OpenAPIHono();

  // 把鉴权 / CSRF 限制在 /users 自身路径前缀下，避免影响兄弟路由。
  router.use("/users", requireAuth({ tier: "admin" }));
  router.use("/users/*", requireAuth({ tier: "admin" }));
  router.use("/users", csrfForMutating());
  router.use("/users/*", csrfForMutating());

  // ============== GET /users ==============
  router.openapi(
    {
      method: "get",
      path: "/users",
      tags: [TAG],
      summary: "列出用户（游标分页）",
      description: "管理员接口；支持 cursor / limit / searchTerm / 状态过滤 / 排序 / 标签过滤。",
      security: SECURITY,
      responses: {
        200: {
          description: "用户列表",
          content: { "application/json": { schema: UserListResponseSchema } },
        },
        ...errorResponses,
      },
    },
    listUsers as never
  );

  // ============== POST /users ==============
  router.openapi(
    {
      method: "post",
      path: "/users",
      tags: [TAG],
      summary: "创建用户（同时生成默认 key）",
      description:
        "创建一个新用户并同步生成默认 key；响应中 defaultKey.key 是原始 API key 字符串，**仅在此响应里出现一次**。需要管理员权限，cookie 鉴权时必须携带 X-CCH-CSRF。",
      security: SECURITY,
      request: {
        body: { required: true, content: { "application/json": { schema: UserCreateSchema } } },
      },
      responses: {
        201: {
          description: "用户创建成功",
          headers: {
            Location: { description: "新用户的相对 URL", schema: { type: "string" } },
          },
          content: { "application/json": { schema: UserCreateResponseSchema } },
        },
        ...errorResponses,
      },
    },
    createUserHandler as never
  );

  // ============== GET /users/tags ==============
  router.openapi(
    {
      method: "get",
      path: "/users/tags",
      tags: [TAG],
      summary: "列出所有用户标签",
      description: "返回去重后的用户标签集合，用于筛选下拉框。需要管理员权限。",
      security: SECURITY,
      responses: {
        200: {
          description: "用户标签列表",
          content: { "application/json": { schema: UserTagsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    listUserTags as never
  );

  // ============== GET /users/key-groups ==============
  router.openapi(
    {
      method: "get",
      path: "/users/key-groups",
      tags: [TAG],
      summary: "列出所有用户 key 分组",
      description: "返回去重后的用户 key 分组集合，用于筛选下拉框。需要管理员权限。",
      security: SECURITY,
      responses: {
        200: {
          description: "Key 分组列表",
          content: { "application/json": { schema: UserKeyGroupsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    listUserKeyGroups as never
  );

  // ============== GET /users/{id} ==============
  router.openapi(
    {
      method: "get",
      path: "/users/{id}",
      tags: [TAG],
      summary: "查询单个用户",
      description: "通过数字 id 获取单个用户；敏感字段已脱敏。需要管理员权限。",
      security: SECURITY,
      request: { params: ResourceIdParamSchema },
      responses: {
        200: {
          description: "用户详情",
          content: { "application/json": { schema: UserResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getUser as never
  );

  // ============== PATCH /users/{id} ==============
  router.openapi(
    {
      method: "patch",
      path: "/users/{id}",
      tags: [TAG],
      summary: "更新用户",
      description: "局部更新一个用户；未提供的字段保持原值。Cookie 鉴权时必须携带 X-CCH-CSRF。",
      security: SECURITY,
      request: {
        params: ResourceIdParamSchema,
        body: { required: true, content: { "application/json": { schema: UserUpdateSchema } } },
      },
      responses: {
        200: {
          description: "更新后的用户",
          content: { "application/json": { schema: UserResponseSchema } },
        },
        ...errorResponses,
      },
    },
    patchUser as never
  );

  // ============== DELETE /users/{id} ==============
  router.openapi(
    {
      method: "delete",
      path: "/users/{id}",
      tags: [TAG],
      summary: "删除用户",
      description: "删除指定用户（软删）；幂等。Cookie 鉴权时必须携带 X-CCH-CSRF。",
      security: SECURITY,
      request: { params: ResourceIdParamSchema },
      responses: {
        204: { description: "删除成功（无响应体）" },
        ...errorResponses,
      },
    },
    deleteUserHandler
  );

  // ============== POST /users/{id}:enable ==============
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/users/{id}:enable",
    tags: [TAG],
    summary: "切换用户启用状态",
    description: "把用户置为启用 / 禁用；Cookie 鉴权时必须携带 X-CCH-CSRF。",
    security: SECURITY,
    request: {
      params: ResourceIdParamSchema,
      body: { required: true, content: { "application/json": { schema: UserEnableSchema } } },
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
  router.post("/users/:idEnable{[0-9]+:enable}", enableUserHandler);

  // ============== POST /users/{id}:renew ==============
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/users/{id}:renew",
    tags: [TAG],
    summary: "续期用户",
    description: "更新用户的过期时间；可选同时启用用户。Cookie 鉴权时必须携带 X-CCH-CSRF。",
    security: SECURITY,
    request: {
      params: ResourceIdParamSchema,
      body: { required: true, content: { "application/json": { schema: UserRenewSchema } } },
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
  router.post("/users/:idRenew{[0-9]+:renew}", renewUserHandler);

  // ============== POST /users/{id}/limits:reset ==============
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/users/{id}/limits:reset",
    tags: [TAG],
    summary: "重置用户限额",
    description:
      "设置 costResetAt = NOW() 让所有花销统计从此刻起重新累计；不会删除日志或统计数据。需要管理员权限。",
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
  // Hono 不允许 `:id/limits:reset`，在尾段使用字面量 :reset。
  router.post("/users/:idLimitsReset{[0-9]+}/limits:reset", resetUserLimitsHandler);

  // ============== POST /users/{id}/statistics:reset ==============
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/users/{id}/statistics:reset",
    tags: [TAG],
    summary: "重置用户的所有统计数据（不可逆）",
    description:
      "删除用户的所有 messageRequest 日志 + 清空 ledger + 清理 Redis 中的成本/会话缓存。仅 admin 可调用，操作不可逆。",
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
  router.post("/users/:idStatsReset{[0-9]+}/statistics:reset", resetUserAllStatisticsHandler);

  return router;
}

export const usersRouter = createUsersRouter();
