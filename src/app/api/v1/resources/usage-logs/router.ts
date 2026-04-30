import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  GenericUsageLogResponseSchema,
  NumberListResponseSchema,
  StringListResponseSchema,
  UsageLogExportJobParamSchema,
  UsageLogSessionSuggestionsQuerySchema,
  UsageLogsExportCreateSchema,
  UsageLogsQuerySchema,
} from "@/lib/api/v1/schemas/usage-logs";
import {
  createUsageLogsExport,
  downloadUsageLogsExport,
  getEndpointList,
  getFilterOptions,
  getModelList,
  getStatusCodeList,
  getUsageLogsExportStatus,
  getUsageLogsStats,
  listUsageLogs,
  suggestSessionIds,
} from "./handlers";

export const usageLogsRouter = new OpenAPIHono({
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
    description: "Usage log resource not found.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

usageLogsRouter.openapi(
  createRoute({
    method: "get",
    path: "/usage-logs",
    middleware: requireAuth("read"),
    tags: ["Usage Logs"],
    summary: "List usage logs",
    description: "Lists usage logs with either offset or cursor filters.",
    "x-required-access": "read",
    security,
    request: { query: UsageLogsQuerySchema },
    responses: {
      200: {
        description: "Usage logs.",
        content: { "application/json": { schema: GenericUsageLogResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listUsageLogs as never
);

usageLogsRouter.openapi(
  createRoute({
    method: "get",
    path: "/usage-logs/stats",
    middleware: requireAuth("read"),
    tags: ["Usage Logs"],
    summary: "Get usage log stats",
    description: "Returns aggregate usage log statistics.",
    "x-required-access": "read",
    security,
    request: { query: UsageLogsQuerySchema },
    responses: {
      200: {
        description: "Usage stats.",
        content: { "application/json": { schema: GenericUsageLogResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getUsageLogsStats as never
);

usageLogsRouter.openapi(
  createRoute({
    method: "get",
    path: "/usage-logs/filter-options",
    middleware: requireAuth("admin"),
    tags: ["Usage Logs"],
    summary: "Get usage log filter options",
    description: "Returns admin-scoped cached model, status-code, and endpoint filter options.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Filter options.",
        content: { "application/json": { schema: GenericUsageLogResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getFilterOptions as never
);

usageLogsRouter.openapi(
  createRoute({
    method: "get",
    path: "/usage-logs/models",
    middleware: requireAuth("admin"),
    tags: ["Usage Logs"],
    summary: "List usage log models",
    description: "Returns distinct model values used in admin-visible logs.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Models.",
        content: { "application/json": { schema: StringListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getModelList as never
);

usageLogsRouter.openapi(
  createRoute({
    method: "get",
    path: "/usage-logs/status-codes",
    middleware: requireAuth("admin"),
    tags: ["Usage Logs"],
    summary: "List usage log status codes",
    description: "Returns distinct status codes used in admin-visible logs.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Status codes.",
        content: { "application/json": { schema: NumberListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getStatusCodeList as never
);

usageLogsRouter.openapi(
  createRoute({
    method: "get",
    path: "/usage-logs/endpoints",
    middleware: requireAuth("admin"),
    tags: ["Usage Logs"],
    summary: "List usage log endpoints",
    description: "Returns distinct endpoint values used in admin-visible logs.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Endpoints.",
        content: { "application/json": { schema: StringListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getEndpointList as never
);

usageLogsRouter.openapi(
  createRoute({
    method: "get",
    path: "/usage-logs/session-id-suggestions",
    middleware: requireAuth("read"),
    tags: ["Usage Logs"],
    summary: "Suggest usage log session ids",
    description: "Returns session-id suggestions for the log filter.",
    "x-required-access": "read",
    security,
    request: { query: UsageLogSessionSuggestionsQuerySchema },
    responses: {
      200: {
        description: "Session ids.",
        content: { "application/json": { schema: StringListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  suggestSessionIds as never
);

usageLogsRouter.openapi(
  createRoute({
    method: "post",
    path: "/usage-logs/exports",
    middleware: requireAuth("read"),
    tags: ["Usage Logs"],
    summary: "Create usage log export",
    description:
      "Creates a synchronous CSV export, or an async job when Prefer: respond-async is sent.",
    "x-required-access": "read",
    security,
    request: {
      body: {
        required: false,
        content: { "application/json": { schema: UsageLogsExportCreateSchema } },
      },
    },
    responses: {
      200: {
        description: "CSV export body.",
        content: { "application/json": { schema: GenericUsageLogResponseSchema } },
      },
      202: {
        description: "Async export job.",
        content: { "application/json": { schema: GenericUsageLogResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  createUsageLogsExport as never
);

usageLogsRouter.openapi(
  createRoute({
    method: "get",
    path: "/usage-logs/exports/{jobId}",
    middleware: requireAuth("read"),
    tags: ["Usage Logs"],
    summary: "Get usage log export status",
    description: "Returns async CSV export job status.",
    "x-required-access": "read",
    security,
    request: { params: UsageLogExportJobParamSchema },
    responses: {
      200: {
        description: "Export status.",
        content: { "application/json": { schema: GenericUsageLogResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getUsageLogsExportStatus as never
);

usageLogsRouter.openapi(
  createRoute({
    method: "get",
    path: "/usage-logs/exports/{jobId}/download",
    middleware: requireAuth("read"),
    tags: ["Usage Logs"],
    summary: "Download usage log export",
    description: "Downloads async CSV export output.",
    "x-required-access": "read",
    security,
    request: { params: UsageLogExportJobParamSchema },
    responses: {
      200: {
        description: "CSV file.",
        content: { "text/csv": { schema: StringListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  downloadUsageLogsExport as never
);
