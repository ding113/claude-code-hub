/**
 * /api/v1/keys 类型化客户端方法
 */

import type {
  KeyCreatedResponse,
  KeyCreateInput,
  KeyEnableInput,
  KeyLimitUsageResponse,
  KeyListResponse,
  KeyRenewInput,
  KeyUpdateInput,
} from "@/lib/api/v1/schemas/keys";
import { apiClient, fetchApi } from "@/lib/api-client/v1/client";

const KEYS_BASE_PATH = "/api/v1/keys";
const USERS_BASE_PATH = "/api/v1/users";

export interface KeysClient {
  listForUser(userId: number, options?: { includeStatistics?: boolean }): Promise<KeyListResponse>;
  create(userId: number, input: KeyCreateInput): Promise<KeyCreatedResponse>;
  update(id: number, patch: KeyUpdateInput): Promise<{ ok: boolean; id: number }>;
  remove(id: number): Promise<void>;
  enable(id: number, body: KeyEnableInput): Promise<{ ok: boolean }>;
  renew(id: number, body: KeyRenewInput): Promise<{ ok: boolean }>;
  resetLimits(id: number): Promise<{ ok: boolean }>;
  limitUsage(id: number): Promise<KeyLimitUsageResponse>;
}

async function listForUser(
  userId: number,
  options?: { includeStatistics?: boolean }
): Promise<KeyListResponse> {
  const qs = options?.includeStatistics ? "?include=statistics" : "";
  const response = await fetchApi(`${USERS_BASE_PATH}/${userId}/keys${qs}`, { method: "GET" });
  return (await response.json()) as KeyListResponse;
}

async function create(userId: number, input: KeyCreateInput): Promise<KeyCreatedResponse> {
  const response = await fetchApi(`${USERS_BASE_PATH}/${userId}/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await response.json()) as KeyCreatedResponse;
}

async function update(id: number, patch: KeyUpdateInput): Promise<{ ok: boolean; id: number }> {
  const response = await fetchApi(`${KEYS_BASE_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return (await response.json()) as { ok: boolean; id: number };
}

async function remove(id: number): Promise<void> {
  await fetchApi(`${KEYS_BASE_PATH}/${id}`, { method: "DELETE" });
}

async function enable(id: number, body: KeyEnableInput): Promise<{ ok: boolean }> {
  const response = await fetchApi(`${KEYS_BASE_PATH}/${id}:enable`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as { ok: boolean };
}

async function renew(id: number, body: KeyRenewInput): Promise<{ ok: boolean }> {
  const response = await fetchApi(`${KEYS_BASE_PATH}/${id}:renew`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as { ok: boolean };
}

async function resetLimits(id: number): Promise<{ ok: boolean }> {
  const response = await fetchApi(`${KEYS_BASE_PATH}/${id}/limits:reset`, { method: "POST" });
  return (await response.json()) as { ok: boolean };
}

async function limitUsage(id: number): Promise<KeyLimitUsageResponse> {
  const response = await fetchApi(`${KEYS_BASE_PATH}/${id}/limit-usage`, { method: "GET" });
  return (await response.json()) as KeyLimitUsageResponse;
}

export const keysClient: KeysClient = {
  listForUser,
  create,
  update,
  remove,
  enable,
  renew,
  resetLimits,
  limitUsage,
};

Object.assign(apiClient, { keys: keysClient });
