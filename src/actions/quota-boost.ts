"use server";

import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import * as repo from "@/repository/quota-boost";
import type { ActionResult } from "./types";

export async function listQuotaBoostGrantsAction(filter: {
  userId?: number;
  modelGroupId?: number;
}): Promise<ActionResult<repo.QuotaBoostGrantRow[]>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "permission denied", errorCode: "auth.forbidden" };
    }

    const items = await repo.listQuotaBoostGrants(filter);
    return { ok: true, data: items };
  } catch (error) {
    logger.error("[QuotaBoostAction] Failed to list grants", { error });
    return {
      ok: false,
      error: "Failed to list quota boost grants.",
      errorCode: "quota_boost.list_failed",
    };
  }
}

export async function createQuotaBoostGrantAction(input: {
  userId: number;
  modelGroupId: number;
  window: repo.BoostWindow;
  amountUsd: number;
  validFrom: string;
  validTo: string;
  note?: string | null;
}): Promise<ActionResult<repo.QuotaBoostGrantRow>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "permission denied", errorCode: "auth.forbidden" };
    }

    const validFrom = new Date(input.validFrom);
    const validTo = new Date(input.validTo);

    if (validTo <= validFrom) {
      return {
        ok: false,
        error: "validTo must be after validFrom.",
        errorCode: "quota_boost.invalid_validity_range",
      };
    }

    const row = await repo.createQuotaBoostGrant({
      userId: input.userId,
      modelGroupId: input.modelGroupId,
      window: input.window,
      amountUsd: input.amountUsd,
      validFrom,
      validTo,
      note: input.note ?? null,
      createdBy: session.user.id,
    });

    logger.info("[QuotaBoostAction] Created quota boost grant", {
      grantId: row.id,
      userId: input.userId,
      modelGroupId: input.modelGroupId,
      window: input.window,
      amountUsd: input.amountUsd,
      adminId: session.user.id,
    });

    return { ok: true, data: row };
  } catch (error) {
    logger.error("[QuotaBoostAction] Failed to create grant", { error });
    return {
      ok: false,
      error: "Failed to create quota boost grant.",
      errorCode: "quota_boost.create_failed",
    };
  }
}

export async function deleteQuotaBoostGrantAction(id: number): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "permission denied", errorCode: "auth.forbidden" };
    }

    await repo.deleteQuotaBoostGrant(id);

    logger.info("[QuotaBoostAction] Revoked quota boost grant", {
      grantId: id,
      adminId: session.user.id,
    });

    return { ok: true };
  } catch (error) {
    logger.error("[QuotaBoostAction] Failed to delete grant", { error });
    return {
      ok: false,
      error: "Failed to revoke quota boost grant.",
      errorCode: "quota_boost.delete_failed",
    };
  }
}
