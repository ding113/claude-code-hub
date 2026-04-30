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
  createUserOnly as createUserOnlyAction,
  editUser as editUserAction,
  type GetUsersBatchParams,
  getAllUserKeyGroups as getAllUserKeyGroupsAction,
  getAllUserTags as getAllUserTagsAction,
  getUsersBatch as getUsersBatchAction,
  removeUser as removeUserAction,
  renewUser as renewUserAction,
  resetUserAllStatistics as resetUserAllStatisticsAction,
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
const createUserOnlyFn = createUserOnlyAction as unknown as AnyAction;
const resetUserAllStatisticsFn = resetUserAllStatisticsAction as unknown as AnyAction;

const RESOURCE_BASE_PATH = "/api/v1/users";

/** 解析 path 参数；支持 :id / :idEnable / :idRenew / :idLimitsReset / :idStatsReset 多种格式。 */
function parseIdParam(c: Context): { ok: true; id: number } | { ok: false; response: Response } {
  const candidates = [
    c.req.param("id"),
    c.req.param("idEnable"),
    c.req.param("idRenew"),
    c.req.param("idLimitsReset"),
    c.req.param("idStatsReset"),
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

/**
 * `GetUsersBatchParams.sortBy` / `sortOrder` / `statusFilter` 的合法字面量集合。
 *
 * 之前直接把 query 字符串透传到 action（`as` 断言），而 action 内部把 sortBy
 * 作为 sort-column map 的键使用：未知值会得到 undefined，进而抛运行时错误并
 * 在 v1 表层显现为 500，而不是规范的 400 校验失败。这里通过白名单校验把
 * 非法值降级为「不传」，与 legacy 默认行为对齐。
 */
const ALLOWED_SORT_BY = new Set<NonNullable<GetUsersBatchParams["sortBy"]>>([
  "name",
  "tags",
  "expiresAt",
  "rpm",
  "limit5hUsd",
  "limitDailyUsd",
  "limitWeeklyUsd",
  "limitMonthlyUsd",
  "createdAt",
]);

const ALLOWED_SORT_ORDER = new Set<NonNullable<GetUsersBatchParams["sortOrder"]>>(["asc", "desc"]);

const ALLOWED_STATUS_FILTER = new Set<NonNullable<GetUsersBatchParams["statusFilter"]>>([
  "all",
  "active",
  "expired",
  "expiringSoon",
  "enabled",
  "disabled",
]);

function pickAllowed<V extends string>(value: string, set: Set<V>): V | undefined {
  return (set as Set<string>).has(value) ? (value as V) : undefined;
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
  if (q.statusFilter) {
    const v = pickAllowed(q.statusFilter, ALLOWED_STATUS_FILTER);
    if (v !== undefined) params.statusFilter = v;
  }
  if (q.sortBy) {
    const v = pickAllowed(q.sortBy, ALLOWED_SORT_BY);
    if (v !== undefined) params.sortBy = v;
  }
  if (q.sortOrder) {
    const v = pickAllowed(q.sortOrder, ALLOWED_SORT_ORDER);
    if (v !== undefined) params.sortOrder = v;
  }
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

/**
 * legacy `getUsersBatch` 默认页大小为 50；对于安装了 >50 用户的实例，仅查首屏会
 * 让真实存在的用户被误判为 404。这里通过遍历 cursor 把所有页扫一遍，命中即返回。
 *
 * 该路径只在 admin 调用 `/users/{id}` 时触发，单次最多遍历 N/USER_LIST_MAX_LIMIT 页，
 * 与 legacy 的 admin 看板一致；后续若 legacy action 暴露 `ids` 过滤再切换。
 */
async function findUserByIdAcrossPages(
  c: Context,
  id: number
): Promise<{ ok: true; user: Record<string, unknown> | null } | { ok: false; response: Response }> {
  let cursor: string | undefined;
  // 上限避免恶意 cursor 死循环（legacy action 自身也有 hasMore 终止条件）
  for (let i = 0; i < 1000; i++) {
    const result = await callAction<UsersBatchData>(c, listUsersAction, [{ cursor, limit: 200 }]);
    if (!result.ok) return { ok: false, response: result.problem };
    const found = result.data.users.find((u) => (u as { id: number }).id === id);
    if (found) return { ok: true, user: found };
    if (!result.data.hasMore || !result.data.nextCursor) {
      return { ok: true, user: null };
    }
    cursor = result.data.nextCursor;
  }
  return { ok: true, user: null };
}

export async function getUser(c: Context): Promise<Response> {
  const parsed = parseIdParam(c);
  if (!parsed.ok) return parsed.response;
  const lookup = await findUserByIdAcrossPages(c, parsed.id);
  if (!lookup.ok) return lookup.response;
  if (!lookup.user) {
    return problem(c, {
      status: 404,
      errorCode: "not_found",
      title: "User not found",
      detail: `User #${parsed.id} does not exist.`,
    });
  }
  return respondJson(c, serializeUser(lookup.user), 200);
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

interface CreateUserOnlySuccess {
  user: Record<string, unknown> & {
    id: number;
    name: string;
    role: string;
    isEnabled: boolean;
    expiresAt: Date | null;
  };
}

function serializeUserCreatePayload(
  u: Record<string, unknown> & {
    id: number;
    name: string;
    role: string;
    isEnabled: boolean;
    expiresAt: Date | null;
  }
): Record<string, unknown> {
  return {
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
  };
}

export async function createUserHandler(c: Context): Promise<Response> {
  const body = await parseJsonBody<typeof UserCreateSchema>(c, UserCreateSchema);
  if (!body.ok) return body.response;

  // ?withDefaultKey=false routes to legacy createUserOnly (no default key).
  const withDefaultKey = c.req.query("withDefaultKey");
  if (withDefaultKey === "false") {
    const result = await callAction<CreateUserOnlySuccess>(c, createUserOnlyFn, [body.data]);
    if (!result.ok) return result.problem;
    const responseBody = {
      user: serializeUserCreatePayload(result.data.user),
    };
    return respondCreated(c, responseBody, `${RESOURCE_BASE_PATH}/${result.data.user.id}`);
  }

  const result = await callAction<AddUserSuccess>(c, createUser, [body.data]);
  if (!result.ok) return result.problem;

  const u = result.data.user;
  const responseBody = {
    user: serializeUserCreatePayload(u),
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

  // editUser 不返回更新后的对象；通过 list action 重新查一次（跨页遍历，避免
  // user 不在首屏时返回 404），对外保持 REST 语义。
  const lookup = await findUserByIdAcrossPages(c, parsed.id);
  if (!lookup.ok) return lookup.response;
  if (!lookup.user) {
    return problem(c, {
      status: 404,
      errorCode: "not_found",
      title: "User not found",
      detail: `User #${parsed.id} does not exist after update.`,
    });
  }
  return respondJson(c, serializeUser(lookup.user), 200);
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

// ==================== POST /users/{id}/statistics:reset ====================

/**
 * Reset ALL user statistics (logs + Redis cache + sessions). IRREVERSIBLE.
 * Wraps legacy `resetUserAllStatistics`.
 */
export async function resetUserAllStatisticsHandler(c: Context): Promise<Response> {
  const parsed = parseIdParam(c);
  if (!parsed.ok) return parsed.response;
  const result = await callAction<void>(c, resetUserAllStatisticsFn, [parsed.id]);
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
