import type {
  UserGroupCreateInput,
  UserGroupResponse,
  UserGroupUpdateInput,
} from "@/lib/api/v1/schemas/user-groups";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  toActionResult,
  toVoidActionResult,
  unwrapItems,
} from "./_compat";

export type {
  UserGroupCreateInput,
  UserGroupResponse,
  UserGroupUpdateInput,
} from "@/lib/api/v1/schemas/user-groups";

export type UserGroupWithCount = UserGroupResponse & { memberCount: number };

export function listUserGroups() {
  return toActionResult(
    apiGet<{ items?: UserGroupResponse[] }>("/api/v1/user-groups").then(unwrapItems)
  );
}

export function createUserGroup(body: UserGroupCreateInput) {
  return toActionResult(apiPost<UserGroupResponse>("/api/v1/user-groups", body));
}

export function updateUserGroup(id: number, body: UserGroupUpdateInput) {
  return toActionResult(apiPatch<UserGroupResponse>(`/api/v1/user-groups/${id}`, body));
}

export function deleteUserGroup(id: number) {
  return toVoidActionResult(apiDelete(`/api/v1/user-groups/${id}`));
}
