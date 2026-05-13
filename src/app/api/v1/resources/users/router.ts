import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  GenericUserResponseSchema,
  StringListResponseSchema,
  UserAllLimitUsageResponseSchema,
  UserCreateSchema,
  UserDetailResponseSchema,
  UserEnableSchema,
  UserFilterSearchQuerySchema,
  UserIdParamSchema,
  UserLimitUsageResponseSchema,
  UserListQuerySchema,
  UserListResponseSchema,
  UserRenewSchema,
  UsersBatchUpdateSchema,
  UsersUsageBatchSchema,
  UserUpdateSchema,
} from "@/lib/api/v1/schemas/users";
import {
  batchUpdateUsers,
  createUser,
  deleteUser,
  enableUser,
  filterSearchUsers,
  getUser,
  getUserAllLimitUsage,
  getUserKeyGroups,
  getUserLimitUsage,
  getUsersUsage,
  getUserTags,
  listCurrentUser,
  listUsers,
  renewUser,
  resetUserLimits,
  resetUserStatistics,
  searchUsers,
  updateUser,
} from "./handlers";

export const usersRouter = new OpenAPIHono({
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
    description: "User not found.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  500: {
    description: "Internal server error.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  503: {
    description: "Dependency unavailable.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

usersRouter.openapi(
  createRoute({
    method: "get",
    path: "/users",
    middleware: requireAuth("admin"),
    tags: ["Users"],
    summary: "List users",
    description: "Lists users with cursor pagination and dashboard filters.",
    "x-required-access": "admin",
    security,
    request: { query: UserListQuerySchema },
    responses: {
      200: {
        description: "User page.",
        content: { "application/json": { schema: UserListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listUsers as never
);

usersRouter.openapi(
  createRoute({
    method: "post",
    path: "/users",
    middleware: requireAuth("admin"),
    tags: ["Users"],
    summary: "Create user",
    description: "Creates a user, optionally with a default key.",
    "x-required-access": "admin",
    security,
    request: {
      body: { required: true, content: { "application/json": { schema: UserCreateSchema } } },
    },
    responses: {
      201: {
        description: "Created user.",
        content: { "application/json": { schema: GenericUserResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  createUser as never
);

usersRouter.openapi(
  createRoute({
    method: "get",
    path: "/users:self",
    middleware: requireAuth("read"),
    tags: ["Users"],
    summary: "List current user",
    description: "Returns the current user in the legacy users-page list shape.",
    "x-required-access": "read",
    security,
    responses: {
      200: {
        description: "Current user list page.",
        content: { "application/json": { schema: UserListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listCurrentUser as never
);

usersRouter.openapi(
  createRoute({
    method: "get",
    path: "/users/tags",
    middleware: requireAuth("admin"),
    tags: ["Users"],
    summary: "List user tags",
    description: "Lists distinct user tags.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "User tags.",
        content: { "application/json": { schema: StringListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getUserTags as never
);

usersRouter.openapi(
  createRoute({
    method: "get",
    path: "/users/key-groups",
    middleware: requireAuth("admin"),
    tags: ["Users"],
    summary: "List user key groups",
    description: "Lists distinct key provider groups used by users.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "User key groups.",
        content: { "application/json": { schema: StringListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getUserKeyGroups as never
);

usersRouter.openapi(
  createRoute({
    method: "get",
    path: "/users:filter-search",
    middleware: requireAuth("admin"),
    tags: ["Users"],
    summary: "Search users for filters",
    description: "Returns compact user options for filter controls.",
    "x-required-access": "admin",
    security,
    request: { query: UserFilterSearchQuerySchema },
    responses: {
      200: {
        description: "User options.",
        content: { "application/json": { schema: GenericUserResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  filterSearchUsers as never
);

usersRouter.openapi(
  createRoute({
    method: "get",
    path: "/users:search",
    middleware: requireAuth("admin"),
    tags: ["Users"],
    summary: "Search users",
    description: "Returns user search results.",
    "x-required-access": "admin",
    security,
    request: { query: UserFilterSearchQuerySchema },
    responses: {
      200: {
        description: "Search results.",
        content: { "application/json": { schema: GenericUserResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  searchUsers as never
);

usersRouter.openapi(
  createRoute({
    method: "post",
    path: "/users:usageBatch",
    middleware: requireAuth("admin"),
    tags: ["Users"],
    summary: "Batch get user key usage",
    description: "Returns lazy-loaded usage fields for a batch of users.",
    "x-required-access": "admin",
    security,
    request: {
      body: { required: true, content: { "application/json": { schema: UsersUsageBatchSchema } } },
    },
    responses: {
      200: {
        description: "Usage batch.",
        content: { "application/json": { schema: GenericUserResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getUsersUsage as never
);

usersRouter.openapi(
  createRoute({
    method: "post",
    path: "/users:batchUpdate",
    middleware: requireAuth("admin"),
    tags: ["Users"],
    summary: "Batch update users",
    description: "Updates selected users with one patch.",
    "x-required-access": "admin",
    security,
    request: {
      body: { required: true, content: { "application/json": { schema: UsersBatchUpdateSchema } } },
    },
    responses: {
      200: {
        description: "Batch update result.",
        content: { "application/json": { schema: GenericUserResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  batchUpdateUsers as never
);

usersRouter.openapi(
  createRoute({
    method: "get",
    path: "/users/{id}",
    middleware: requireAuth("admin"),
    tags: ["Users"],
    summary: "Get user",
    description: "Gets one user from the admin user page data set.",
    "x-required-access": "admin",
    security,
    request: { params: UserIdParamSchema },
    responses: {
      200: {
        description: "User detail.",
        content: { "application/json": { schema: UserDetailResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getUser as never
);

usersRouter.openapi(
  createRoute({
    method: "patch",
    path: "/users/{id}",
    middleware: requireAuth("admin"),
    tags: ["Users"],
    summary: "Update user",
    description: "Partially updates one user.",
    "x-required-access": "admin",
    security,
    request: {
      params: UserIdParamSchema,
      body: { required: true, content: { "application/json": { schema: UserUpdateSchema } } },
    },
    responses: {
      200: {
        description: "Update result.",
        content: { "application/json": { schema: GenericUserResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  updateUser as never
);

usersRouter.openapi(
  createRoute({
    method: "delete",
    path: "/users/{id}",
    middleware: requireAuth("admin"),
    tags: ["Users"],
    summary: "Delete user",
    description: "Deletes one user.",
    "x-required-access": "admin",
    security,
    request: { params: UserIdParamSchema },
    responses: { 204: { description: "User deleted." }, ...problemResponses },
  }),
  deleteUser as never
);

const enableUserRoute = createRoute({
  method: "post",
  path: "/users/{id}:enable",
  tags: ["Users"],
  summary: "Set user enabled state",
  description: "Enables or disables one user.",
  "x-required-access": "admin",
  security,
  request: {
    params: UserIdParamSchema,
    body: { required: true, content: { "application/json": { schema: UserEnableSchema } } },
  },
  responses: {
    200: {
      description: "Toggle result.",
      content: { "application/json": { schema: GenericUserResponseSchema } },
    },
    ...problemResponses,
  },
});

usersRouter.openAPIRegistry.registerPath(enableUserRoute);
usersRouter.post("/users/:id{[0-9]+:enable}", requireAuth("admin"), enableUser);

const renewUserRoute = createRoute({
  method: "post",
  path: "/users/{id}:renew",
  tags: ["Users"],
  summary: "Renew user expiration",
  description: "Updates one user expiration date.",
  "x-required-access": "admin",
  security,
  request: {
    params: UserIdParamSchema,
    body: { required: true, content: { "application/json": { schema: UserRenewSchema } } },
  },
  responses: {
    200: {
      description: "Renew result.",
      content: { "application/json": { schema: GenericUserResponseSchema } },
    },
    ...problemResponses,
  },
});

usersRouter.openAPIRegistry.registerPath(renewUserRoute);
usersRouter.post("/users/:id{[0-9]+:renew}", requireAuth("admin"), renewUser);

usersRouter.openapi(
  createRoute({
    method: "get",
    path: "/users/{id}/limit-usage",
    middleware: requireAuth("read"),
    tags: ["Users"],
    summary: "Get user limit usage",
    description: "Returns current per-user RPM and daily cost usage.",
    "x-required-access": "read",
    security,
    request: { params: UserIdParamSchema },
    responses: {
      200: {
        description: "Limit usage.",
        content: { "application/json": { schema: UserLimitUsageResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getUserLimitUsage as never
);

usersRouter.openapi(
  createRoute({
    method: "get",
    path: "/users/{id}/limit-usage:all",
    middleware: requireAuth("read"),
    tags: ["Users"],
    summary: "Get all user limit usage",
    description: "Returns all current user cost limit buckets.",
    "x-required-access": "read",
    security,
    request: { params: UserIdParamSchema },
    responses: {
      200: {
        description: "All limit usage.",
        content: { "application/json": { schema: UserAllLimitUsageResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getUserAllLimitUsage as never
);

usersRouter.openapi(
  createRoute({
    method: "post",
    path: "/users/{id}/limits:reset",
    middleware: requireAuth("admin"),
    tags: ["Users"],
    summary: "Reset user cost limits",
    description: "Resets user limit counters without deleting logs.",
    "x-required-access": "admin",
    security,
    request: { params: UserIdParamSchema },
    responses: { 204: { description: "User limits reset." }, ...problemResponses },
  }),
  resetUserLimits as never
);

usersRouter.openapi(
  createRoute({
    method: "post",
    path: "/users/{id}/statistics:reset",
    middleware: requireAuth("admin"),
    tags: ["Users"],
    summary: "Reset user statistics",
    description: "Resets all user statistics through the existing action.",
    "x-required-access": "admin",
    security,
    request: { params: UserIdParamSchema },
    responses: { 204: { description: "User statistics reset." }, ...problemResponses },
  }),
  resetUserStatistics as never
);
