"use server";

import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { ERROR_CODES } from "@/lib/utils/error-messages";
import { listProviderCacheEffectivenessWindows } from "@/repository/provider-cache-effectiveness";
import type { ProviderCacheEffectivenessWindow } from "@/types/provider-cache-effectiveness";
import type { ActionResult } from "./types";

export interface GetProviderCacheEffectivenessInput {
  providerId?: number;
  limit?: number;
}

/**
 * 获取缓存效果窗口列表（管理员，只读指标）
 */
export async function getProviderCacheEffectivenessWindows(
  input: GetProviderCacheEffectivenessInput = {}
): Promise<ActionResult<ProviderCacheEffectivenessWindow[]>> {
  const tErrors = await getTranslations("errors");
  try {
    const session = await getSession();
    if (session?.user.role !== "admin") {
      return {
        ok: false,
        error: tErrors("PERMISSION_DENIED"),
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    const rows = await listProviderCacheEffectivenessWindows({
      providerId: input.providerId,
      limit: input.limit,
    });
    return { ok: true, data: rows };
  } catch (error) {
    logger.error("[ProviderCacheEffectivenessAction] Failed to list windows:", error);
    return {
      ok: false,
      error: tErrors("OPERATION_FAILED"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}
