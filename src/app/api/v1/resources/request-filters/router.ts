import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  RequestFilterCacheRefreshResponseSchema,
  RequestFilterCreateSchema,
  RequestFilterGroupOptionsResponseSchema,
  RequestFilterIdParamSchema,
  RequestFilterListResponseSchema,
  RequestFilterProviderOptionsResponseSchema,
  RequestFilterSchema,
  RequestFilterUpdateSchema,
} from "@/lib/api/v1/schemas/request-filters";
import {
  createRequestFilter,
  deleteRequestFilter,
  listGroupOptions,
  listProviderOptions,
  listRequestFilters,
  refreshRequestFiltersCache,
  updateRequestFilter,
} from "./handlers";

export const requestFiltersRouter = new OpenAPIHono({
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
    description: "Request filter not found.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

requestFiltersRouter.openapi(
  createRoute({
    method: "get",
    path: "/request-filters",
    middleware: requireAuth("admin"),
    tags: ["Request Filters"],
    summary: "List request filters",
    description: "Lists all request mutation filters, including disabled filters.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Request filters.",
        content: { "application/json": { schema: RequestFilterListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listRequestFilters as never
);

requestFiltersRouter.openapi(
  createRoute({
    method: "post",
    path: "/request-filters",
    middleware: requireAuth("admin"),
    tags: ["Request Filters"],
    summary: "Create request filter",
    description: "Creates a request filter in simple or advanced mode.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: RequestFilterCreateSchema } },
      },
    },
    responses: {
      201: {
        description: "Created request filter.",
        content: { "application/json": { schema: RequestFilterSchema } },
      },
      ...problemResponses,
    },
  }),
  createRequestFilter as never
);

requestFiltersRouter.openapi(
  createRoute({
    method: "post",
    path: "/request-filters/cache:refresh",
    middleware: requireAuth("admin"),
    tags: ["Request Filters"],
    summary: "Refresh request filter cache",
    description: "Reloads request filter runtime cache.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Refreshed cache count.",
        content: { "application/json": { schema: RequestFilterCacheRefreshResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  refreshRequestFiltersCache as never
);

requestFiltersRouter.openapi(
  createRoute({
    method: "get",
    path: "/request-filters/options/providers",
    middleware: requireAuth("admin"),
    tags: ["Request Filters"],
    summary: "List request filter provider options",
    description: "Lists providers available for request filter binding.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Provider options.",
        content: { "application/json": { schema: RequestFilterProviderOptionsResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listProviderOptions as never
);

requestFiltersRouter.openapi(
  createRoute({
    method: "get",
    path: "/request-filters/options/groups",
    middleware: requireAuth("admin"),
    tags: ["Request Filters"],
    summary: "List request filter group options",
    description: "Lists provider group tags available for request filter binding.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Provider group options.",
        content: { "application/json": { schema: RequestFilterGroupOptionsResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listGroupOptions as never
);

requestFiltersRouter.openapi(
  createRoute({
    method: "patch",
    path: "/request-filters/{id}",
    middleware: requireAuth("admin"),
    tags: ["Request Filters"],
    summary: "Update request filter",
    description: "Partially updates a request filter.",
    "x-required-access": "admin",
    security,
    request: {
      params: RequestFilterIdParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: RequestFilterUpdateSchema } },
      },
    },
    responses: {
      200: {
        description: "Updated request filter.",
        content: { "application/json": { schema: RequestFilterSchema } },
      },
      ...problemResponses,
    },
  }),
  updateRequestFilter as never
);

requestFiltersRouter.openapi(
  createRoute({
    method: "delete",
    path: "/request-filters/{id}",
    middleware: requireAuth("admin"),
    tags: ["Request Filters"],
    summary: "Delete request filter",
    description: "Deletes a request filter.",
    "x-required-access": "admin",
    security,
    request: { params: RequestFilterIdParamSchema },
    responses: {
      204: { description: "Request filter deleted." },
      ...problemResponses,
    },
  }),
  deleteRequestFilter as never
);
