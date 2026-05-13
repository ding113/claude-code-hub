import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  AuditLogIdParamSchema,
  AuditLogListQuerySchema,
  AuditLogListResponseSchema,
  AuditLogSchema,
} from "@/lib/api/v1/schemas/audit-logs";
import { getAuditLog, listAuditLogs } from "./handlers";

export const auditLogsRouter = new OpenAPIHono({
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
    description: "Audit log not found.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

auditLogsRouter.openapi(
  createRoute({
    method: "get",
    path: "/audit-logs",
    middleware: requireAuth("admin"),
    tags: ["Audit Logs"],
    summary: "List audit logs",
    description: "Lists audit logs with cursor pagination and optional filters.",
    "x-required-access": "admin",
    security,
    request: { query: AuditLogListQuerySchema },
    responses: {
      200: {
        description: "Audit log page.",
        content: { "application/json": { schema: AuditLogListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listAuditLogs as never
);

auditLogsRouter.openapi(
  createRoute({
    method: "get",
    path: "/audit-logs/{id}",
    middleware: requireAuth("admin"),
    tags: ["Audit Logs"],
    summary: "Get audit log detail",
    description: "Returns one audit log row by id.",
    "x-required-access": "admin",
    security,
    request: { params: AuditLogIdParamSchema },
    responses: {
      200: {
        description: "Audit log detail.",
        content: { "application/json": { schema: AuditLogSchema } },
      },
      ...problemResponses,
    },
  }),
  getAuditLog as never
);
