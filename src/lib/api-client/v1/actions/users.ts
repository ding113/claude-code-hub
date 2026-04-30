import type { BatchUpdateUsersParams, GetUsersBatchParams } from "@/actions/users";
import { DASHBOARD_COMPAT_HEADER } from "@/lib/api/v1/_shared/constants";
import { ApiError } from "@/lib/api-client/v1/errors";
import type { UserDisplay } from "@/types/user";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  searchParams,
  toActionResult,
  toVoidActionResult,
  unwrapItems,
} from "./_compat";

export type { BatchUpdateUsersParams, KeyUsageData } from "@/actions/users";
export type { UserDisplay } from "@/types/user";

type UsersPage = {
  users: UserDisplay[];
  nextCursor: string | null;
  hasMore: boolean;
};

type V1UsersPage = {
  items?: UserDisplay[];
  users?: UserDisplay[];
  pageInfo?: {
    nextCursor?: string | null;
    hasMore?: boolean;
  };
  nextCursor?: string | null;
  hasMore?: boolean;
};

const dashboardCompatOptions = {
  headers: {
    [DASHBOARD_COMPAT_HEADER]: "1",
  },
} as const;

export function getUsers(params?: GetUsersBatchParams): Promise<UserDisplay[]> {
  return apiGet<V1UsersPage>(`/api/v1/users${toUserListQuery(params)}`)
    .catch((error: unknown) => {
      if (isAdminForbidden(error)) {
        return apiGet<V1UsersPage>("/api/v1/users:self");
      }
      throw error;
    })
    .then((body) => normalizeUsers(body.items ?? body.users ?? []));
}

export function getUsersBatchCore(params?: GetUsersBatchParams) {
  return toActionResult(
    apiGet<V1UsersPage>(`/api/v1/users${toUserListQuery(params)}`).then(toLegacyUsersPage)
  );
}

function toLegacyUsersPage(body: V1UsersPage): UsersPage {
  return {
    users: normalizeUsers(body.users ?? body.items ?? []),
    nextCursor: body.nextCursor ?? body.pageInfo?.nextCursor ?? null,
    hasMore: body.hasMore ?? body.pageInfo?.hasMore ?? false,
  };
}

function normalizeUsers(users: UserDisplay[]): UserDisplay[] {
  return users.map((user) => {
    const normalizedUser = { ...user } as UserDisplay;
    if ("costResetAt" in normalizedUser) {
      normalizedUser.costResetAt = normalizeDate(normalizedUser.costResetAt);
    }
    if ("expiresAt" in normalizedUser) {
      normalizedUser.expiresAt = normalizeDate(normalizedUser.expiresAt);
    }
    if (Array.isArray(normalizedUser.keys)) {
      normalizedUser.keys = normalizedUser.keys.map((key) => ({
        ...key,
        createdAt: normalizeDate(key.createdAt) ?? new Date(0),
        lastUsedAt: normalizeDate(key.lastUsedAt),
      }));
    }
    return normalizedUser;
  });
}

function normalizeDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string" && typeof value !== "number") return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getUsersUsageBatch(userIds: number[]) {
  return toActionResult(apiPost("/api/v1/users:usageBatch", { userIds }));
}

export function searchUsers(query?: string, limit?: number) {
  return toActionResult(
    apiGet<{ items?: Array<{ id: number; name: string }> }>(
      `/api/v1/users:search${searchParams({ q: query, limit })}`,
      dashboardCompatOptions
    ).then((body) => unwrapItems(body))
  );
}

export function searchUsersForFilter(query?: string, limit?: number) {
  return toActionResult(
    apiGet<{ items?: Array<{ id: number; name: string }> }>(
      `/api/v1/users:filter-search${searchParams({ q: query, limit })}`,
      dashboardCompatOptions
    ).then((body) => unwrapItems(body))
  );
}

export function getAllUserTags() {
  return toActionResult(
    apiGet<{ items: string[] }>("/api/v1/users/tags").then((body) => body.items)
  );
}

export function getAllUserKeyGroups() {
  return toActionResult(
    apiGet<{ items: string[] }>("/api/v1/users/key-groups").then((body) => body.items)
  );
}

export function addUser(data: unknown) {
  return toActionResult(apiPost("/api/v1/users", data));
}

export function createUserOnly(data: unknown) {
  return toActionResult(apiPost("/api/v1/users?withDefaultKey=false", data));
}

export function editUser(userId: number, data: unknown) {
  return toActionResult(apiPatch(`/api/v1/users/${userId}`, data));
}

export function removeUser(userId: number) {
  return toVoidActionResult(apiDelete(`/api/v1/users/${userId}`));
}

export function renewUser(userId: number, data: unknown) {
  return toActionResult(apiPost(`/api/v1/users/${userId}:renew`, data));
}

export function toggleUserEnabled(userId: number, enabled: boolean) {
  return toActionResult(apiPost(`/api/v1/users/${userId}:enable`, { enabled }));
}

export function getUserLimitUsage(userId: number) {
  return toActionResult(apiGet(`/api/v1/users/${userId}/limit-usage`));
}

export function getUserAllLimitUsage(userId: number) {
  return toActionResult(apiGet(`/api/v1/users/${userId}/limit-usage:all`));
}

export function resetUserLimitsOnly(userId: number) {
  return toVoidActionResult(apiPost(`/api/v1/users/${userId}/limits:reset`));
}

export function resetUserAllStatistics(userId: number) {
  return toVoidActionResult(apiPost(`/api/v1/users/${userId}/statistics:reset`));
}

export function batchUpdateUsers(data: BatchUpdateUsersParams) {
  return toActionResult(apiPost("/api/v1/users:batchUpdate", data));
}

function toUserListQuery(params?: GetUsersBatchParams): string {
  return searchParams({
    cursor: params?.cursor,
    limit: params?.limit,
    q: params?.searchTerm,
    tags: params?.tagFilters?.join(","),
    keyGroups: params?.keyGroupFilters?.join(","),
    status: params?.statusFilter,
    sortBy: params?.sortBy,
    sortOrder: params?.sortOrder,
  });
}

function isAdminForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.errorCode === "auth.forbidden";
}
