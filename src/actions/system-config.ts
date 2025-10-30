"use server";

import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";
import { getSystemSettings, updateSystemSettings } from "@/repository/system-config";
import { getSession } from "@/lib/auth";
import { UpdateSystemSettingsSchema } from "@/lib/validation/schemas";
import type { ActionResult } from "./types";
import type { SystemSettings } from "@/types/system-config";

export async function fetchSystemSettings(): Promise<ActionResult<SystemSettings>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限访问系统设置" };
    }

    const settings = await getSystemSettings();
    return { ok: true, data: settings };
  } catch (error) {
    logger.error("获取系统设置失败:", error);
    return { ok: false, error: "获取系统设置失败" };
  }
}

export async function saveSystemSettings(formData: {
  siteTitle: string;
  allowGlobalUsageView: boolean;
  currencyDisplay?: string;
  allowViewProviderInfo?: boolean;
  nonAdminCurrencyDisplay?: string;
  enableAutoCleanup?: boolean;
  cleanupRetentionDays?: number;
  cleanupSchedule?: string;
  cleanupBatchSize?: number;
}): Promise<ActionResult<SystemSettings>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validated = UpdateSystemSettingsSchema.parse(formData);
    const updated = await updateSystemSettings({
      siteTitle: validated.siteTitle.trim(),
      allowGlobalUsageView: validated.allowGlobalUsageView,
      currencyDisplay: validated.currencyDisplay,
      allowViewProviderInfo: validated.allowViewProviderInfo,
      nonAdminCurrencyDisplay: validated.nonAdminCurrencyDisplay,
      enableAutoCleanup: validated.enableAutoCleanup,
      cleanupRetentionDays: validated.cleanupRetentionDays,
      cleanupSchedule: validated.cleanupSchedule,
      cleanupBatchSize: validated.cleanupBatchSize,
    });

    revalidatePath("/settings/config");
    revalidatePath("/dashboard");
    revalidatePath("/", "layout");

    return { ok: true, data: updated };
  } catch (error) {
    logger.error("更新系统设置失败:", error);
    const message = error instanceof Error ? error.message : "更新系统设置失败";
    return { ok: false, error: message };
  }
}
