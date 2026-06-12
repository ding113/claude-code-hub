import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  KeywordRoutingCacheRefreshResponseSchema,
  KeywordRoutingCacheStatsSchema,
  KeywordRoutingRuleCreateSchema,
  KeywordRoutingRuleIdParamSchema,
  KeywordRoutingRuleListResponseSchema,
  KeywordRoutingRuleSchema,
  KeywordRoutingRuleUpdateSchema,
} from "@/lib/api/v1/schemas/keyword-routing";
import {
  createKeywordRoutingRule,
  deleteKeywordRoutingRule,
  getKeywordRoutingCacheStats,
  listKeywordRoutingRules,
  refreshKeywordRoutingCache,
  updateKeywordRoutingRule,
} from "./handlers";

export const keywordRoutingRouter = new OpenAPIHono({
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
    description: "Keyword routing rule not found.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

keywordRoutingRouter.openapi(
  createRoute({
    method: "get",
    path: "/keyword-routing-rules",
    middleware: requireAuth("admin"),
    tags: ["Keyword Routing"],
    summary: "List keyword routing rules",
    description: "Lists all keyword routing rules, including disabled rules.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Keyword routing rules.",
        content: { "application/json": { schema: KeywordRoutingRuleListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listKeywordRoutingRules as never
);

keywordRoutingRouter.openapi(
  createRoute({
    method: "post",
    path: "/keyword-routing-rules",
    middleware: requireAuth("admin"),
    tags: ["Keyword Routing"],
    summary: "Create keyword routing rule",
    description: "Creates a keyword routing rule that rewrites the requested model on match.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: KeywordRoutingRuleCreateSchema } },
      },
    },
    responses: {
      201: {
        description: "Created keyword routing rule.",
        content: { "application/json": { schema: KeywordRoutingRuleSchema } },
      },
      ...problemResponses,
    },
  }),
  createKeywordRoutingRule as never
);

keywordRoutingRouter.openapi(
  createRoute({
    method: "post",
    path: "/keyword-routing-rules/cache:refresh",
    middleware: requireAuth("admin"),
    tags: ["Keyword Routing"],
    summary: "Refresh keyword routing cache",
    description: "Reloads the keyword routing engine cache.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Refreshed engine stats.",
        content: { "application/json": { schema: KeywordRoutingCacheRefreshResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  refreshKeywordRoutingCache as never
);

keywordRoutingRouter.openapi(
  createRoute({
    method: "get",
    path: "/keyword-routing-rules/cache/stats",
    middleware: requireAuth("admin"),
    tags: ["Keyword Routing"],
    summary: "Get keyword routing cache stats",
    description: "Returns current keyword routing engine cache statistics.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Engine stats.",
        content: { "application/json": { schema: KeywordRoutingCacheStatsSchema } },
      },
      ...problemResponses,
    },
  }),
  getKeywordRoutingCacheStats as never
);

keywordRoutingRouter.openapi(
  createRoute({
    method: "patch",
    path: "/keyword-routing-rules/{id}",
    middleware: requireAuth("admin"),
    tags: ["Keyword Routing"],
    summary: "Update keyword routing rule",
    description: "Partially updates a keyword routing rule.",
    "x-required-access": "admin",
    security,
    request: {
      params: KeywordRoutingRuleIdParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: KeywordRoutingRuleUpdateSchema } },
      },
    },
    responses: {
      200: {
        description: "Updated keyword routing rule.",
        content: { "application/json": { schema: KeywordRoutingRuleSchema } },
      },
      ...problemResponses,
    },
  }),
  updateKeywordRoutingRule as never
);

keywordRoutingRouter.openapi(
  createRoute({
    method: "delete",
    path: "/keyword-routing-rules/{id}",
    middleware: requireAuth("admin"),
    tags: ["Keyword Routing"],
    summary: "Delete keyword routing rule",
    description: "Deletes a keyword routing rule.",
    "x-required-access": "admin",
    security,
    request: { params: KeywordRoutingRuleIdParamSchema },
    responses: {
      204: { description: "Keyword routing rule deleted." },
      ...problemResponses,
    },
  }),
  deleteKeywordRoutingRule as never
);
