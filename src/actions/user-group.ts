"use server";

import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { ERROR_CODES } from "@/lib/utils/error-messages";
import type { UserGroupRow } from "@/repository/user-group";
import {
  countUsersInUserGroup,
  getUserGroupByTag,
  createUserGroup as repoCreateUserGroup,
  deleteUserGroup as repoDeleteUserGroup,
  getUserGroup as repoGetUserGroup,
  listUserGroups as repoListUserGroups,
  updateUserGroup as repoUpdateUserGroup,
} from "@/repository/user-group";
import type { ActionResult } from "./types";

export type UserGroupWithCount = UserGroupRow & { memberCount: number };

export type UserGroupCreateInput = {
  tag: string;
  name?: string | null;
  description?: string | null;
};

export type UserGroupUpdateInput = {
  name?: string | null;
  description?: string | null;
};

async function requireAdmin() {
  const session = await getSession();
  return session?.user.role === "admin" ? session : null;
}

export async function listUserGroups(): Promise<ActionResult<UserGroupWithCount[]>> {
  const tError = await getTranslations("errors");
  try {
    const session = await requireAdmin();
    if (!session) {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const groups = await repoListUserGroups();
    const data: UserGroupWithCount[] = await Promise.all(
      groups.map(async (g) => ({
        ...g,
        memberCount: await countUsersInUserGroup(g.tag),
      }))
    );
    return { ok: true, data };
  } catch (error) {
    logger.error("Failed to list user groups:", error);
    return {
      ok: false,
      error: tError("OPERATION_FAILED"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

export async function getUserGroup(id: number): Promise<ActionResult<UserGroupWithCount>> {
  const tError = await getTranslations("errors");
  try {
    const session = await requireAdmin();
    if (!session) {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const group = await repoGetUserGroup(id);
    if (!group) {
      return { ok: false, error: tError("NOT_FOUND"), errorCode: ERROR_CODES.NOT_FOUND };
    }

    const memberCount = await countUsersInUserGroup(group.tag);
    return { ok: true, data: { ...group, memberCount } };
  } catch (error) {
    logger.error("Failed to get user group:", error);
    return {
      ok: false,
      error: tError("OPERATION_FAILED"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

export async function createUserGroup(
  input: UserGroupCreateInput
): Promise<ActionResult<UserGroupRow>> {
  const t = await getTranslations("quota.userGroups");
  const tError = await getTranslations("errors");
  try {
    const session = await requireAdmin();
    if (!session) {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const tag = input.tag?.trim();
    if (!tag) {
      return { ok: false, error: t("tagRequired"), errorCode: "TAG_REQUIRED" };
    }

    const existing = await getUserGroupByTag(tag);
    if (existing) {
      return { ok: false, error: t("duplicateTag"), errorCode: "DUPLICATE_TAG" };
    }

    const group = await repoCreateUserGroup({
      tag,
      name: input.name,
      description: input.description,
    });
    return { ok: true, data: group };
  } catch (error) {
    logger.error("Failed to create user group:", error);
    return { ok: false, error: tError("CREATE_FAILED"), errorCode: ERROR_CODES.CREATE_FAILED };
  }
}

export async function updateUserGroup(
  id: number,
  input: UserGroupUpdateInput
): Promise<ActionResult<UserGroupRow>> {
  const tError = await getTranslations("errors");
  try {
    const session = await requireAdmin();
    if (!session) {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const existing = await repoGetUserGroup(id);
    if (!existing) {
      return { ok: false, error: tError("NOT_FOUND"), errorCode: ERROR_CODES.NOT_FOUND };
    }

    const updated = await repoUpdateUserGroup(id, {
      name: input.name,
      description: input.description,
    });
    return { ok: true, data: updated };
  } catch (error) {
    logger.error("Failed to update user group:", error);
    return { ok: false, error: tError("UPDATE_FAILED"), errorCode: ERROR_CODES.UPDATE_FAILED };
  }
}

export async function deleteUserGroup(id: number): Promise<ActionResult<void>> {
  const tError = await getTranslations("errors");
  try {
    const session = await requireAdmin();
    if (!session) {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const existing = await repoGetUserGroup(id);
    if (!existing) {
      return { ok: false, error: tError("NOT_FOUND"), errorCode: ERROR_CODES.NOT_FOUND };
    }

    await repoDeleteUserGroup(id);
    return { ok: true, data: undefined };
  } catch (error) {
    logger.error("Failed to delete user group:", error);
    return { ok: false, error: tError("DELETE_FAILED"), errorCode: ERROR_CODES.DELETE_FAILED };
  }
}
