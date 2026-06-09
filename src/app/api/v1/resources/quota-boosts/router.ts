/**
 * Exported variable: quotaBoostsRouter
 *
 * Mount in app.ts with: app.route("/", quotaBoostsRouter)
 */

import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  BoostWindowSchema,
  QuotaBoostGrantCreateSchema,
  QuotaBoostGrantIdParamSchema,
  QuotaBoostGrantListQuerySchema,
  QuotaBoostGrantListResponseSchema,
  QuotaBoostGrantSchema,
} from "@/lib/api/v1/schemas/quota-boosts";
import { createQuotaBoostGrant, deleteQuotaBoostGrant, listQuotaBoostGrants } from "./handlers";

export const quotaBoostsRouter = new OpenAPIHono({
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
    description: "Grant not found.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

quotaBoostsRouter.openapi(
  createRoute({
    method: "get",
    path: "/quota-boosts",
    middleware: requireAuth("admin"),
    tags: ["Quota Boosts"],
    summary: "List quota boost grants",
    description:
      "Lists quota boost grants, optionally filtered by userId and/or modelGroupId. Only personal-user grants exist (D11).",
    "x-required-access": "admin",
    security,
    request: { query: QuotaBoostGrantListQuerySchema },
    responses: {
      200: {
        description: "Quota boost grants.",
        content: { "application/json": { schema: QuotaBoostGrantListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listQuotaBoostGrants as never
);

quotaBoostsRouter.openapi(
  createRoute({
    method: "post",
    path: "/quota-boosts",
    middleware: requireAuth("admin"),
    tags: ["Quota Boosts"],
    summary: "Create quota boost grant",
    description:
      "Grants a temporary quota boost for a personal user on a specific model group and window. Multiple overlapping grants with different validity ranges are allowed (D14: no approval workflow).",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: QuotaBoostGrantCreateSchema } },
      },
    },
    responses: {
      201: {
        description: "Created quota boost grant.",
        content: { "application/json": { schema: QuotaBoostGrantSchema } },
      },
      ...problemResponses,
    },
  }),
  createQuotaBoostGrant as never
);

quotaBoostsRouter.openapi(
  createRoute({
    method: "delete",
    path: "/quota-boosts/{id}",
    middleware: requireAuth("admin"),
    tags: ["Quota Boosts"],
    summary: "Revoke quota boost grant",
    description: "Hard-deletes a quota boost grant by id (revoke = delete row, per D14).",
    "x-required-access": "admin",
    security,
    request: { params: QuotaBoostGrantIdParamSchema },
    responses: {
      204: { description: "Grant revoked." },
      ...problemResponses,
    },
  }),
  deleteQuotaBoostGrant as never
);

export { BoostWindowSchema, QuotaBoostGrantSchema };
