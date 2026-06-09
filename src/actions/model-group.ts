"use server";

import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { ERROR_CODES } from "@/lib/utils/error-messages";
import type { ModelGroupRow, ModelGroupWithMembers } from "@/repository/model-group";
import {
  findModelGroupIdByModel,
  getModelGroup,
  listModelGroupMembers,
  ModelGroupMemberConflictError,
  addModelGroupMember as repoAddModelGroupMember,
  createModelGroup as repoCreateModelGroup,
  createSingletonModelGroup as repoCreateSingletonModelGroup,
  deleteModelGroup as repoDeleteModelGroup,
  listModelGroups as repoListModelGroups,
  removeModelGroupMember as repoRemoveModelGroupMember,
  updateModelGroup as repoUpdateModelGroup,
} from "@/repository/model-group";
import type { ActionResult } from "./types";

// ---------------------------------------------------------------------------
// Admin guard
// ---------------------------------------------------------------------------

async function requireAdmin(): Promise<
  { ok: true } | { ok: false; error: string; errorCode: string }
> {
  const tError = await getTranslations("errors");
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listModelGroups(): Promise<ActionResult<ModelGroupWithMembers[]>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  try {
    const data = await repoListModelGroups();
    return { ok: true, data };
  } catch (error) {
    logger.error("listModelGroups failed", { error });
    const tError = await getTranslations("errors");
    return {
      ok: false,
      error: tError("OPERATION_FAILED"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

// ---------------------------------------------------------------------------
// Get single
// ---------------------------------------------------------------------------

export async function getModelGroupById(id: number): Promise<ActionResult<ModelGroupWithMembers>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  try {
    const tError = await getTranslations("errors");
    const data = await getModelGroup(id);
    if (!data) return { ok: false, error: tError("NOT_FOUND"), errorCode: ERROR_CODES.NOT_FOUND };
    return { ok: true, data };
  } catch (error) {
    logger.error("getModelGroupById failed", { id, error });
    const tError = await getTranslations("errors");
    return {
      ok: false,
      error: tError("OPERATION_FAILED"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createModelGroup(input: {
  name: string;
  description?: string | null;
  isSingleton?: boolean;
}): Promise<ActionResult<ModelGroupRow>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const t = await getTranslations("quota.modelGroups");
  const tError = await getTranslations("errors");

  try {
    const name = input.name?.trim();
    if (!name) {
      return { ok: false, error: t("nameRequired"), errorCode: "NAME_REQUIRED" };
    }

    const data = await repoCreateModelGroup({
      name,
      description: input.description ?? null,
      isSingleton: input.isSingleton ?? false,
    });
    return { ok: true, data };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("unique") || msg.includes("duplicate") || msg.includes("model_groups_name")) {
      return { ok: false, error: t("duplicateName"), errorCode: "DUPLICATE_NAME" };
    }
    logger.error("createModelGroup failed", { input, error });
    return { ok: false, error: tError("CREATE_FAILED"), errorCode: ERROR_CODES.CREATE_FAILED };
  }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateModelGroup(
  id: number,
  input: Partial<{ name: string; description: string | null; isSingleton: boolean }>
): Promise<ActionResult<ModelGroupRow>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const t = await getTranslations("quota.modelGroups");
  const tError = await getTranslations("errors");

  try {
    if (input.name !== undefined && !input.name.trim()) {
      return { ok: false, error: t("nameRequired"), errorCode: "NAME_REQUIRED" };
    }

    const data = await repoUpdateModelGroup(id, input);
    return { ok: true, data };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("not found")) {
      return { ok: false, error: tError("NOT_FOUND"), errorCode: ERROR_CODES.NOT_FOUND };
    }
    if (msg.includes("unique") || msg.includes("model_groups_name")) {
      return { ok: false, error: t("duplicateName"), errorCode: "DUPLICATE_NAME" };
    }
    logger.error("updateModelGroup failed", { id, input, error });
    return { ok: false, error: tError("UPDATE_FAILED"), errorCode: ERROR_CODES.UPDATE_FAILED };
  }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteModelGroup(id: number): Promise<ActionResult<void>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const tError = await getTranslations("errors");

  try {
    const existing = await getModelGroup(id);
    if (!existing) {
      return { ok: false, error: tError("NOT_FOUND"), errorCode: ERROR_CODES.NOT_FOUND };
    }

    await repoDeleteModelGroup(id);
    return { ok: true, data: undefined };
  } catch (error) {
    logger.error("deleteModelGroup failed", { id, error });
    return { ok: false, error: tError("DELETE_FAILED"), errorCode: ERROR_CODES.DELETE_FAILED };
  }
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function addModelGroupMember(
  groupId: number,
  model: string
): Promise<ActionResult<void>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const t = await getTranslations("quota.modelGroups");
  const tError = await getTranslations("errors");

  try {
    const trimmedModel = model?.trim();
    if (!trimmedModel) {
      return { ok: false, error: t("modelRequired"), errorCode: "MODEL_REQUIRED" };
    }

    await repoAddModelGroupMember(groupId, trimmedModel);
    return { ok: true, data: undefined };
  } catch (error) {
    if (error instanceof ModelGroupMemberConflictError) {
      return {
        ok: false,
        error: t("memberConflict", {
          model,
          groupName: error.conflictGroupName,
          groupId: error.conflictGroupId,
        }),
        errorCode: "MEMBER_CONFLICT",
        errorParams: {
          model,
          groupName: error.conflictGroupName,
          groupId: error.conflictGroupId,
        },
      };
    }
    logger.error("addModelGroupMember failed", { groupId, model, error });
    return {
      ok: false,
      error: tError("OPERATION_FAILED"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

export async function removeModelGroupMember(
  groupId: number,
  model: string
): Promise<ActionResult<void>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const tError = await getTranslations("errors");

  try {
    await repoRemoveModelGroupMember(groupId, model);
    return { ok: true, data: undefined };
  } catch (error) {
    logger.error("removeModelGroupMember failed", { groupId, model, error });
    return {
      ok: false,
      error: tError("OPERATION_FAILED"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

export async function getModelGroupMembers(groupId: number): Promise<ActionResult<string[]>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  try {
    const data = await listModelGroupMembers(groupId);
    return { ok: true, data };
  } catch (error) {
    logger.error("getModelGroupMembers failed", { groupId, error });
    const tError = await getTranslations("errors");
    return {
      ok: false,
      error: tError("OPERATION_FAILED"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

export async function lookupModelGroupByModel(model: string): Promise<ActionResult<number | null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  try {
    const data = await findModelGroupIdByModel(model);
    return { ok: true, data };
  } catch (error) {
    logger.error("lookupModelGroupByModel failed", { model, error });
    const tError = await getTranslations("errors");
    return {
      ok: false,
      error: tError("OPERATION_FAILED"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton convenience
// ---------------------------------------------------------------------------

export async function createSingletonModelGroup(
  model: string,
  name?: string
): Promise<ActionResult<ModelGroupRow>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const t = await getTranslations("quota.modelGroups");
  const tError = await getTranslations("errors");

  try {
    const trimmedModel = model?.trim();
    if (!trimmedModel) {
      return { ok: false, error: t("modelRequired"), errorCode: "MODEL_REQUIRED" };
    }

    const data = await repoCreateSingletonModelGroup(trimmedModel, name?.trim());
    return { ok: true, data };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("unique") || msg.includes("model_groups_name")) {
      return { ok: false, error: t("duplicateName"), errorCode: "DUPLICATE_NAME" };
    }
    if (error instanceof ModelGroupMemberConflictError) {
      return {
        ok: false,
        error: t("memberConflict", {
          model,
          groupName: error.conflictGroupName,
          groupId: error.conflictGroupId,
        }),
        errorCode: "MEMBER_CONFLICT",
      };
    }
    logger.error("createSingletonModelGroup failed", { model, name, error });
    return { ok: false, error: tError("CREATE_FAILED"), errorCode: ERROR_CODES.CREATE_FAILED };
  }
}
