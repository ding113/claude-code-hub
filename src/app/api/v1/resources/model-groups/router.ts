// Exports: modelGroupsRouter (OpenAPIHono instance)
// Mount in _root/app.ts as: app.route("/resources", modelGroupsRouter)

import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  ModelGroupCreateSchema,
  ModelGroupIdParamSchema,
  ModelGroupListResponseSchema,
  ModelGroupMemberBodySchema,
  ModelGroupMemberQuerySchema,
  ModelGroupSchema,
  ModelGroupUpdateSchema,
  SingletonCreateSchema,
} from "@/lib/api/v1/schemas/model-groups";
import {
  addModelGroupMember,
  createModelGroup,
  createSingletonModelGroup,
  deleteModelGroup,
  getModelGroup,
  listModelGroups,
  removeModelGroupMember,
  updateModelGroup,
} from "./handlers";

export const modelGroupsRouter = new OpenAPIHono({
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
    description: "Model group not found.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

const conflictResponse = {
  409: {
    description: "Model already belongs to another group.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

// ---------------------------------------------------------------------------
// GET /resources/model-groups
// ---------------------------------------------------------------------------

modelGroupsRouter.openapi(
  createRoute({
    method: "get",
    path: "/model-groups",
    middleware: requireAuth("admin"),
    tags: ["Model Groups"],
    summary: "List model groups",
    description: "Returns all model groups with their member model names.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Model groups.",
        content: { "application/json": { schema: ModelGroupListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listModelGroups as never
);

// ---------------------------------------------------------------------------
// POST /resources/model-groups
// ---------------------------------------------------------------------------

modelGroupsRouter.openapi(
  createRoute({
    method: "post",
    path: "/model-groups",
    middleware: requireAuth("admin"),
    tags: ["Model Groups"],
    summary: "Create model group",
    description: "Creates a new model group.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: ModelGroupCreateSchema } },
      },
    },
    responses: {
      201: {
        description: "Created model group.",
        content: { "application/json": { schema: ModelGroupSchema } },
      },
      ...problemResponses,
    },
  }),
  createModelGroup as never
);

// ---------------------------------------------------------------------------
// GET /resources/model-groups/:id
// ---------------------------------------------------------------------------

modelGroupsRouter.openapi(
  createRoute({
    method: "get",
    path: "/model-groups/{id}",
    middleware: requireAuth("admin"),
    tags: ["Model Groups"],
    summary: "Get model group",
    description: "Returns a single model group with its members.",
    "x-required-access": "admin",
    security,
    request: { params: ModelGroupIdParamSchema },
    responses: {
      200: {
        description: "Model group.",
        content: { "application/json": { schema: ModelGroupSchema } },
      },
      ...problemResponses,
    },
  }),
  getModelGroup as never
);

// ---------------------------------------------------------------------------
// PATCH /resources/model-groups/:id
// ---------------------------------------------------------------------------

modelGroupsRouter.openapi(
  createRoute({
    method: "patch",
    path: "/model-groups/{id}",
    middleware: requireAuth("admin"),
    tags: ["Model Groups"],
    summary: "Update model group",
    description: "Partially updates model group metadata (name, description).",
    "x-required-access": "admin",
    security,
    request: {
      params: ModelGroupIdParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: ModelGroupUpdateSchema } },
      },
    },
    responses: {
      200: {
        description: "Updated model group.",
        content: { "application/json": { schema: ModelGroupSchema } },
      },
      ...problemResponses,
    },
  }),
  updateModelGroup as never
);

// ---------------------------------------------------------------------------
// DELETE /resources/model-groups/:id
// ---------------------------------------------------------------------------

modelGroupsRouter.openapi(
  createRoute({
    method: "delete",
    path: "/model-groups/{id}",
    middleware: requireAuth("admin"),
    tags: ["Model Groups"],
    summary: "Delete model group",
    description: "Deletes a model group and all its member mappings (cascade).",
    "x-required-access": "admin",
    security,
    request: { params: ModelGroupIdParamSchema },
    responses: {
      204: { description: "Model group deleted." },
      ...problemResponses,
    },
  }),
  deleteModelGroup as never
);

// ---------------------------------------------------------------------------
// POST /resources/model-groups/:id/members
// ---------------------------------------------------------------------------

modelGroupsRouter.openapi(
  createRoute({
    method: "post",
    path: "/model-groups/{id}/members",
    middleware: requireAuth("admin"),
    tags: ["Model Groups"],
    summary: "Add member to model group",
    description:
      "Adds a model to the group. Returns 409 if the model already belongs to another group (D6 global exclusivity).",
    "x-required-access": "admin",
    security,
    request: {
      params: ModelGroupIdParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: ModelGroupMemberBodySchema } },
      },
    },
    responses: {
      204: { description: "Member added." },
      ...problemResponses,
      ...conflictResponse,
    },
  }),
  addModelGroupMember as never
);

// ---------------------------------------------------------------------------
// DELETE /resources/model-groups/:id/members?model=
// ---------------------------------------------------------------------------

modelGroupsRouter.openapi(
  createRoute({
    method: "delete",
    path: "/model-groups/{id}/members",
    middleware: requireAuth("admin"),
    tags: ["Model Groups"],
    summary: "Remove member from model group",
    description: "Removes a model from the group. Query param: ?model=<model-name>",
    "x-required-access": "admin",
    security,
    request: {
      params: ModelGroupIdParamSchema,
      query: ModelGroupMemberQuerySchema,
    },
    responses: {
      204: { description: "Member removed." },
      ...problemResponses,
    },
  }),
  removeModelGroupMember as never
);

// ---------------------------------------------------------------------------
// POST /resources/model-groups/singleton
// ---------------------------------------------------------------------------

modelGroupsRouter.openapi(
  createRoute({
    method: "post",
    path: "/model-groups/singleton",
    middleware: requireAuth("admin"),
    tags: ["Model Groups"],
    summary: "Create singleton model group",
    description:
      "Convenience endpoint: creates a group with isSingleton=true containing exactly one model.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: SingletonCreateSchema } },
      },
    },
    responses: {
      201: {
        description: "Created singleton model group.",
        content: { "application/json": { schema: ModelGroupSchema } },
      },
      ...problemResponses,
      ...conflictResponse,
    },
  }),
  createSingletonModelGroup as never
);
