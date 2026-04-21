"use server";

import { revalidatePath } from "next/cache";
import { locales } from "@/i18n/config";
import { emitActionAudit } from "@/lib/audit/emit";
import { getSession } from "@/lib/auth";
import { invalidateSystemSettingsCache } from "@/lib/config";
import { logger } from "@/lib/logger";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import { UpdateSystemSettingsSchema } from "@/lib/validation/schemas";
import { getSystemSettings, updateSystemSettings } from "@/repository/system-config";
import type { IpExtractionConfig } from "@/types/ip-extraction";
import type {
  CodexPriorityBillingSource,
  ResponseFixerConfig,
  SystemSettings,
} from "@/types/system-config";
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

export async function getServerTimeZone(): Promise<ActionResult<{ timeZone: string }>> {
  try {
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未授权" };
    }

    const timeZone = await resolveSystemTimezone();
    return { ok: true, data: { timeZone } };
  } catch (error) {
    logger.error("获取时区失败:", error);
    return { ok: false, error: "获取时区失败" };
  }
}

export async function saveSystemSettings(formData: {
  // 所有字段均为可选，支持部分更新
  siteTitle?: string;
  allowGlobalUsageView?: boolean;
  currencyDisplay?: string;
  billingModelSource?: string;
  codexPriorityBillingSource?: CodexPriorityBillingSource;
  timezone?: string | null;
  enableAutoCleanup?: boolean;
  cleanupRetentionDays?: number;
  cleanupSchedule?: string;
  cleanupBatchSize?: number;
  enableClientVersionCheck?: boolean;
  verboseProviderError?: boolean;
  enableHttp2?: boolean;
  enableHighConcurrencyMode?: boolean;
  interceptAnthropicWarmupRequests?: boolean;
  enableThinkingSignatureRectifier?: boolean;
  enableThinkingBudgetRectifier?: boolean;
  enableBillingHeaderRectifier?: boolean;
  enableResponseInputRectifier?: boolean;
  enableCodexSessionIdCompletion?: boolean;
  enableClaudeMetadataUserIdInjection?: boolean;
  enableResponseFixer?: boolean;
  responseFixerConfig?: Partial<ResponseFixerConfig>;
  // Quota lease settings
  quotaDbRefreshIntervalSeconds?: number;
  quotaLeasePercent5h?: number;
  quotaLeasePercentDaily?: number;
  quotaLeasePercentWeekly?: number;
  quotaLeasePercentMonthly?: number;
  quotaLeaseCapUsd?: number | null;
  publicStatusWindowHours?: number;
  publicStatusAggregationIntervalMinutes?: number;
  // IP 提取 / 归属地查询
  ipExtractionConfig?: IpExtractionConfig | null;
  ipGeoLookupEnabled?: boolean;
}): Promise<ActionResult<SystemSettings>> {
  let before: SystemSettings | null = null;
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    before = await getSystemSettings();
    const validated = UpdateSystemSettingsSchema.parse(formData);
    const updated = await updateSystemSettings({
      siteTitle: validated.siteTitle?.trim(),
      allowGlobalUsageView: validated.allowGlobalUsageView,
      currencyDisplay: validated.currencyDisplay,
      billingModelSource: validated.billingModelSource,
      codexPriorityBillingSource: validated.codexPriorityBillingSource,
      timezone: validated.timezone,
      enableAutoCleanup: validated.enableAutoCleanup,
      cleanupRetentionDays: validated.cleanupRetentionDays,
      cleanupSchedule: validated.cleanupSchedule,
      cleanupBatchSize: validated.cleanupBatchSize,
      enableClientVersionCheck: validated.enableClientVersionCheck,
      verboseProviderError: validated.verboseProviderError,
      enableHttp2: validated.enableHttp2,
      enableHighConcurrencyMode: validated.enableHighConcurrencyMode,
      interceptAnthropicWarmupRequests: validated.interceptAnthropicWarmupRequests,
      enableThinkingSignatureRectifier: validated.enableThinkingSignatureRectifier,
      enableThinkingBudgetRectifier: validated.enableThinkingBudgetRectifier,
      enableBillingHeaderRectifier: validated.enableBillingHeaderRectifier,
      enableResponseInputRectifier: validated.enableResponseInputRectifier,
      enableCodexSessionIdCompletion: validated.enableCodexSessionIdCompletion,
      enableClaudeMetadataUserIdInjection: validated.enableClaudeMetadataUserIdInjection,
      enableResponseFixer: validated.enableResponseFixer,
      responseFixerConfig: validated.responseFixerConfig,
      quotaDbRefreshIntervalSeconds: validated.quotaDbRefreshIntervalSeconds,
      quotaLeasePercent5h: validated.quotaLeasePercent5h,
      quotaLeasePercentDaily: validated.quotaLeasePercentDaily,
      quotaLeasePercentWeekly: validated.quotaLeasePercentWeekly,
      quotaLeasePercentMonthly: validated.quotaLeasePercentMonthly,
      quotaLeaseCapUsd: validated.quotaLeaseCapUsd,
      publicStatusWindowHours: validated.publicStatusWindowHours,
      publicStatusAggregationIntervalMinutes: validated.publicStatusAggregationIntervalMinutes,
      ipExtractionConfig: validated.ipExtractionConfig,
      ipGeoLookupEnabled: validated.ipGeoLookupEnabled,
    });

    // Invalidate the system settings cache so proxy requests get fresh settings
    invalidateSystemSettingsCache();

    // Revalidate paths for all locales to ensure cache invalidation across i18n routes
    for (const locale of locales) {
      revalidatePath(`/${locale}/settings/config`);
      revalidatePath(`/${locale}/dashboard`);
    }
    revalidatePath("/", "layout");

    emitActionAudit({
      category: "system_settings",
      action: "system_settings.update",
      targetType: "system_settings",
      targetId: String(updated.id),
      targetName: "global",
      before: before ?? undefined,
      after: updated,
      success: true,
    });

    return { ok: true, data: updated };
  } catch (error) {
    logger.error("更新系统设置失败:", error);
    const message = error instanceof Error ? error.message : "更新系统设置失败";
    emitActionAudit({
      category: "system_settings",
      action: "system_settings.update",
      targetType: "system_settings",
      targetName: "global",
      before: before ?? undefined,
      success: false,
      errorMessage: "UPDATE_FAILED",
    });
    return { ok: false, error: message };
  }
}
