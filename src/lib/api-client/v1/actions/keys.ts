import type { BatchUpdateKeysParams, PatchKeyLimitField } from "@/actions/keys";
import { isAdminForbidden } from "@/lib/api-client/v1/errors";
import type { Key } from "@/types/key";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  toActionResult,
  toVoidActionResult,
  unwrapItems,
} from "./_compat";

export type { BatchUpdateKeysParams, PatchKeyLimitField } from "@/actions/keys";
export type { Key } from "@/types/key";

export function addKey(data: { userId: number } & Record<string, unknown>) {
  const { userId, ...body } = data;
  // NOTE(#1259): the per-user route is admin-only. Non-admin self-service runs
  // into auth.forbidden there, so retry via the read-tier self endpoint, which
  // derives the target user from the session (mirrors getUsers()'s fallback).
  return toActionResult(
    apiPost(`/api/v1/users/${userId}/keys`, body).catch((error: unknown) => {
      if (isAdminForbidden(error)) {
        return apiPost("/api/v1/users:self/keys", body);
      }
      throw error;
    })
  );
}

export function editKey(keyId: number, data: unknown) {
  return toActionResult(apiPatch(`/api/v1/keys/${keyId}`, data));
}

export function removeKey(keyId: number) {
  return toVoidActionResult(apiDelete(`/api/v1/keys/${keyId}`));
}

export function getKeys(userId: number) {
  return toActionResult(
    apiGet<{ items?: Key[] }>(`/api/v1/users/${userId}/keys`).then(unwrapItems)
  );
}

export function getKeysWithStatistics(userId: number) {
  return toActionResult(
    apiGet<{ items?: Key[] }>(`/api/v1/users/${userId}/keys?include=statistics`).then(unwrapItems)
  );
}

export function getKeyLimitUsage(keyId: number) {
  return toActionResult(apiGet(`/api/v1/keys/${keyId}/limit-usage`));
}

export function resetKeyLimitsOnly(keyId: number) {
  return toVoidActionResult(apiPost(`/api/v1/keys/${keyId}/limits:reset`));
}

export function toggleKeyEnabled(keyId: number, enabled: boolean) {
  return toActionResult(apiPost(`/api/v1/keys/${keyId}:enable`, { enabled }));
}

export function batchUpdateKeys(data: BatchUpdateKeysParams) {
  return toActionResult(apiPost("/api/v1/keys:batchUpdate", data));
}

export function renewKeyExpiresAt(keyId: number, data: unknown) {
  return toActionResult(apiPost(`/api/v1/keys/${keyId}:renew`, data));
}

export function patchKeyLimit(keyId: number, field: PatchKeyLimitField, value: unknown) {
  return toActionResult(apiPatch(`/api/v1/keys/${keyId}/limits/${field}`, { value }));
}

export function getUnmaskedKey(keyId: number) {
  return toActionResult(apiGet<{ key: string }>(`/api/v1/keys/${keyId}:reveal`));
}
