import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  DashboardArrayResponseSchema,
  DashboardConcurrentSessionsResponseSchema,
  DashboardGenericObjectSchema,
  DashboardOverviewResponseSchema,
  DashboardRateLimitStatsQuerySchema,
  DashboardStatisticsQuerySchema,
  DispatchSimulatorInputSchema,
} from "@/lib/api/v1/schemas/dashboard";
import {
  getDashboardClientVersions,
  getDashboardConcurrentSessions,
  getDashboardOverview,
  getDashboardProviderSlots,
  getDashboardProxyStatus,
  getDashboardRateLimitStats,
  getDashboardRealtime,
  getDashboardStatistics,
  simulateDispatch,
} from "./handlers";

export const dashboardRouter = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) return fromZodError(result.error, new URL(c.req.url).pathname);
  },
});

const security: Array<Record<string, string[]>> = [
  { cookieAuth: [] },
  { bearerAuth: [] },
  { apiKeyAuth: [] },
];

const problemResponses = {
  400: {
    description: "Invalid request.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  401: {
    description: "Authentication required.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  403: {
    description: "Access denied.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

dashboardRouter.openapi(
  createRoute({
    method: "get",
    path: "/dashboard/overview",
    middleware: requireAuth("read"),
    tags: ["Dashboard"],
    summary: "Get dashboard overview",
    description: "Returns overview metrics for the current caller scope.",
    "x-required-access": "read",
    security,
    responses: {
      200: {
        description: "Dashboard overview.",
        content: { "application/json": { schema: DashboardOverviewResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getDashboardOverview as never
);

dashboardRouter.openapi(
  createRoute({
    method: "get",
    path: "/dashboard/statistics",
    middleware: requireAuth("read"),
    tags: ["Dashboard"],
    summary: "Get dashboard statistics",
    description: "Returns chart-ready usage statistics for the selected time range.",
    "x-required-access": "read",
    security,
    request: { query: DashboardStatisticsQuerySchema },
    responses: {
      200: {
        description: "Dashboard statistics.",
        content: { "application/json": { schema: DashboardGenericObjectSchema } },
      },
      ...problemResponses,
    },
  }),
  getDashboardStatistics as never
);

dashboardRouter.openapi(
  createRoute({
    method: "get",
    path: "/dashboard/concurrent-sessions",
    middleware: requireAuth("read"),
    tags: ["Dashboard"],
    summary: "Get concurrent session count",
    description:
      "Returns the current concurrent session count for admins or when global usage viewing is enabled.",
    "x-required-access": "read",
    security,
    responses: {
      200: {
        description: "Concurrent session count.",
        content: { "application/json": { schema: DashboardConcurrentSessionsResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getDashboardConcurrentSessions as never
);

dashboardRouter.openapi(
  createRoute({
    method: "get",
    path: "/dashboard/realtime",
    middleware: requireAuth("admin"),
    tags: ["Dashboard"],
    summary: "Get realtime dashboard",
    description: "Returns realtime dashboard data for admin operators.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Realtime dashboard data.",
        content: { "application/json": { schema: DashboardGenericObjectSchema } },
      },
      ...problemResponses,
    },
  }),
  getDashboardRealtime as never
);

dashboardRouter.openapi(
  createRoute({
    method: "get",
    path: "/dashboard/provider-slots",
    middleware: requireAuth("admin"),
    tags: ["Dashboard"],
    summary: "Get provider slots",
    description: "Returns provider concurrency slot data.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Provider slots.",
        content: { "application/json": { schema: DashboardArrayResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getDashboardProviderSlots as never
);

dashboardRouter.openapi(
  createRoute({
    method: "get",
    path: "/dashboard/rate-limit-stats",
    middleware: requireAuth("admin"),
    tags: ["Dashboard"],
    summary: "Get rate limit statistics",
    description: "Returns rate limit event statistics with optional filters.",
    "x-required-access": "admin",
    security,
    request: { query: DashboardRateLimitStatsQuerySchema },
    responses: {
      200: {
        description: "Rate limit statistics.",
        content: { "application/json": { schema: DashboardGenericObjectSchema } },
      },
      ...problemResponses,
    },
  }),
  getDashboardRateLimitStats as never
);

dashboardRouter.openapi(
  createRoute({
    method: "get",
    path: "/dashboard/proxy-status",
    middleware: requireAuth("admin"),
    tags: ["Dashboard"],
    summary: "Get proxy status",
    description: "Returns proxy status for all users.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Proxy status.",
        content: { "application/json": { schema: DashboardGenericObjectSchema } },
      },
      ...problemResponses,
    },
  }),
  getDashboardProxyStatus as never
);

dashboardRouter.openapi(
  createRoute({
    method: "get",
    path: "/dashboard/client-versions",
    middleware: requireAuth("admin"),
    tags: ["Dashboard"],
    summary: "Get client version statistics",
    description: "Returns aggregated client version statistics.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Client version statistics.",
        content: { "application/json": { schema: DashboardArrayResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getDashboardClientVersions as never
);

dashboardRouter.openapi(
  createRoute({
    method: "post",
    path: "/dashboard/dispatch-simulator:simulate",
    middleware: requireAuth("admin"),
    tags: ["Dashboard"],
    summary: "Simulate provider dispatch",
    description: "Runs provider dispatch simulation for the supplied model and group filters.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: DispatchSimulatorInputSchema } },
      },
    },
    responses: {
      200: {
        description: "Dispatch simulation result.",
        content: { "application/json": { schema: DashboardGenericObjectSchema } },
      },
      ...problemResponses,
    },
  }),
  simulateDispatch as never
);
