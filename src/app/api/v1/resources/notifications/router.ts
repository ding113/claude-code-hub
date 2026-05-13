import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  NotificationBindingListResponseSchema,
  NotificationBindingUpdateSchema,
  NotificationSettingsSchema,
  NotificationSettingsUpdateSchema,
  NotificationTestWebhookRequestSchema,
  NotificationTestWebhookResponseSchema,
  NotificationTypeParamSchema,
} from "@/lib/api/v1/schemas/notifications";
import {
  getNotificationBindings,
  getNotificationSettings,
  testNotificationWebhook,
  updateNotificationBindings,
  updateNotificationSettings,
} from "./handlers";

export const notificationsRouter = new OpenAPIHono({
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

notificationsRouter.openapi(
  createRoute({
    method: "get",
    path: "/notifications/settings",
    middleware: requireAuth("admin"),
    tags: ["Notifications"],
    summary: "Get notification settings",
    description: "Returns the global notification settings document.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Notification settings.",
        content: { "application/json": { schema: NotificationSettingsSchema } },
      },
      ...problemResponses,
    },
  }),
  getNotificationSettings as never
);

notificationsRouter.openapi(
  createRoute({
    method: "put",
    path: "/notifications/settings",
    middleware: requireAuth("admin"),
    tags: ["Notifications"],
    summary: "Update notification settings",
    description: "Partially updates global notification settings.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: NotificationSettingsUpdateSchema } },
      },
    },
    responses: {
      200: {
        description: "Updated notification settings.",
        content: { "application/json": { schema: NotificationSettingsSchema } },
      },
      ...problemResponses,
    },
  }),
  updateNotificationSettings as never
);

notificationsRouter.openapi(
  createRoute({
    method: "post",
    path: "/notifications/test-webhook",
    middleware: requireAuth("admin"),
    tags: ["Notifications"],
    summary: "Test notification webhook",
    description: "Sends a test notification to a webhook URL.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: NotificationTestWebhookRequestSchema } },
      },
    },
    responses: {
      200: {
        description: "Webhook test result.",
        content: { "application/json": { schema: NotificationTestWebhookResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  testNotificationWebhook as never
);

notificationsRouter.openapi(
  createRoute({
    method: "get",
    path: "/notifications/types/{type}/bindings",
    middleware: requireAuth("admin"),
    tags: ["Notifications"],
    summary: "List notification bindings",
    description: "Lists redacted webhook target bindings for one notification type.",
    "x-required-access": "admin",
    security,
    request: { params: NotificationTypeParamSchema },
    responses: {
      200: {
        description: "Notification bindings.",
        content: { "application/json": { schema: NotificationBindingListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getNotificationBindings as never
);

notificationsRouter.openapi(
  createRoute({
    method: "put",
    path: "/notifications/types/{type}/bindings",
    middleware: requireAuth("admin"),
    tags: ["Notifications"],
    summary: "Replace notification bindings",
    description: "Replaces webhook target bindings for one notification type.",
    "x-required-access": "admin",
    security,
    request: {
      params: NotificationTypeParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: NotificationBindingUpdateSchema } },
      },
    },
    responses: {
      204: { description: "Bindings replaced." },
      ...problemResponses,
    },
  }),
  updateNotificationBindings as never
);
