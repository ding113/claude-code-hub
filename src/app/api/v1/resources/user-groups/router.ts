// Router variable: userGroupsRouter
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  UserGroupCreateSchema,
  UserGroupIdParamSchema,
  UserGroupListResponseSchema,
  UserGroupSchema,
  UserGroupUpdateSchema,
} from "@/lib/api/v1/schemas/user-groups";
import { createUserGroup, deleteUserGroup, listUserGroups, updateUserGroup } from "./handlers";

export const userGroupsRouter = new OpenAPIHono({
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
    description: "User group not found.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

userGroupsRouter.openapi(
  createRoute({
    method: "get",
    path: "/user-groups",
    middleware: requireAuth("admin"),
    tags: ["User Groups"],
    summary: "List user groups",
    description: "Lists all user groups with member counts derived from users.tags.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "User groups.",
        content: { "application/json": { schema: UserGroupListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listUserGroups as never
);

userGroupsRouter.openapi(
  createRoute({
    method: "post",
    path: "/user-groups",
    middleware: requireAuth("admin"),
    tags: ["User Groups"],
    summary: "Create user group",
    description:
      "Registers a tag as a user group. Members are derived from users whose tags contain this tag.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: UserGroupCreateSchema } },
      },
    },
    responses: {
      201: {
        description: "Created user group.",
        content: { "application/json": { schema: UserGroupSchema } },
      },
      ...problemResponses,
    },
  }),
  createUserGroup as never
);

userGroupsRouter.openapi(
  createRoute({
    method: "patch",
    path: "/user-groups/{id}",
    middleware: requireAuth("admin"),
    tags: ["User Groups"],
    summary: "Update user group",
    description: "Partially updates user group display name and description.",
    "x-required-access": "admin",
    security,
    request: {
      params: UserGroupIdParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: UserGroupUpdateSchema } },
      },
    },
    responses: {
      200: {
        description: "Updated user group.",
        content: { "application/json": { schema: UserGroupSchema } },
      },
      ...problemResponses,
    },
  }),
  updateUserGroup as never
);

userGroupsRouter.openapi(
  createRoute({
    method: "delete",
    path: "/user-groups/{id}",
    middleware: requireAuth("admin"),
    tags: ["User Groups"],
    summary: "Delete user group",
    description: "Deletes a user group registration. Does not modify user tags.",
    "x-required-access": "admin",
    security,
    request: { params: UserGroupIdParamSchema },
    responses: {
      204: { description: "User group deleted." },
      ...problemResponses,
    },
  }),
  deleteUserGroup as never
);
