import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  ProviderGroupCreateSchema,
  ProviderGroupIdParamSchema,
  ProviderGroupListResponseSchema,
  ProviderGroupSchema,
  ProviderGroupUpdateSchema,
} from "@/lib/api/v1/schemas/provider-groups";
import {
  createProviderGroup,
  deleteProviderGroup,
  listProviderGroups,
  updateProviderGroup,
} from "./handlers";

export const providerGroupsRouter = new OpenAPIHono({
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
    description: "Provider group not found.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

providerGroupsRouter.openapi(
  createRoute({
    method: "get",
    path: "/provider-groups",
    middleware: requireAuth("admin"),
    tags: ["Provider Groups"],
    summary: "List provider groups",
    description: "Lists provider groups with provider counts.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Provider groups.",
        content: { "application/json": { schema: ProviderGroupListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listProviderGroups as never
);

providerGroupsRouter.openapi(
  createRoute({
    method: "post",
    path: "/provider-groups",
    middleware: requireAuth("admin"),
    tags: ["Provider Groups"],
    summary: "Create provider group",
    description: "Creates a provider group.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: ProviderGroupCreateSchema } },
      },
    },
    responses: {
      201: {
        description: "Created provider group.",
        content: { "application/json": { schema: ProviderGroupSchema } },
      },
      ...problemResponses,
    },
  }),
  createProviderGroup as never
);

providerGroupsRouter.openapi(
  createRoute({
    method: "patch",
    path: "/provider-groups/{id}",
    middleware: requireAuth("admin"),
    tags: ["Provider Groups"],
    summary: "Update provider group",
    description: "Partially updates provider group metadata.",
    "x-required-access": "admin",
    security,
    request: {
      params: ProviderGroupIdParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: ProviderGroupUpdateSchema } },
      },
    },
    responses: {
      200: {
        description: "Updated provider group.",
        content: { "application/json": { schema: ProviderGroupSchema } },
      },
      ...problemResponses,
    },
  }),
  updateProviderGroup as never
);

providerGroupsRouter.openapi(
  createRoute({
    method: "delete",
    path: "/provider-groups/{id}",
    middleware: requireAuth("admin"),
    tags: ["Provider Groups"],
    summary: "Delete provider group",
    description: "Deletes a provider group when it is not the default group and is not in use.",
    "x-required-access": "admin",
    security,
    request: { params: ProviderGroupIdParamSchema },
    responses: {
      204: { description: "Provider group deleted." },
      ...problemResponses,
    },
  }),
  deleteProviderGroup as never
);
