"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { publishModelLimitCacheInvalidation } from "@/lib/model-rate-limit/cache";
import { ERROR_CODES } from "@/lib/utils/error-messages";
import {
  deleteModelGroupLimit,
  type LimitSubjectType,
  listModelGroupLimits,
  type ModelGroupLimitInput,
  type ModelGroupLimitRecord,
  upsertModelGroupLimit,
} from "@/repository/model-group-limit";
import type { ActionResult } from "./types";

const SETTINGS_PATH = "/dashboard/quotas/model-limits";

function isAdmin(session: Awaited<ReturnType<typeof getSession>>): boolean {
  return !!session && session.user.role === "admin";
}

export async function listModelGroupLimitsAction(filter: {
  subjectType?: LimitSubjectType;
  subjectId?: number;
  modelGroupId?: number;
}): Promise<ActionResult<ModelGroupLimitRecord[]>> {
  const session = await getSession();
  if (!isAdmin(session)) {
    return { ok: false, error: "权限不足", errorCode: ERROR_CODES.UNAUTHORIZED };
  }

  try {
    return { ok: true, data: await listModelGroupLimits(filter) };
  } catch (error) {
    logger.error("[ModelLimitAction] Failed to list model group limits", { error, filter });
    return { ok: false, error: "获取按模型限额失败", errorCode: ERROR_CODES.OPERATION_FAILED };
  }
}

export async function upsertModelGroupLimitAction(
  subjectType: LimitSubjectType,
  subjectId: number,
  modelGroupId: number,
  input: ModelGroupLimitInput
): Promise<ActionResult<ModelGroupLimitRecord>> {
  const session = await getSession();
  if (!isAdmin(session)) {
    return { ok: false, error: "权限不足", errorCode: ERROR_CODES.UNAUTHORIZED };
  }

  try {
    const data = await upsertModelGroupLimit(subjectType, subjectId, modelGroupId, input);
    await publishModelLimitCacheInvalidation();
    revalidatePath(SETTINGS_PATH);
    return { ok: true, data };
  } catch (error) {
    logger.error("[ModelLimitAction] Failed to upsert model group limit", {
      error,
      subjectType,
      subjectId,
      modelGroupId,
    });
    return { ok: false, error: "保存按模型限额失败", errorCode: ERROR_CODES.OPERATION_FAILED };
  }
}

export async function deleteModelGroupLimitAction(id: number): Promise<ActionResult> {
  const session = await getSession();
  if (!isAdmin(session)) {
    return { ok: false, error: "权限不足", errorCode: ERROR_CODES.UNAUTHORIZED };
  }

  try {
    await deleteModelGroupLimit(id);
    await publishModelLimitCacheInvalidation();
    revalidatePath(SETTINGS_PATH);
    return { ok: true };
  } catch (error) {
    logger.error("[ModelLimitAction] Failed to delete model group limit", { error, id });
    return { ok: false, error: "删除按模型限额失败", errorCode: ERROR_CODES.DELETE_FAILED };
  }
}
