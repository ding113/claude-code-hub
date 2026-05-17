import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  ErrorRuleCreateSchema,
  ErrorRuleIdParamSchema,
  ErrorRuleListResponseSchema,
  ErrorRuleSchema,
  ErrorRulesCacheRefreshResponseSchema,
  ErrorRulesDetectorStatsSchema,
  ErrorRuleTestRequestSchema,
  ErrorRuleTestResponseSchema,
  ErrorRuleUpdateSchema,
} from "@/lib/api/v1/schemas/error-rules";
import {
  createErrorRule,
  deleteErrorRule,
  getErrorRulesCacheStats,
  listErrorRules,
  refreshErrorRulesCache,
  testErrorRule,
  updateErrorRule,
} from "./handlers";

export const errorRulesRouter = new OpenAPIHono({
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
    description: "Error rule not found.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

errorRulesRouter.openapi(
  createRoute({
    method: "get",
    path: "/error-rules",
    middleware: requireAuth("admin"),
    tags: ["Error Rules"],
    summary: "List error rules",
    description: "Lists all error override rules, including disabled and default rules.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Error rules.",
        content: { "application/json": { schema: ErrorRuleListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listErrorRules as never
);

errorRulesRouter.openapi(
  createRoute({
    method: "post",
    path: "/error-rules",
    middleware: requireAuth("admin"),
    tags: ["Error Rules"],
    summary: "Create error rule",
    description: "Creates an error override rule.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: ErrorRuleCreateSchema } },
      },
    },
    responses: {
      201: {
        description: "Created error rule.",
        content: { "application/json": { schema: ErrorRuleSchema } },
      },
      ...problemResponses,
    },
  }),
  createErrorRule as never
);

errorRulesRouter.openapi(
  createRoute({
    method: "post",
    path: "/error-rules/cache:refresh",
    middleware: requireAuth("admin"),
    tags: ["Error Rules"],
    summary: "Refresh error rule cache",
    description: "Synchronizes default rules and reloads the error rule detector cache.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Refreshed detector stats and sync result.",
        content: { "application/json": { schema: ErrorRulesCacheRefreshResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  refreshErrorRulesCache as never
);

errorRulesRouter.openapi(
  createRoute({
    method: "get",
    path: "/error-rules/cache/stats",
    middleware: requireAuth("admin"),
    tags: ["Error Rules"],
    summary: "Get error rule cache stats",
    description: "Returns current error rule detector cache statistics.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Detector stats.",
        content: { "application/json": { schema: ErrorRulesDetectorStatsSchema } },
      },
      ...problemResponses,
    },
  }),
  getErrorRulesCacheStats as never
);

errorRulesRouter.openapi(
  createRoute({
    method: "post",
    path: "/error-rules:test",
    middleware: requireAuth("admin"),
    tags: ["Error Rules"],
    summary: "Test error rule",
    description: "Tests an error message against configured rules and response overrides.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: ErrorRuleTestRequestSchema } },
      },
    },
    responses: {
      200: {
        description: "Rule test result.",
        content: { "application/json": { schema: ErrorRuleTestResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  testErrorRule as never
);

errorRulesRouter.openapi(
  createRoute({
    method: "patch",
    path: "/error-rules/{id}",
    middleware: requireAuth("admin"),
    tags: ["Error Rules"],
    summary: "Update error rule",
    description: "Partially updates an error override rule.",
    "x-required-access": "admin",
    security,
    request: {
      params: ErrorRuleIdParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: ErrorRuleUpdateSchema } },
      },
    },
    responses: {
      200: {
        description: "Updated error rule.",
        content: { "application/json": { schema: ErrorRuleSchema } },
      },
      ...problemResponses,
    },
  }),
  updateErrorRule as never
);

errorRulesRouter.openapi(
  createRoute({
    method: "delete",
    path: "/error-rules/{id}",
    middleware: requireAuth("admin"),
    tags: ["Error Rules"],
    summary: "Delete error rule",
    description: "Deletes an error override rule.",
    "x-required-access": "admin",
    security,
    request: { params: ErrorRuleIdParamSchema },
    responses: {
      204: { description: "Error rule deleted." },
      ...problemResponses,
    },
  }),
  deleteErrorRule as never
);
