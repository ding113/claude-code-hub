"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import type { ActionResult } from "@/actions/types";
import { emitActionAudit } from "@/lib/audit/emit";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis";
import { invalidateCachedUser } from "@/lib/security/api-key-auth-cache";
import { ERROR_CODES } from "@/lib/utils/error-messages";
import { findUserById, updateUserCostResetMarkers } from "@/repository/user";

export async function resetUser5hLimitOnly(
  userId: number
): Promise<ActionResult<{ resetMode: "fixed" | "rolling"; cleanupRequired?: boolean }>> {
  try {
    const tError = await getTranslations("errors");

    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return {
        ok: false,
        error: tError("PERMISSION_DENIED"),
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    const user = await findUserById(userId);
    if (!user) {
      return { ok: false, error: tError("USER_NOT_FOUND"), errorCode: ERROR_CODES.NOT_FOUND };
    }

    if (!user.limit5hUsd || user.limit5hUsd <= 0) {
      return {
        ok: false,
        error: tError("USER_5H_LIMIT_NOT_CONFIGURED"),
        errorCode: ERROR_CODES.OPERATION_FAILED,
      };
    }

    const resetMode = user.limit5hResetMode ?? "rolling";
    const redis = getRedisClient();
    const redisReady = !!redis && redis.status === "ready";
    if (resetMode === "fixed" && !redisReady) {
      return {
        ok: false,
        error: tError("USER_5H_FIXED_RESET_REQUIRES_REDIS"),
        errorCode: ERROR_CODES.OPERATION_FAILED,
      };
    }

    const { clearUser5hCostCache } = await import("@/lib/redis/cost-cache-cleanup");

    if (resetMode === "rolling") {
      const resetAt = new Date();
      const updated = await updateUserCostResetMarkers(userId, {
        limit5hCostResetAt: resetAt,
        enforceLimit5hMonotonic: true,
      });
      if (!updated) {
        return { ok: false, error: tError("USER_NOT_FOUND"), errorCode: ERROR_CODES.NOT_FOUND };
      }
    }

    const cleanupResult = redisReady ? await clearUser5hCostCache({ userId, resetMode }) : null;
    if (!cleanupResult || cleanupResult.cleanupFailed) {
      if (resetMode === "rolling") {
        logger.warn("Rolling user 5h reset requires Redis cleanup follow-up", {
          userId,
          cleanupFailed: cleanupResult?.cleanupFailed ?? true,
          errorCount: cleanupResult?.errorCount,
        });
        await invalidateCachedUser(userId).catch(() => {});
        emitActionAudit({
          category: "user",
          action: "user.reset_5h_limit_only",
          targetType: "user",
          targetId: String(userId),
          targetName: user.name,
          before: user,
          after: {
            resetMode,
            cleanupRequired: true,
          },
          success: true,
        });
        revalidatePath("/dashboard/users");
        return {
          ok: true,
          data: {
            resetMode,
            cleanupRequired: true,
          },
        };
      }

      logger.error("Fixed user 5h reset could not clear Redis enforcement state", {
        userId,
        cleanupFailed: cleanupResult?.cleanupFailed ?? true,
        errorCount: cleanupResult?.errorCount,
      });
      return {
        ok: false,
        error: tError("USER_5H_FIXED_RESET_CLEANUP_FAILED"),
        errorCode: ERROR_CODES.USER_5H_FIXED_RESET_CLEANUP_FAILED,
      };
    }

    await invalidateCachedUser(userId).catch(() => {});
    const afterUser = await findUserById(userId);
    emitActionAudit({
      category: "user",
      action: "user.reset_5h_limit",
      targetType: "user",
      targetId: String(userId),
      targetName: user.name,
      before: user,
      after: afterUser ?? undefined,
      success: true,
    });
    revalidatePath("/dashboard/users");
    return {
      ok: true,
      data: {
        resetMode,
      },
    };
  } catch (error) {
    logger.error("Failed to reset user 5h limit:", error);
    const tError = await getTranslations("errors");
    return {
      ok: false,
      error: tError("OPERATION_FAILED"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}
