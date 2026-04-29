import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  GenericKeyResponseSchema,
  KeyCreateSchema,
  KeyEnableSchema,
  KeyIdParamSchema,
  KeyListQuerySchema,
  KeyListResponseSchema,
  KeyRenewSchema,
  KeysBatchUpdateSchema,
  KeyUpdateSchema,
  PatchKeyLimitParamSchema,
  PatchKeyLimitSchema,
  UserIdForKeysParamSchema,
} from "@/lib/api/v1/schemas/keys";
import {
  batchUpdateKeys,
  createUserKey,
  deleteKey,
  enableKey,
  getKey,
  getKeyLimitUsage,
  getKeyQuotaUsage,
  listUserKeys,
  patchKeyLimit,
  renewKey,
  resetKeyLimits,
  updateKey,
} from "./handlers";

export const keysRouter = new OpenAPIHono({
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
    description: "Key not found.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

keysRouter.openapi(
  createRoute({
    method: "get",
    path: "/users/{userId}/keys",
    middleware: requireAuth("admin"),
    tags: ["Keys"],
    summary: "List user keys",
    description: "Lists keys for one user. This management endpoint is admin-only.",
    "x-required-access": "admin",
    security,
    request: { params: UserIdForKeysParamSchema, query: KeyListQuerySchema },
    responses: {
      200: {
        description: "Key list.",
        content: { "application/json": { schema: KeyListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listUserKeys as never
);

keysRouter.openapi(
  createRoute({
    method: "post",
    path: "/users/{userId}/keys",
    middleware: requireAuth("admin"),
    tags: ["Keys"],
    summary: "Create user key",
    description: "Creates a key for a user through the existing key action.",
    "x-required-access": "admin",
    security,
    request: {
      params: UserIdForKeysParamSchema,
      body: { required: true, content: { "application/json": { schema: KeyCreateSchema } } },
    },
    responses: {
      201: {
        description: "Created key.",
        content: { "application/json": { schema: GenericKeyResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  createUserKey as never
);

keysRouter.openapi(
  createRoute({
    method: "get",
    path: "/keys/{keyId}",
    middleware: requireAuth("admin"),
    tags: ["Keys"],
    summary: "Get key",
    description: "Gets one key view through the existing key limit usage guard.",
    "x-required-access": "admin",
    security,
    request: { params: KeyIdParamSchema },
    responses: {
      200: {
        description: "Key detail.",
        content: { "application/json": { schema: GenericKeyResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getKey as never
);

keysRouter.openapi(
  createRoute({
    method: "patch",
    path: "/keys/{keyId}",
    middleware: requireAuth("admin"),
    tags: ["Keys"],
    summary: "Update key",
    description: "Updates one key.",
    "x-required-access": "admin",
    security,
    request: {
      params: KeyIdParamSchema,
      body: { required: true, content: { "application/json": { schema: KeyUpdateSchema } } },
    },
    responses: {
      200: {
        description: "Update result.",
        content: { "application/json": { schema: GenericKeyResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  updateKey as never
);

keysRouter.openapi(
  createRoute({
    method: "delete",
    path: "/keys/{keyId}",
    middleware: requireAuth("admin"),
    tags: ["Keys"],
    summary: "Delete key",
    description: "Deletes one key.",
    "x-required-access": "admin",
    security,
    request: { params: KeyIdParamSchema },
    responses: { 204: { description: "Key deleted." }, ...problemResponses },
  }),
  deleteKey as never
);

const enableKeyRoute = createRoute({
  method: "post",
  path: "/keys/{keyId}:enable",
  tags: ["Keys"],
  summary: "Set key enabled state",
  description: "Enables or disables one key.",
  "x-required-access": "admin",
  security,
  request: {
    params: KeyIdParamSchema,
    body: { required: true, content: { "application/json": { schema: KeyEnableSchema } } },
  },
  responses: {
    200: {
      description: "Toggle result.",
      content: { "application/json": { schema: GenericKeyResponseSchema } },
    },
    ...problemResponses,
  },
});

keysRouter.openAPIRegistry.registerPath(enableKeyRoute);
keysRouter.post("/keys/:keyId{[0-9]+:enable}", requireAuth("admin"), enableKey);

const renewKeyRoute = createRoute({
  method: "post",
  path: "/keys/{keyId}:renew",
  tags: ["Keys"],
  summary: "Renew key expiration",
  description: "Updates one key expiration date.",
  "x-required-access": "admin",
  security,
  request: {
    params: KeyIdParamSchema,
    body: { required: true, content: { "application/json": { schema: KeyRenewSchema } } },
  },
  responses: {
    200: {
      description: "Renew result.",
      content: { "application/json": { schema: GenericKeyResponseSchema } },
    },
    ...problemResponses,
  },
});

keysRouter.openAPIRegistry.registerPath(renewKeyRoute);
keysRouter.post("/keys/:keyId{[0-9]+:renew}", requireAuth("admin"), renewKey);

keysRouter.openapi(
  createRoute({
    method: "post",
    path: "/keys/{keyId}/limits:reset",
    middleware: requireAuth("admin"),
    tags: ["Keys"],
    summary: "Reset key cost limits",
    description: "Resets key cost limit counters without deleting logs.",
    "x-required-access": "admin",
    security,
    request: { params: KeyIdParamSchema },
    responses: { 204: { description: "Key limits reset." }, ...problemResponses },
  }),
  resetKeyLimits as never
);

keysRouter.openapi(
  createRoute({
    method: "get",
    path: "/keys/{keyId}/limit-usage",
    middleware: requireAuth("admin"),
    tags: ["Keys"],
    summary: "Get key limit usage",
    description: "Returns all key cost buckets and concurrent session usage.",
    "x-required-access": "admin",
    security,
    request: { params: KeyIdParamSchema },
    responses: {
      200: {
        description: "Key limit usage.",
        content: { "application/json": { schema: GenericKeyResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getKeyLimitUsage as never
);

keysRouter.openapi(
  createRoute({
    method: "get",
    path: "/keys/{keyId}/quota",
    middleware: requireAuth("admin"),
    tags: ["Keys"],
    summary: "Get key quota usage",
    description: "Returns key quota usage for the quota dialog.",
    "x-required-access": "admin",
    security,
    request: { params: KeyIdParamSchema },
    responses: {
      200: {
        description: "Key quota usage.",
        content: { "application/json": { schema: GenericKeyResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getKeyQuotaUsage as never
);

keysRouter.openapi(
  createRoute({
    method: "patch",
    path: "/keys/{keyId}/limits/{field}",
    middleware: requireAuth("admin"),
    tags: ["Keys"],
    summary: "Patch one key limit",
    description: "Updates one key limit field without overwriting the rest of the key.",
    "x-required-access": "admin",
    security,
    request: {
      params: PatchKeyLimitParamSchema,
      body: { required: true, content: { "application/json": { schema: PatchKeyLimitSchema } } },
    },
    responses: {
      200: {
        description: "Patch result.",
        content: { "application/json": { schema: GenericKeyResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  patchKeyLimit as never
);

keysRouter.openapi(
  createRoute({
    method: "post",
    path: "/keys:batchUpdate",
    middleware: requireAuth("admin"),
    tags: ["Keys"],
    summary: "Batch update keys",
    description: "Updates selected keys with one patch.",
    "x-required-access": "admin",
    security,
    request: {
      body: { required: true, content: { "application/json": { schema: KeysBatchUpdateSchema } } },
    },
    responses: {
      200: {
        description: "Batch update result.",
        content: { "application/json": { schema: GenericKeyResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  batchUpdateKeys as never
);
