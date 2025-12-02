"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { invalidateSystemSettingsCache } from "@/lib/config";
import { logger } from "@/lib/logger";
import { UpdateSystemSettingsSchema } from "@/lib/validation/schemas";
import { getSystemSettings, updateSystemSettings } from "@/repository/system-config";
import type { SystemSettings } from "@/types/system-config";
import type { ActionResult } from "./types";

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
  // 所有字段均为可选，支持部分更新
  siteTitle?: string;
  allowGlobalUsageView?: boolean;
  currencyDisplay?: string;
  billingModelSource?: string;
  enableAutoCleanup?: boolean;
  cleanupRetentionDays?: number;
  cleanupSchedule?: string;
  cleanupBatchSize?: number;
  enableClientVersionCheck?: boolean;
  verboseProviderError?: boolean;
  enableHttp2?: boolean;
}): Promise<ActionResult<SystemSettings>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validated = UpdateSystemSettingsSchema.parse(formData);
    const updated = await updateSystemSettings({
      siteTitle: validated.siteTitle?.trim(),
      allowGlobalUsageView: validated.allowGlobalUsageView,
      currencyDisplay: validated.currencyDisplay,
      billingModelSource: validated.billingModelSource,
      enableAutoCleanup: validated.enableAutoCleanup,
      cleanupRetentionDays: validated.cleanupRetentionDays,
      cleanupSchedule: validated.cleanupSchedule,
      cleanupBatchSize: validated.cleanupBatchSize,
      enableClientVersionCheck: validated.enableClientVersionCheck,
      verboseProviderError: validated.verboseProviderError,
      enableHttp2: validated.enableHttp2,
    });

    // Invalidate the system settings cache so proxy requests get fresh settings
    invalidateSystemSettingsCache();

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
