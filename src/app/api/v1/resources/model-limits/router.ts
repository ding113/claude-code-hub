import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  ModelGroupLimitIdParamSchema,
  ModelGroupLimitListQuerySchema,
  ModelGroupLimitListResponseSchema,
  ModelGroupLimitSchema,
  ModelGroupLimitUpsertSchema,
} from "@/lib/api/v1/schemas/model-limits";
import { deleteModelGroupLimit, listModelGroupLimits, upsertModelGroupLimit } from "./handlers";

export const modelLimitsRouter = new OpenAPIHono({
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
    description: "Model limit not found.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

const tags = ["Model Limits"];

modelLimitsRouter.openapi(
  createRoute({
    method: "get",
    path: "/model-limits",
    middleware: requireAuth("admin"),
    tags,
    summary: "List model group limits",
    description:
      "Lists model group limits, optionally filtered by subjectType / subjectId / modelGroupId. Admin-only.",
    "x-required-access": "admin",
    security,
    request: { query: ModelGroupLimitListQuerySchema },
    responses: {
      200: {
        description: "Model group limits.",
        content: { "application/json": { schema: ModelGroupLimitListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listModelGroupLimits as never
);

modelLimitsRouter.openapi(
  createRoute({
    method: "post",
    path: "/model-limits",
    middleware: requireAuth("admin"),
    tags,
    summary: "Upsert a model group limit",
    description:
      "Creates or updates a (subjectType, subjectId, modelGroupId) limit row with the five base-tier caps. Admin-only.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: ModelGroupLimitUpsertSchema } },
      },
    },
    responses: {
      200: {
        description: "Upserted model group limit.",
        content: { "application/json": { schema: ModelGroupLimitSchema } },
      },
      ...problemResponses,
    },
  }),
  upsertModelGroupLimit as never
);

modelLimitsRouter.openapi(
  createRoute({
    method: "delete",
    path: "/model-limits/{id}",
    middleware: requireAuth("admin"),
    tags,
    summary: "Delete a model group limit",
    description: "Deletes one model group limit row by id. Admin-only.",
    "x-required-access": "admin",
    security,
    request: { params: ModelGroupLimitIdParamSchema },
    responses: { 204: { description: "Model limit deleted." }, ...problemResponses },
  }),
  deleteModelGroupLimit as never
);
