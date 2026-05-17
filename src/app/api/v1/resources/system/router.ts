import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  SystemDisplaySettingsSchema,
  SystemSettingsSchema,
  SystemSettingsUpdateResponseSchema,
  SystemSettingsUpdateSchema,
  SystemTimezoneResponseSchema,
} from "@/lib/api/v1/schemas/system-config";
import {
  getSystemDisplaySettings,
  getSystemSettings,
  getSystemTimezone,
  updateSystemSettings,
} from "./handlers";

export const systemRouter = new OpenAPIHono({
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
} as const;

systemRouter.openapi(
  createRoute({
    method: "get",
    path: "/system/settings",
    middleware: requireAuth("admin"),
    tags: ["System"],
    summary: "Get system settings",
    description: "Returns global system settings used by the management console and proxy runtime.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "System settings.",
        content: { "application/json": { schema: SystemSettingsSchema } },
      },
      ...problemResponses,
    },
  }),
  getSystemSettings as never
);

systemRouter.openapi(
  createRoute({
    method: "put",
    path: "/system/settings",
    middleware: requireAuth("admin"),
    tags: ["System"],
    summary: "Update system settings",
    description: "Partially updates global system settings and invalidates related runtime caches.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: SystemSettingsUpdateSchema } },
      },
    },
    responses: {
      200: {
        description: "Updated system settings.",
        content: { "application/json": { schema: SystemSettingsUpdateResponseSchema } },
      },
      415: {
        description: "Unsupported media type.",
        content: { "application/problem+json": { schema: ProblemJsonSchema } },
      },
      ...problemResponses,
    },
  }),
  updateSystemSettings as never
);

systemRouter.openapi(
  createRoute({
    method: "get",
    path: "/system/display-settings",
    middleware: requireAuth("read"),
    tags: ["System"],
    summary: "Get display settings",
    description: "Returns non-sensitive system settings needed by read-only dashboard surfaces.",
    "x-required-access": "read",
    security,
    responses: {
      200: {
        description: "Read-only display settings.",
        content: { "application/json": { schema: SystemDisplaySettingsSchema } },
      },
      ...problemResponses,
    },
  }),
  getSystemDisplaySettings as never
);

systemRouter.openapi(
  createRoute({
    method: "get",
    path: "/system/timezone",
    middleware: requireAuth("read"),
    tags: ["System"],
    summary: "Get server timezone",
    description: "Returns the resolved server timezone for dashboard date boundaries.",
    "x-required-access": "read",
    security,
    responses: {
      200: {
        description: "Resolved server timezone.",
        content: { "application/json": { schema: SystemTimezoneResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getSystemTimezone as never
);
