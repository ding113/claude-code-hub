import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  GenericMeResponseSchema,
  MeIpGeoParamSchema,
  MeIpGeoQuerySchema,
  MeStatsSummaryQuerySchema,
  MeUsageLogsQuerySchema,
  StringListResponseSchema,
} from "@/lib/api/v1/schemas/me";
import {
  getMeIpGeo,
  getMeMetadata,
  getMeQuota,
  getMeStatsSummary,
  getMeToday,
  listMeUsageEndpoints,
  listMeUsageLogs,
  listMeUsageLogsFull,
  listMeUsageModels,
} from "./handlers";

export const meRouter = new OpenAPIHono({
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
  404: {
    description: "Current caller resource not found.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

meRouter.openapi(
  createRoute({
    method: "get",
    path: "/me/metadata",
    middleware: requireAuth("read"),
    tags: ["Me"],
    summary: "Get current caller metadata",
    description: "Returns current key and user metadata for the self-service usage page.",
    "x-required-access": "read",
    security,
    responses: {
      200: {
        description: "Metadata.",
        content: { "application/json": { schema: GenericMeResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getMeMetadata as never
);

meRouter.openapi(
  createRoute({
    method: "get",
    path: "/me/quota",
    middleware: requireAuth("read"),
    tags: ["Me"],
    summary: "Get current caller quota",
    description: "Returns current key and user quota counters.",
    "x-required-access": "read",
    security,
    responses: {
      200: {
        description: "Quota.",
        content: { "application/json": { schema: GenericMeResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getMeQuota as never
);

meRouter.openapi(
  createRoute({
    method: "get",
    path: "/me/today",
    middleware: requireAuth("read"),
    tags: ["Me"],
    summary: "Get current caller daily usage",
    description: "Returns today's usage counters for the current key.",
    "x-required-access": "read",
    security,
    responses: {
      200: {
        description: "Daily usage.",
        content: { "application/json": { schema: GenericMeResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getMeToday as never
);

meRouter.openapi(
  createRoute({
    method: "get",
    path: "/me/usage-logs",
    middleware: requireAuth("read"),
    tags: ["Me"],
    summary: "List current caller usage logs",
    description: "Lists self-scoped usage logs with offset or cursor pagination.",
    "x-required-access": "read",
    security,
    request: { query: MeUsageLogsQuerySchema },
    responses: {
      200: {
        description: "Usage logs.",
        content: { "application/json": { schema: GenericMeResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listMeUsageLogs as never
);

meRouter.openapi(
  createRoute({
    method: "get",
    path: "/me/usage-logs/full",
    middleware: requireAuth("read"),
    tags: ["Me"],
    summary: "List current caller full usage logs",
    description: "Lists self-scoped usage logs in full read-only table format.",
    "x-required-access": "read",
    security,
    request: { query: MeUsageLogsQuerySchema },
    responses: {
      200: {
        description: "Full usage logs.",
        content: { "application/json": { schema: GenericMeResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listMeUsageLogsFull as never
);

meRouter.openapi(
  createRoute({
    method: "get",
    path: "/me/usage-logs/models",
    middleware: requireAuth("read"),
    tags: ["Me"],
    summary: "List current caller usage models",
    description: "Returns distinct models visible to the current key.",
    "x-required-access": "read",
    security,
    responses: {
      200: {
        description: "Models.",
        content: { "application/json": { schema: StringListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listMeUsageModels as never
);

meRouter.openapi(
  createRoute({
    method: "get",
    path: "/me/usage-logs/endpoints",
    middleware: requireAuth("read"),
    tags: ["Me"],
    summary: "List current caller usage endpoints",
    description: "Returns distinct endpoints visible to the current key.",
    "x-required-access": "read",
    security,
    responses: {
      200: {
        description: "Endpoints.",
        content: { "application/json": { schema: StringListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listMeUsageEndpoints as never
);

meRouter.openapi(
  createRoute({
    method: "get",
    path: "/me/usage-logs/stats-summary",
    middleware: requireAuth("read"),
    tags: ["Me"],
    summary: "Get current caller usage stats summary",
    description: "Returns current key and user model breakdown for a date range.",
    "x-required-access": "read",
    security,
    request: { query: MeStatsSummaryQuerySchema },
    responses: {
      200: {
        description: "Stats summary.",
        content: { "application/json": { schema: GenericMeResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getMeStatsSummary as never
);

meRouter.openapi(
  createRoute({
    method: "get",
    path: "/me/ip-geo/{ip}",
    middleware: requireAuth("read"),
    tags: ["Me"],
    summary: "Lookup visible IP geolocation",
    description: "Looks up geolocation for an IP address visible in the current key's usage logs.",
    "x-required-access": "read",
    security,
    request: { params: MeIpGeoParamSchema, query: MeIpGeoQuerySchema },
    responses: {
      200: {
        description: "IP geolocation.",
        content: { "application/json": { schema: GenericMeResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getMeIpGeo as never
);
