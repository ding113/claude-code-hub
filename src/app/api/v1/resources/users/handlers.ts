/**
 * /api/v1/users handler 集合
 *
 * 设计要点：
 * - 每个 handler 仅做：参数解析 -> callAction(...) -> 序列化响应；
 * - 列表/详情通过 `getUsersBatch` action 拉取，再用 `serializeUser` 把 UserDisplay
 *   归一化为 OpenAPI 响应；详情端点复用列表 action（cursor=undefined, ids=[id]）。
 * - addUser 的 201 响应包含 defaultKey.key（原始 key 字符串），仅此一次；
 *   其他 read/write 端点都用 redactKey / maskedKey 脱敏。
 */

import type { Context } from "hono";
import {
  addUser as addUserAction,
  editUser as editUserAction,
  type GetUsersBatchParams,
  getAllUserKeyGroups as getAllUserKeyGroupsAction,
  getAllUserTags as getAllUserTagsAction,
  getUsersBatch as getUsersBatchAction,
  removeUser as removeUserAction,
  renewUser as renewUserAction,
  resetUserLimitsOnly as resetUserLimitsOnlyAction,
  toggleUserEnabled as toggleUserEnabledAction,
} from "@/actions/users";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import { problem } from "@/lib/api/v1/_shared/error-envelope";
import { parseJsonBody } from "@/lib/api/v1/_shared/request-body";
import {
  respondCreated,
  respondJson,
  respondNoContent,
} from "@/lib/api/v1/_shared/response-helpers";
import {
  serializeUser,
  UserCreateSchema,
  UserEnableSchema,
  UserRenewSchema,
  UserUpdateSchema,
} from "@/lib/api/v1/schemas/users";

type AnyAction = (...args: unknown[]) => Promise<unknown>;

const listUsersAction = getUsersBatchAction as unknown as AnyAction;
const createUser = addUserAction as unknown as AnyAction;
const updateUser = editUserAction as unknown as AnyAction;
const deleteUser = removeUserAction as unknown as AnyAction;
const enableUser = toggleUserEnabledAction as unknown as AnyAction;
const renewUserActionFn = renewUserAction as unknown as AnyAction;
const resetLimits = resetUserLimitsOnlyAction as unknown as AnyAction;
const tagsAction = getAllUserTagsAction as unknown as AnyAction;
const groupsAction = getAllUserKeyGroupsAction as unknown as AnyAction;

const RESOURCE_BASE_PATH = "/api/v1/users";

/** 解析 path 参数；支持 :id / :idEnable / :idRenew / :idLimitsReset 多种格式。 */
function parseIdParam(c: Context): { ok: true; id: number } | { ok: false; response: Response } {
  const candidates = [
    c.req.param("id"),
    c.req.param("idEnable"),
    c.req.param("idRenew"),
    c.req.param("idLimitsReset"),
  ];
  let raw: string | undefined;
  for (const cand of candidates) {
    if (typeof cand === "string" && cand.length > 0) {
      // 形如 "42:enable" / "42:renew" / "42:reset" -> 取冒号前部分
      raw = cand.includes(":") ? cand.split(":")[0] : cand;
      break;
    }
  }
  const id = raw ? Number(raw) : Number.NaN;
  if (!Number.isInteger(id) || id <= 0) {
    return {
      ok: false,
      response: problem(c, {
        status: 400,
        errorCode: "validation_failed",
        title: "Invalid path parameter",
        detail: "Path parameter `id` must be a positive integer.",
      }),
    };
  }
  return { ok: true, id };
}

// ==================== GET /users ====================

interface UsersBatchData {
  users: Array<Record<string, unknown>>;
  nextCursor: string | null;
  hasMore: boolean;
}

function parseListQuery(c: Context): GetUsersBatchParams {
  const q = c.req.query();
  const params: GetUsersBatchParams = {};
  if (q.cursor) params.cursor = q.cursor;
  if (q.limit) {
    const n = Number(q.limit);
    if (Number.isFinite(n) && n > 0) params.limit = Math.trunc(n);
  }
  if (q.searchTerm) params.searchTerm = q.searchTerm;
  if (q.statusFilter) params.statusFilter = q.statusFilter as GetUsersBatchParams["statusFilter"];
  if (q.sortBy) params.sortBy = q.sortBy as GetUsersBatchParams["sortBy"];
  if (q.sortOrder) params.sortOrder = q.sortOrder as GetUsersBatchParams["sortOrder"];
  if (q.tagFilters) {
    params.tagFilters = q.tagFilters
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (q.keyGroupFilters) {
    params.keyGroupFilters = q.keyGroupFilters
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return params;
}

export async function listUsers(c: Context): Promise<Response> {
  const params = parseListQuery(c);
  const result = await callAction<UsersBatchData>(c, listUsersAction, [params]);
  if (!result.ok) return result.problem;
  const limit = params.limit ?? result.data.users.length;
  return respondJson(
    c,
    {
      items: result.data.users.map(serializeUser),
      pageInfo: {
        nextCursor: result.data.nextCursor,
        hasMore: result.data.hasMore,
        limit,
      },
    },
    200
  );
}

// ==================== GET /users/{id} ====================

export async function getUser(c: Context): Promise<Response> {
  const parsed = parseIdParam(c);
  if (!parsed.ok) return parsed.response;
  // 复用 listUsersAction：legacy action 不暴露按 id 取单条，搜索是开销很小的回退路径。
  const result = await callAction<UsersBatchData>(c, listUsersAction, [{}]);
  if (!result.ok) return result.problem;
  const user = result.data.users.find((u) => (u as { id: number }).id === parsed.id);
  if (!user) {
    return problem(c, {
      status: 404,
      errorCode: "not_found",
      title: "User not found",
      detail: `User #${parsed.id} does not exist.`,
    });
  }
  return respondJson(c, serializeUser(user), 200);
}

// ==================== POST /users ====================

interface AddUserSuccess {
  user: Record<string, unknown> & {
    id: number;
    name: string;
    role: "admin" | "user";
    isEnabled: boolean;
    expiresAt: Date | null;
  };
  defaultKey: { id: number; name: string; key: string };
}

export async function createUserHandler(c: Context): Promise<Response> {
  const body = await parseJsonBody<typeof UserCreateSchema>(c, UserCreateSchema);
  if (!body.ok) return body.response;

  const result = await callAction<AddUserSuccess>(c, createUser, [body.data]);
  if (!result.ok) return result.problem;

  const u = result.data.user;
  const responseBody = {
    user: {
      id: u.id,
      name: u.name,
      note: (u.note as string | undefined) ?? null,
      role: u.role,
      isEnabled: u.isEnabled,
      expiresAt: u.expiresAt instanceof Date ? u.expiresAt.toISOString() : null,
      rpm: (u.rpm as number | null | undefined) ?? null,
      dailyQuota: (u.dailyQuota as number | null | undefined) ?? null,
      providerGroup: (u.providerGroup as string | null | undefined) ?? null,
      tags: (u.tags as string[] | undefined) ?? [],
      limit5hUsd: (u.limit5hUsd as number | null | undefined) ?? null,
      limit5hResetMode: (u.limit5hResetMode as "fixed" | "rolling") ?? "rolling",
      limitWeeklyUsd: (u.limitWeeklyUsd as number | null | undefined) ?? null,
      limitMonthlyUsd: (u.limitMonthlyUsd as number | null | undefined) ?? null,
      limitTotalUsd: (u.limitTotalUsd as number | null | undefined) ?? null,
      limitConcurrentSessions: (u.limitConcurrentSessions as number | null | undefined) ?? null,
      allowedModels: (u.allowedModels as string[] | undefined) ?? [],
    },
    defaultKey: {
      id: result.data.defaultKey.id,
      name: result.data.defaultKey.name,
      key: result.data.defaultKey.key, // 原始 key，仅此一次
    },
  };
  return respondCreated(c, responseBody, `${RESOURCE_BASE_PATH}/${u.id}`);
}

// ==================== PATCH /users/{id} ====================

export async function patchUser(c: Context): Promise<Response> {
  const parsed = parseIdParam(c);
  if (!parsed.ok) return parsed.response;
  const body = await parseJsonBody<typeof UserUpdateSchema>(c, UserUpdateSchema);
  if (!body.ok) return body.response;

  const result = await callAction<void>(c, updateUser, [parsed.id, body.data]);
  if (!result.ok) return result.problem;

  // editUser 不返回更新后的对象；通过 list action 重新查一次，对外保持 REST 语义。
  const refreshed = await callAction<UsersBatchData>(c, listUsersAction, [{}]);
  if (!refreshed.ok) return refreshed.problem;
  const user = refreshed.data.users.find((u) => (u as { id: number }).id === parsed.id);
  if (!user) {
    return problem(c, {
      status: 404,
      errorCode: "not_found",
      title: "User not found",
      detail: `User #${parsed.id} does not exist after update.`,
    });
  }
  return respondJson(c, serializeUser(user), 200);
}

// ==================== DELETE /users/{id} ====================

export async function deleteUserHandler(c: Context): Promise<Response> {
  const parsed = parseIdParam(c);
  if (!parsed.ok) return parsed.response;
  const result = await callAction<void>(c, deleteUser, [parsed.id]);
  if (!result.ok) return result.problem;
  return respondNoContent(c);
}

// ==================== POST /users/{id}:enable ====================

export async function enableUserHandler(c: Context): Promise<Response> {
  const parsed = parseIdParam(c);
  if (!parsed.ok) return parsed.response;
  const body = await parseJsonBody<typeof UserEnableSchema>(c, UserEnableSchema);
  if (!body.ok) return body.response;
  const result = await callAction<void>(c, enableUser, [parsed.id, body.data.enabled]);
  if (!result.ok) return result.problem;
  return respondJson(c, { ok: true }, 200);
}

// ==================== POST /users/{id}:renew ====================

export async function renewUserHandler(c: Context): Promise<Response> {
  const parsed = parseIdParam(c);
  if (!parsed.ok) return parsed.response;
  const body = await parseJsonBody<typeof UserRenewSchema>(c, UserRenewSchema);
  if (!body.ok) return body.response;
  // legacy renewUser 仅接受 string；如果调用方传 null 直接报 400。
  if (body.data.expiresAt == null) {
    return problem(c, {
      status: 400,
      errorCode: "validation_failed",
      title: "Invalid expiresAt",
      detail: "expiresAt must be an ISO string for user renewal.",
    });
  }
  const result = await callAction<void>(c, renewUserActionFn, [
    parsed.id,
    {
      expiresAt: body.data.expiresAt,
      enableUser: body.data.enableUser,
    },
  ]);
  if (!result.ok) return result.problem;
  return respondJson(c, { ok: true }, 200);
}

// ==================== POST /users/{id}/limits:reset ====================

export async function resetUserLimitsHandler(c: Context): Promise<Response> {
  const parsed = parseIdParam(c);
  if (!parsed.ok) return parsed.response;
  const result = await callAction<void>(c, resetLimits, [parsed.id]);
  if (!result.ok) return result.problem;
  return respondJson(c, { ok: true }, 200);
}

// ==================== GET /users/tags ====================

export async function listUserTags(c: Context): Promise<Response> {
  const result = await callAction<string[]>(c, tagsAction, []);
  if (!result.ok) return result.problem;
  return respondJson(c, { items: result.data }, 200);
}

// ==================== GET /users/key-groups ====================

export async function listUserKeyGroups(c: Context): Promise<Response> {
  const result = await callAction<string[]>(c, groupsAction, []);
  if (!result.ok) return result.problem;
  return respondJson(c, { items: result.data }, 200);
}
