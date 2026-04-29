/**
 * /api/v1/users 类型化客户端方法
 */

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
import { apiClient, fetchApi } from "@/lib/api-client/v1/client";

const BASE_PATH = "/api/v1/users";

export interface UsersClient {
  list(params?: Record<string, string | number | undefined>): Promise<UserListResponse>;
  detail(id: number): Promise<UserResponse>;
  create(input: UserCreateInput): Promise<UserCreateResponse>;
  update(id: number, patch: UserUpdateInput): Promise<UserResponse>;
  remove(id: number): Promise<void>;
  enable(id: number, body: UserEnableInput): Promise<{ ok: boolean }>;
  renew(id: number, body: UserRenewInput): Promise<{ ok: boolean }>;
  resetLimits(id: number): Promise<{ ok: boolean }>;
  tags(): Promise<UserTagsResponse>;
  keyGroups(): Promise<UserKeyGroupsResponse>;
}

function buildQuery(params?: Record<string, string | number | undefined>): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    search.append(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

async function list(
  params?: Record<string, string | number | undefined>
): Promise<UserListResponse> {
  const response = await fetchApi(`${BASE_PATH}${buildQuery(params)}`, { method: "GET" });
  return (await response.json()) as UserListResponse;
}

async function detail(id: number): Promise<UserResponse> {
  const response = await fetchApi(`${BASE_PATH}/${id}`, { method: "GET" });
  return (await response.json()) as UserResponse;
}

async function create(input: UserCreateInput): Promise<UserCreateResponse> {
  const response = await fetchApi(BASE_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await response.json()) as UserCreateResponse;
}

async function update(id: number, patch: UserUpdateInput): Promise<UserResponse> {
  const response = await fetchApi(`${BASE_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return (await response.json()) as UserResponse;
}

async function remove(id: number): Promise<void> {
  await fetchApi(`${BASE_PATH}/${id}`, { method: "DELETE" });
}

async function enable(id: number, body: UserEnableInput): Promise<{ ok: boolean }> {
  const response = await fetchApi(`${BASE_PATH}/${id}:enable`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as { ok: boolean };
}

async function renew(id: number, body: UserRenewInput): Promise<{ ok: boolean }> {
  const response = await fetchApi(`${BASE_PATH}/${id}:renew`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as { ok: boolean };
}

async function resetLimits(id: number): Promise<{ ok: boolean }> {
  const response = await fetchApi(`${BASE_PATH}/${id}/limits:reset`, { method: "POST" });
  return (await response.json()) as { ok: boolean };
}

async function tags(): Promise<UserTagsResponse> {
  const response = await fetchApi(`${BASE_PATH}/tags`, { method: "GET" });
  return (await response.json()) as UserTagsResponse;
}

async function keyGroups(): Promise<UserKeyGroupsResponse> {
  const response = await fetchApi(`${BASE_PATH}/key-groups`, { method: "GET" });
  return (await response.json()) as UserKeyGroupsResponse;
}

export const usersClient: UsersClient = {
  list,
  detail,
  create,
  update,
  remove,
  enable,
  renew,
  resetLimits,
  tags,
  keyGroups,
};

Object.assign(apiClient, { users: usersClient });
