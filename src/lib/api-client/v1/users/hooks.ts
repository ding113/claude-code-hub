"use client";

/**
 * /api/v1/users TanStack Query hooks
 */

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type {
  UserCreateInput,
  UserCreateResponse,
  UserEnableInput,
  UserKeyGroupsResponse,
  UserListResponse,
  UserRenewInput,
  UserResponse,
  UserTagsResponse,
  UserUpdateInput,
} from "@/lib/api/v1/schemas/users";
import type { ApiError } from "@/lib/api-client/v1/client";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

import { usersClient } from "./index";
import { usersKeys } from "./keys";

// ==================== 查询 ====================

export function useUsersList(
  params?: Record<string, string | number | undefined>
): UseQueryResult<UserListResponse, ApiError | Error> {
  return useQuery<UserListResponse, ApiError | Error>({
    queryKey: usersKeys.list(params),
    queryFn: () => usersClient.list(params),
  });
}

export function useUserDetail(id: number): UseQueryResult<UserResponse, ApiError | Error> {
  return useQuery<UserResponse, ApiError | Error>({
    queryKey: usersKeys.detail(id),
    queryFn: () => usersClient.detail(id),
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useUserTags(): UseQueryResult<UserTagsResponse, ApiError | Error> {
  return useQuery<UserTagsResponse, ApiError | Error>({
    queryKey: usersKeys.tags(),
    queryFn: () => usersClient.tags(),
  });
}

export function useUserKeyGroups(): UseQueryResult<UserKeyGroupsResponse, ApiError | Error> {
  return useQuery<UserKeyGroupsResponse, ApiError | Error>({
    queryKey: usersKeys.keyGroups(),
    queryFn: () => usersClient.keyGroups(),
  });
}

// ==================== 变更 ====================

export function useCreateUser() {
  return useApiMutation<UserCreateInput, UserCreateResponse>({
    mutationFn: (input) => usersClient.create(input),
    invalidates: [usersKeys.all],
  });
}

export function useUpdateUser(id: number) {
  return useApiMutation<UserUpdateInput, UserResponse>({
    mutationFn: (patch) => usersClient.update(id, patch),
    invalidates: [usersKeys.all],
  });
}

export function useDeleteUser(id: number) {
  return useApiMutation<void, void>({
    mutationFn: () => usersClient.remove(id),
    invalidates: [usersKeys.all],
  });
}

export function useEnableUser(id: number) {
  return useApiMutation<UserEnableInput, { ok: boolean }>({
    mutationFn: (body) => usersClient.enable(id, body),
    invalidates: [usersKeys.all],
  });
}

export function useRenewUser(id: number) {
  return useApiMutation<UserRenewInput, { ok: boolean }>({
    mutationFn: (body) => usersClient.renew(id, body),
    invalidates: [usersKeys.all],
  });
}

export function useResetUserLimits(id: number) {
  return useApiMutation<void, { ok: boolean }>({
    mutationFn: () => usersClient.resetLimits(id),
    invalidates: [usersKeys.all],
  });
}

/**
 * Reset ALL user statistics (delete logs + Redis cache + sessions). IRREVERSIBLE.
 * Wraps POST /api/v1/users/{id}/statistics:reset.
 */
export function useResetUserAllStatistics(id: number) {
  return useApiMutation<void, { ok: boolean }>({
    mutationFn: () => usersClient.resetAllStatistics(id),
    invalidates: [usersKeys.all],
  });
}

/** Create a user without issuing a default key (POST /api/v1/users?withDefaultKey=false). */
export function useCreateUserOnly() {
  return useApiMutation<UserCreateInput, { user: UserCreateResponse["user"] }>({
    mutationFn: (input) => usersClient.createOnly(input),
    invalidates: [usersKeys.all],
  });
}

/** GET /api/v1/providers/groups?userId=... — only groups accessible to the user. */
export function useUserProviderGroupsForFilter(
  userId: number
): UseQueryResult<{ items: string[] }, ApiError | Error> {
  return useQuery<{ items: string[] }, ApiError | Error>({
    queryKey: [...usersKeys.all, "available-provider-groups", userId] as const,
    queryFn: () => usersClient.availableProviderGroups(userId),
    enabled: Number.isInteger(userId) && userId > 0,
  });
}
