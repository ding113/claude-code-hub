/**
 * /api/v1/dashboard 路由模块
 *
 * 大部分端点为 admin tier；overview / statistics / concurrent-sessions 视为 read tier
 * 由 action 内部决定可见数据。dispatch-simulator 是 admin。
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler, Next } from "hono";

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { requireCsrf } from "@/lib/api/v1/_shared/csrf";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  DashboardClientVersionsResponseSchema,
  DashboardConcurrentSessionsResponseSchema,
  DashboardOverviewResponseSchema,
  DashboardProviderSlotsResponseSchema,
  DashboardProxyStatusResponseSchema,
  DashboardRateLimitStatsResponseSchema,
  DashboardRealtimeResponseSchema,
  DashboardStatisticsResponseSchema,
  DispatchSimulatorRequestSchema,
  DispatchSimulatorResponseSchema,
} from "@/lib/api/v1/schemas/dashboard";

import {
  getClientVersions,
  getConcurrentSessions,
  getOverview,
  getProviderSlots,
  getProxyStatus,
  getRateLimitStats,
  getRealtime,
  getStatistics,
  simulateDecisionTree,
  simulateDispatch,
} from "./handlers";

const TAG = "Dashboard";

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

export function createDashboardRouter(): OpenAPIHono {
  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return fromZodError(c, result.error);
      }
    },
  });

  // 默认 read tier；admin-only 端点单独覆盖
  router.use("/dashboard", requireAuth({ tier: "read" }));
  router.use("/dashboard/*", requireAuth({ tier: "read" }));
  router.use("/dashboard", csrfForMutating());
  router.use("/dashboard/*", csrfForMutating());

  // GET /dashboard/overview
  router.openapi(
    {
      method: "get",
      path: "/dashboard/overview",
      tags: [TAG],
      summary: "Dashboard overview",
      security: SECURITY,
      responses: {
        200: {
          description: "Overview 数据",
          content: { "application/json": { schema: DashboardOverviewResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getOverview as never
  );

  // GET /dashboard/realtime（admin）
  router.openapi(
    {
      method: "get",
      path: "/dashboard/realtime",
      tags: [TAG],
      summary: "Dashboard realtime（admin）",
      security: SECURITY,
      responses: {
        200: {
          description: "Realtime 数据",
          content: { "application/json": { schema: DashboardRealtimeResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getRealtime as never
  );

  // GET /dashboard/statistics
  router.openapi(
    {
      method: "get",
      path: "/dashboard/statistics",
      tags: [TAG],
      summary: "用户统计",
      security: SECURITY,
      responses: {
        200: {
          description: "用户统计",
          content: { "application/json": { schema: DashboardStatisticsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getStatistics as never
  );

  // GET /dashboard/concurrent-sessions
  router.openapi(
    {
      method: "get",
      path: "/dashboard/concurrent-sessions",
      tags: [TAG],
      summary: "当前并发 sessions 数",
      security: SECURITY,
      responses: {
        200: {
          description: "并发数",
          content: { "application/json": { schema: DashboardConcurrentSessionsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getConcurrentSessions as never
  );

  // GET /dashboard/provider-slots（admin）
  router.openapi(
    {
      method: "get",
      path: "/dashboard/provider-slots",
      tags: [TAG],
      summary: "Provider 槽位状态（admin）",
      security: SECURITY,
      responses: {
        200: {
          description: "Provider slots",
          content: { "application/json": { schema: DashboardProviderSlotsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getProviderSlots as never
  );

  // GET /dashboard/rate-limit-stats（admin）
  router.openapi(
    {
      method: "get",
      path: "/dashboard/rate-limit-stats",
      tags: [TAG],
      summary: "速率限制统计（admin）",
      security: SECURITY,
      responses: {
        200: {
          description: "速率限制统计",
          content: { "application/json": { schema: DashboardRateLimitStatsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getRateLimitStats as never
  );

  // GET /dashboard/client-versions（admin）
  router.openapi(
    {
      method: "get",
      path: "/dashboard/client-versions",
      tags: [TAG],
      summary: "客户端版本统计（admin）",
      security: SECURITY,
      responses: {
        200: {
          description: "客户端版本统计",
          content: { "application/json": { schema: DashboardClientVersionsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getClientVersions as never
  );

  // GET /dashboard/proxy-status（admin）
  router.openapi(
    {
      method: "get",
      path: "/dashboard/proxy-status",
      tags: [TAG],
      summary: "代理状态（admin）",
      security: SECURITY,
      responses: {
        200: {
          description: "代理状态",
          content: { "application/json": { schema: DashboardProxyStatusResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getProxyStatus as never
  );

  // POST /dashboard/dispatch-simulator:decisionTree
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/dashboard/dispatch-simulator:decisionTree",
    tags: [TAG],
    summary: "模拟分发决策树（admin）",
    security: SECURITY,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: DispatchSimulatorRequestSchema } },
      },
    },
    responses: {
      200: {
        description: "决策树",
        content: { "application/json": { schema: DispatchSimulatorResponseSchema } },
      },
      ...errorResponses,
    },
  });
  router.post("/dashboard/dispatch-simulator:decisionTree", simulateDecisionTree);

  // POST /dashboard/dispatch-simulator:simulate
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/dashboard/dispatch-simulator:simulate",
    tags: [TAG],
    summary: "模拟分发动作（admin）",
    security: SECURITY,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: DispatchSimulatorRequestSchema } },
      },
    },
    responses: {
      200: {
        description: "模拟结果",
        content: { "application/json": { schema: DispatchSimulatorResponseSchema } },
      },
      ...errorResponses,
    },
  });
  router.post("/dashboard/dispatch-simulator:simulate", simulateDispatch);

  return router;
}

export const dashboardRouter = createDashboardRouter();
