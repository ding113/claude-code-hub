import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  DetectorStatsSchema,
  SensitiveWordCacheRefreshResponseSchema,
  SensitiveWordCreateSchema,
  SensitiveWordIdParamSchema,
  SensitiveWordListResponseSchema,
  SensitiveWordSchema,
  SensitiveWordUpdateSchema,
} from "@/lib/api/v1/schemas/sensitive-words";
import {
  createSensitiveWord,
  deleteSensitiveWord,
  getSensitiveWordsCacheStats,
  listSensitiveWords,
  refreshSensitiveWordsCache,
  updateSensitiveWord,
} from "./handlers";

export const sensitiveWordsRouter = new OpenAPIHono({
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
    description: "Sensitive word not found.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

sensitiveWordsRouter.openapi(
  createRoute({
    method: "get",
    path: "/sensitive-words",
    middleware: requireAuth("admin"),
    tags: ["Sensitive Words"],
    summary: "List sensitive words",
    description: "Lists all sensitive word rules, including disabled rules.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Sensitive word rules.",
        content: { "application/json": { schema: SensitiveWordListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listSensitiveWords as never
);

sensitiveWordsRouter.openapi(
  createRoute({
    method: "post",
    path: "/sensitive-words",
    middleware: requireAuth("admin"),
    tags: ["Sensitive Words"],
    summary: "Create sensitive word",
    description: "Creates a sensitive word or pattern rule.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: SensitiveWordCreateSchema } },
      },
    },
    responses: {
      201: {
        description: "Created sensitive word.",
        content: { "application/json": { schema: SensitiveWordSchema } },
      },
      ...problemResponses,
    },
  }),
  createSensitiveWord as never
);

sensitiveWordsRouter.openapi(
  createRoute({
    method: "post",
    path: "/sensitive-words/cache:refresh",
    middleware: requireAuth("admin"),
    tags: ["Sensitive Words"],
    summary: "Refresh sensitive word cache",
    description: "Reloads the sensitive word detector cache.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Refreshed detector stats.",
        content: { "application/json": { schema: SensitiveWordCacheRefreshResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  refreshSensitiveWordsCache as never
);

sensitiveWordsRouter.openapi(
  createRoute({
    method: "get",
    path: "/sensitive-words/cache/stats",
    middleware: requireAuth("admin"),
    tags: ["Sensitive Words"],
    summary: "Get sensitive word cache stats",
    description: "Returns current sensitive word detector cache statistics.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Detector stats.",
        content: { "application/json": { schema: DetectorStatsSchema } },
      },
      ...problemResponses,
    },
  }),
  getSensitiveWordsCacheStats as never
);

sensitiveWordsRouter.openapi(
  createRoute({
    method: "patch",
    path: "/sensitive-words/{id}",
    middleware: requireAuth("admin"),
    tags: ["Sensitive Words"],
    summary: "Update sensitive word",
    description: "Partially updates a sensitive word rule.",
    "x-required-access": "admin",
    security,
    request: {
      params: SensitiveWordIdParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: SensitiveWordUpdateSchema } },
      },
    },
    responses: {
      200: {
        description: "Updated sensitive word.",
        content: { "application/json": { schema: SensitiveWordSchema } },
      },
      ...problemResponses,
    },
  }),
  updateSensitiveWord as never
);

sensitiveWordsRouter.openapi(
  createRoute({
    method: "delete",
    path: "/sensitive-words/{id}",
    middleware: requireAuth("admin"),
    tags: ["Sensitive Words"],
    summary: "Delete sensitive word",
    description: "Deletes a sensitive word rule.",
    "x-required-access": "admin",
    security,
    request: { params: SensitiveWordIdParamSchema },
    responses: {
      204: { description: "Sensitive word deleted." },
      ...problemResponses,
    },
  }),
  deleteSensitiveWord as never
);
