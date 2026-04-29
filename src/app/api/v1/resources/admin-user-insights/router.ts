import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  AdminUserInsightDateQuerySchema,
  AdminUserInsightIdParamSchema,
  AdminUserInsightKeyTrendQuerySchema,
  AdminUserInsightModelBreakdownQuerySchema,
  AdminUserInsightProviderBreakdownQuerySchema,
  AdminUserInsightsKeyTrendRowSchema,
  AdminUserInsightsOverviewResponseSchema,
  AdminUserModelBreakdownResponseSchema,
  AdminUserProviderBreakdownResponseSchema,
} from "@/lib/api/v1/schemas/admin-user-insights";
import {
  getAdminUserInsightsKeyTrend,
  getAdminUserInsightsModelBreakdown,
  getAdminUserInsightsOverview,
  getAdminUserInsightsProviderBreakdown,
} from "./handlers";

export const adminUserInsightsRouter = new OpenAPIHono({
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
    description: "Admin access required.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  404: {
    description: "User insight target was not found.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

adminUserInsightsRouter.openapi(
  createRoute({
    method: "get",
    path: "/admin/users/{userId}/insights/overview",
    middleware: requireAuth("admin"),
    tags: ["Admin User Insights"],
    summary: "Get user insight overview",
    description: "Returns overview metrics for a target user and optional date range.",
    "x-required-access": "admin",
    security,
    request: {
      params: AdminUserInsightIdParamSchema,
      query: AdminUserInsightDateQuerySchema,
    },
    responses: {
      200: {
        description: "User insight overview.",
        content: { "application/json": { schema: AdminUserInsightsOverviewResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getAdminUserInsightsOverview as never
);

adminUserInsightsRouter.openapi(
  createRoute({
    method: "get",
    path: "/admin/users/{userId}/insights/key-trend",
    middleware: requireAuth("admin"),
    tags: ["Admin User Insights"],
    summary: "Get user key trend",
    description: "Returns key-level usage trend rows for the target user.",
    "x-required-access": "admin",
    security,
    request: {
      params: AdminUserInsightIdParamSchema,
      query: AdminUserInsightKeyTrendQuerySchema,
    },
    responses: {
      200: {
        description: "User key trend rows.",
        content: {
          "application/json": {
            schema: z.object({
              items: z.array(AdminUserInsightsKeyTrendRowSchema).describe("Key trend rows."),
            }),
          },
        },
      },
      ...problemResponses,
    },
  }),
  getAdminUserInsightsKeyTrend as never
);

adminUserInsightsRouter.openapi(
  createRoute({
    method: "get",
    path: "/admin/users/{userId}/insights/model-breakdown",
    middleware: requireAuth("admin"),
    tags: ["Admin User Insights"],
    summary: "Get user model breakdown",
    description: "Returns model-level cost and token breakdown for the target user.",
    "x-required-access": "admin",
    security,
    request: {
      params: AdminUserInsightIdParamSchema,
      query: AdminUserInsightModelBreakdownQuerySchema,
    },
    responses: {
      200: {
        description: "User model breakdown.",
        content: { "application/json": { schema: AdminUserModelBreakdownResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getAdminUserInsightsModelBreakdown as never
);

adminUserInsightsRouter.openapi(
  createRoute({
    method: "get",
    path: "/admin/users/{userId}/insights/provider-breakdown",
    middleware: requireAuth("admin"),
    tags: ["Admin User Insights"],
    summary: "Get user provider breakdown",
    description: "Returns provider-level cost and token breakdown for the target user.",
    "x-required-access": "admin",
    security,
    request: {
      params: AdminUserInsightIdParamSchema,
      query: AdminUserInsightProviderBreakdownQuerySchema,
    },
    responses: {
      200: {
        description: "User provider breakdown.",
        content: { "application/json": { schema: AdminUserProviderBreakdownResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getAdminUserInsightsProviderBreakdown as never
);
