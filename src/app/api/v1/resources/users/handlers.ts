import type { Context } from "hono";
import type { ActionResult } from "@/actions/types";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import { withNoStoreHeaders } from "@/lib/api/v1/_shared/cache-control";
import {
  createProblemResponse,
  fromZodError,
  publicActionErrorDetail,
} from "@/lib/api/v1/_shared/error-envelope";
import { parseHonoJsonBody } from "@/lib/api/v1/_shared/request-body";
import {
  createdResponse,
  jsonResponse,
  noContentResponse,
} from "@/lib/api/v1/_shared/response-helpers";
import {
  UserCreateSchema,
  UserEnableSchema,
  UserFilterSearchQuerySchema,
  UserIdParamSchema,
  UserListQuerySchema,
  UserRenewSchema,
  UsersBatchUpdateSchema,
  UsersUsageBatchSchema,
  UserUpdateSchema,
} from "@/lib/api/v1/schemas/users";

export async function listUsers(c: Context): Promise<Response> {
  const query = UserListQuerySchema.safeParse({
    cursor: c.req.query("cursor"),
    limit: c.req.query("limit"),
    q: c.req.query("q"),
    tags: c.req.query("tags"),
    keyGroups: c.req.query("keyGroups"),
    status: c.req.query("status"),
    sortBy: c.req.query("sortBy"),
    sortOrder: c.req.query("sortOrder"),
  });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);

  const actions = await import("@/actions/users");
  const result = await callAction(
    c,
    actions.getUsersBatchCore,
    [
      {
        cursor: query.data.cursor,
        limit: query.data.limit,
        searchTerm: query.data.q,
        tagFilters: splitCsv(query.data.tags),
        keyGroupFilters: splitCsv(query.data.keyGroups),
        statusFilter: query.data.status,
        sortBy: query.data.sortBy,
        sortOrder: query.data.sortOrder,
      },
    ] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse({
    items: redactUserKeys(result.data.users),
    pageInfo: {
      nextCursor: result.data.nextCursor,
      hasMore: result.data.hasMore,
      limit: query.data.limit,
    },
  });
}

export async function listCurrentUser(c: Context): Promise<Response> {
  const currentUserId = c.get("auth")?.session?.user.id;
  if (!currentUserId) {
    return createProblemResponse({
      status: 401,
      instance: new URL(c.req.url).pathname,
      errorCode: "auth.missing",
      detail: "Authentication is required.",
    });
  }
  const actions = await import("@/actions/users");
  const result = await callAction(
    c,
    actions.getUserById,
    [currentUserId] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse({
    items: [redactUserKeys(result.data)],
    pageInfo: {
      nextCursor: null,
      hasMore: false,
      limit: 1,
    },
  });
}

export async function getUser(c: Context): Promise<Response> {
  const params = parseUserParams(c);
  if (params instanceof Response) return params;
  const actions = await import("@/actions/users");
  const result = await callAction(c, actions.getUserById, [params.id] as never[], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse(redactUserKeys(result.data));
}

export async function createUser(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, UserCreateSchema);
  if (!body.ok) return body.response;
  const withDefaultKey = c.req.query("withDefaultKey") !== "false";
  const actions = await import("@/actions/users");
  const result = await callAction(
    c,
    withDefaultKey ? actions.addUser : actions.createUserOnly,
    [body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  const id = (result.data as { user?: { id?: number } }).user?.id;
  return createdResponse(result.data, id ? `/api/v1/users/${id}` : "/api/v1/users", {
    headers: withNoStoreHeaders(),
  });
}

export async function updateUser(c: Context): Promise<Response> {
  const params = parseUserParams(c);
  if (params instanceof Response) return params;
  const body = await parseHonoJsonBody(c, UserUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/users");
  const result = await callAction(
    c,
    actions.editUser,
    [params.id, body.data] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ id: params.id, updated: true });
}

export async function deleteUser(c: Context): Promise<Response> {
  const params = parseUserParams(c);
  if (params instanceof Response) return params;
  const actions = await import("@/actions/users");
  const result = await callAction(c, actions.removeUser, [params.id] as never[], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

export async function enableUser(c: Context): Promise<Response> {
  const params = parseUserParams(c);
  if (params instanceof Response) return params;
  const body = await parseHonoJsonBody(c, UserEnableSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/users");
  return actionJson(
    c,
    await callAction(
      c,
      actions.toggleUserEnabled,
      [params.id, body.data.enabled] as never[],
      c.get("auth")
    )
  );
}

export async function renewUser(c: Context): Promise<Response> {
  const params = parseUserParams(c);
  if (params instanceof Response) return params;
  const body = await parseHonoJsonBody(c, UserRenewSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/users");
  return actionJson(
    c,
    await callAction(c, actions.renewUser, [params.id, body.data] as never[], c.get("auth"))
  );
}

export async function getUserLimitUsage(c: Context): Promise<Response> {
  const params = parseUserParams(c);
  if (params instanceof Response) return params;
  const actions = await import("@/actions/users");
  return actionJson(
    c,
    await callAction(c, actions.getUserLimitUsage, [params.id] as never[], c.get("auth"))
  );
}

export async function getUserAllLimitUsage(c: Context): Promise<Response> {
  const params = parseUserParams(c);
  if (params instanceof Response) return params;
  const actions = await import("@/actions/users");
  return actionJson(
    c,
    await callAction(c, actions.getUserAllLimitUsage, [params.id] as never[], c.get("auth"))
  );
}

export async function resetUserLimits(c: Context): Promise<Response> {
  const params = parseUserParams(c);
  if (params instanceof Response) return params;
  const actions = await import("@/actions/users");
  const result = await callAction(
    c,
    actions.resetUserLimitsOnly,
    [params.id] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

export async function resetUserStatistics(c: Context): Promise<Response> {
  const params = parseUserParams(c);
  if (params instanceof Response) return params;
  const actions = await import("@/actions/users");
  const result = await callAction(
    c,
    actions.resetUserAllStatistics,
    [params.id] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return noContentResponse();
}

export async function getUserTags(c: Context): Promise<Response> {
  const actions = await import("@/actions/users");
  const result = await callAction(c, actions.getAllUserTags, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data });
}

export async function getUserKeyGroups(c: Context): Promise<Response> {
  const actions = await import("@/actions/users");
  const result = await callAction(c, actions.getAllUserKeyGroups, [], c.get("auth"));
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data });
}

export async function filterSearchUsers(c: Context): Promise<Response> {
  const query = UserFilterSearchQuerySchema.safeParse({
    q: c.req.query("q"),
    limit: c.req.query("limit"),
  });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);
  const actions = await import("@/actions/users");
  const result = await callAction(
    c,
    actions.searchUsersForFilter,
    [query.data.q ?? "", query.data.limit] as never[],
    c.get("auth")
  );
  if (!result.ok) return actionError(c, result);
  return jsonResponse({ items: result.data });
}

export async function searchUsers(c: Context): Promise<Response> {
  const query = UserFilterSearchQuerySchema.safeParse({
    q: c.req.query("q"),
    limit: c.req.query("limit"),
  });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);
  const actions = await import("@/actions/users");
  const result = await callAction(
    c,
    actions.searchUsers,
    [query.data.q ?? "", query.data.limit] as never[],
    c.get("auth")
  );
  return result.ok ? jsonResponse({ items: result.data }) : actionError(c, result);
}

export async function getUsersUsage(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, UsersUsageBatchSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/users");
  return actionJson(
    c,
    await callAction(c, actions.getUsersUsageBatch, [body.data.userIds] as never[], c.get("auth"))
  );
}

export async function batchUpdateUsers(c: Context): Promise<Response> {
  const body = await parseHonoJsonBody(c, UsersBatchUpdateSchema);
  if (!body.ok) return body.response;
  const actions = await import("@/actions/users");
  return actionJson(
    c,
    await callAction(c, actions.batchUpdateUsers, [body.data] as never[], c.get("auth"))
  );
}

function parseUserParams(c: Context): { id: number } | Response {
  const rawId = (c.req.param("id") ?? "").replace(/:(enable|renew)$/, "");
  const params = UserIdParamSchema.safeParse({ id: rawId });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  return params.data;
}

function splitCsv(value?: string): string[] | undefined {
  const items = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items && items.length > 0 ? items : undefined;
}

function actionJson<T>(c: Context, result: ActionResult<T>): Response {
  if (!result.ok) return actionError(c, result);
  return jsonResponse(result.data ?? { ok: true });
}

function actionError(c: Context, result: Extract<ActionResult<unknown>, { ok: false }>): Response {
  const detail = result.error || "Request failed.";
  const code = result.errorCode;
  const status = getActionErrorStatus(code, detail);
  return createProblemResponse({
    status,
    instance: new URL(c.req.url).pathname,
    errorCode: code ?? (status === 404 ? "user.not_found" : "user.action_failed"),
    errorParams: result.errorParams,
    detail: publicActionErrorDetail(status),
  });
}

function getActionErrorStatus(
  code: string | undefined,
  detail: string
): 400 | 401 | 403 | 404 | 500 | 503 {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "PERMISSION_DENIED") return 403;
  if (code === "NOT_FOUND" || detail.includes("不存在") || detail.includes("not found")) return 404;
  if (code === "DATABASE_ERROR") return 503;
  if (code === "CONNECTION_FAILED" || code === "TIMEOUT" || code === "NETWORK_ERROR") return 503;
  if (
    code === "INTERNAL_ERROR" ||
    code === "OPERATION_FAILED" ||
    code === "CREATE_FAILED" ||
    code === "UPDATE_FAILED" ||
    code === "DELETE_FAILED"
  ) {
    return 500;
  }
  if (detail.includes("权限")) return 403;
  return 400;
}

function redactUserKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactUserKeys(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "fullKey")
    .map(([key, child]) => [key, redactUserKeys(child)] as const);
  return Object.fromEntries(entries);
}
