/**
 * /api/v1/sessions 路由模块
 *
 * 端点：read tier；action 自身基于 session.user.role 自助过滤。
 * - DELETE / batchTerminate 是写操作，仍要求 CSRF；
 * - 普通用户仅能终止自己的 session。
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler, Next } from "hono";

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { requireCsrf } from "@/lib/api/v1/_shared/csrf";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  SessionDetailResponseSchema,
  SessionIdParamSchema,
  SessionMessagesResponseSchema,
  SessionOriginChainResponseSchema,
  SessionRequestsResponseSchema,
  SessionResponseBodyResponseSchema,
  SessionsBatchTerminateRequestSchema,
  SessionsBatchTerminateResponseSchema,
  SessionsListResponseSchema,
} from "@/lib/api/v1/schemas/sessions";

import {
  batchTerminateSessions,
  getSessionDetail,
  getSessionMessages,
  getSessionOriginChain,
  getSessionRequests,
  getSessionResponse,
  listSessions,
  terminateSession,
} from "./handlers";

const TAG = "Sessions";

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

export function createSessionsRouter(): OpenAPIHono {
  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return fromZodError(c, result.error);
      }
    },
  });

  router.use("/sessions", requireAuth({ tier: "read" }));
  router.use("/sessions/*", requireAuth({ tier: "read" }));
  router.use("/sessions", csrfForMutating());
  router.use("/sessions/*", csrfForMutating());

  // GET /sessions
  router.openapi(
    {
      method: "get",
      path: "/sessions",
      tags: [TAG],
      summary: "列出活跃 sessions（state=active 默认）",
      security: SECURITY,
      responses: {
        200: {
          description: "Sessions 列表",
          content: { "application/json": { schema: SessionsListResponseSchema } },
        },
        ...errorResponses,
      },
    },
    listSessions as never
  );

  // POST /sessions:batchTerminate
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/sessions:batchTerminate",
    tags: [TAG],
    summary: "批量终止 sessions",
    security: SECURITY,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: SessionsBatchTerminateRequestSchema } },
      },
    },
    responses: {
      200: {
        description: "批量终止结果",
        content: { "application/json": { schema: SessionsBatchTerminateResponseSchema } },
      },
      ...errorResponses,
    },
  });
  router.post("/sessions:batchTerminate", batchTerminateSessions);

  // GET /sessions/{sessionId}
  router.openapi(
    {
      method: "get",
      path: "/sessions/{sessionId}",
      tags: [TAG],
      summary: "获取 session 详情",
      security: SECURITY,
      request: { params: SessionIdParamSchema },
      responses: {
        200: {
          description: "Session 详情",
          content: { "application/json": { schema: SessionDetailResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getSessionDetail as never
  );

  // GET /sessions/{sessionId}/messages
  router.openapi(
    {
      method: "get",
      path: "/sessions/{sessionId}/messages",
      tags: [TAG],
      summary: "获取 session messages",
      security: SECURITY,
      request: { params: SessionIdParamSchema },
      responses: {
        200: {
          description: "Messages 内容",
          content: { "application/json": { schema: SessionMessagesResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getSessionMessages as never
  );

  // HEAD /sessions/{sessionId}/messages — for hasSessionMessages
  router.on("HEAD", "/sessions/:sessionId/messages", getSessionMessages);

  // GET /sessions/{sessionId}/requests
  router.openapi(
    {
      method: "get",
      path: "/sessions/{sessionId}/requests",
      tags: [TAG],
      summary: "获取 session 请求列表",
      security: SECURITY,
      request: { params: SessionIdParamSchema },
      responses: {
        200: {
          description: "Requests",
          content: { "application/json": { schema: SessionRequestsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getSessionRequests as never
  );

  // GET /sessions/{sessionId}/origin-chain
  router.openapi(
    {
      method: "get",
      path: "/sessions/{sessionId}/origin-chain",
      tags: [TAG],
      summary: "获取 session origin chain",
      security: SECURITY,
      request: { params: SessionIdParamSchema },
      responses: {
        200: {
          description: "Origin chain",
          content: { "application/json": { schema: SessionOriginChainResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getSessionOriginChain as never
  );

  // GET /sessions/{sessionId}/response
  router.openapi(
    {
      method: "get",
      path: "/sessions/{sessionId}/response",
      tags: [TAG],
      summary: "获取 session 响应体内容",
      security: SECURITY,
      request: { params: SessionIdParamSchema },
      responses: {
        200: {
          description: "响应体内容",
          content: { "application/json": { schema: SessionResponseBodyResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getSessionResponse as never
  );

  // DELETE /sessions/{sessionId}
  router.openapi(
    {
      method: "delete",
      path: "/sessions/{sessionId}",
      tags: [TAG],
      summary: "终止单个 session",
      security: SECURITY,
      request: { params: SessionIdParamSchema },
      responses: {
        204: { description: "终止成功（无响应体）" },
        ...errorResponses,
      },
    },
    terminateSession as never
  );

  return router;
}

export const sessionsRouter = createSessionsRouter();
