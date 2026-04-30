import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  WebhookTargetCreateSchema,
  WebhookTargetIdParamSchema,
  WebhookTargetListResponseSchema,
  WebhookTargetSchema,
  WebhookTargetTestRequestSchema,
  WebhookTargetTestResponseSchema,
  WebhookTargetUpdateSchema,
} from "@/lib/api/v1/schemas/webhook-targets";
import {
  createWebhookTarget,
  deleteWebhookTarget,
  getWebhookTarget,
  listWebhookTargets,
  testWebhookTarget,
  updateWebhookTarget,
} from "./handlers";

export const webhookTargetsRouter = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      return fromZodError(result.error, new URL(c.req.url).pathname);
    }
  },
});

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

webhookTargetsRouter.openapi(
  createRoute({
    method: "get",
    path: "/webhook-targets",
    middleware: requireAuth("admin"),
    tags: ["Notifications"],
    summary: "List webhook targets",
    description: "Lists all webhook notification targets. Secret fields are redacted.",
    "x-required-access": "admin",
    security: [{ cookieAuth: [] }, { bearerAuth: [] }, { apiKeyAuth: [] }],
    responses: {
      200: {
        description: "Webhook target list.",
        content: { "application/json": { schema: WebhookTargetListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listWebhookTargets
);

webhookTargetsRouter.openapi(
  createRoute({
    method: "post",
    path: "/webhook-targets",
    middleware: requireAuth("admin"),
    tags: ["Notifications"],
    summary: "Create webhook target",
    description: "Creates a webhook notification target. Secret inputs are write-only.",
    "x-required-access": "admin",
    security: [{ cookieAuth: [] }, { bearerAuth: [] }, { apiKeyAuth: [] }],
    request: {
      body: {
        content: { "application/json": { schema: WebhookTargetCreateSchema } },
      },
    },
    responses: {
      201: {
        description: "Created webhook target.",
        content: { "application/json": { schema: WebhookTargetSchema } },
      },
      ...problemResponses,
    },
  }),
  createWebhookTarget
);

webhookTargetsRouter.openapi(
  createRoute({
    method: "get",
    path: "/webhook-targets/{id}",
    middleware: requireAuth("admin"),
    tags: ["Notifications"],
    summary: "Get webhook target",
    description: "Gets one webhook notification target by id. Secret fields are redacted.",
    "x-required-access": "admin",
    security: [{ cookieAuth: [] }, { bearerAuth: [] }, { apiKeyAuth: [] }],
    request: { params: WebhookTargetIdParamSchema },
    responses: {
      200: {
        description: "Webhook target.",
        content: { "application/json": { schema: WebhookTargetSchema } },
      },
      404: {
        description: "Webhook target not found.",
        content: { "application/problem+json": { schema: ProblemJsonSchema } },
      },
      ...problemResponses,
    },
  }),
  getWebhookTarget
);

webhookTargetsRouter.openapi(
  createRoute({
    method: "patch",
    path: "/webhook-targets/{id}",
    middleware: requireAuth("admin"),
    tags: ["Notifications"],
    summary: "Update webhook target",
    description: "Updates a webhook notification target. Secret inputs are write-only.",
    "x-required-access": "admin",
    security: [{ cookieAuth: [] }, { bearerAuth: [] }, { apiKeyAuth: [] }],
    request: {
      params: WebhookTargetIdParamSchema,
      body: {
        content: { "application/json": { schema: WebhookTargetUpdateSchema } },
      },
    },
    responses: {
      200: {
        description: "Updated webhook target.",
        content: { "application/json": { schema: WebhookTargetSchema } },
      },
      ...problemResponses,
    },
  }),
  updateWebhookTarget
);

webhookTargetsRouter.openapi(
  createRoute({
    method: "delete",
    path: "/webhook-targets/{id}",
    middleware: requireAuth("admin"),
    tags: ["Notifications"],
    summary: "Delete webhook target",
    description: "Deletes a webhook notification target.",
    "x-required-access": "admin",
    security: [{ cookieAuth: [] }, { bearerAuth: [] }, { apiKeyAuth: [] }],
    request: { params: WebhookTargetIdParamSchema },
    responses: {
      204: { description: "Webhook target deleted." },
      ...problemResponses,
    },
  }),
  deleteWebhookTarget
);

const testWebhookTargetRoute = createRoute({
  method: "post",
  path: "/webhook-targets/{id}:test",
  tags: ["Notifications"],
  summary: "Test webhook target",
  description: "Sends a test notification through the selected webhook target.",
  "x-required-access": "admin",
  security: [{ cookieAuth: [] }, { bearerAuth: [] }, { apiKeyAuth: [] }],
  request: {
    params: WebhookTargetIdParamSchema,
    body: {
      content: { "application/json": { schema: WebhookTargetTestRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Webhook test result.",
      content: { "application/json": { schema: WebhookTargetTestResponseSchema } },
    },
    ...problemResponses,
  },
});

webhookTargetsRouter.openAPIRegistry.registerPath(testWebhookTargetRoute);
webhookTargetsRouter.post(
  "/webhook-targets/:id{[0-9]+:test}",
  requireAuth("admin"),
  testWebhookTarget
);
