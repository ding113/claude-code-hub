import { z } from "zod";
import { getSession } from "@/lib/auth";
import { invalidateSystemSettingsCache } from "@/lib/config";
import { logger } from "@/lib/logger";
import { UpdateSystemSettingsSchema } from "@/lib/validation/schemas";
import { getSystemSettings, updateSystemSettings } from "@/repository/system-config";

// 需要数据库连接
export const runtime = "nodejs";

/**
 * GET /api/admin/system-config
 * 获取系统配置
 */
export async function GET() {
  const session = await getSession();

  if (!session || session.user.role !== "admin") {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const settings = await getSystemSettings();
    return Response.json(settings);
  } catch (error) {
    logger.error("获取系统配置失败", { error });
    return Response.json({ error: "获取系统配置失败" }, { status: 500 });
  }
}

/**
 * POST /api/admin/system-config
 * 更新系统配置
 *
 * Body: {
 *   siteTitle: string;
 *   allowGlobalUsageView: boolean;
 *   currencyDisplay?: string;
 *   enableAutoCleanup?: boolean;
 *   cleanupRetentionDays?: number;
 *   cleanupSchedule?: string;
 *   cleanupBatchSize?: number;
 * }
 */
export async function POST(req: Request) {
  const session = await getSession();

  if (!session || session.user.role !== "admin") {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const body = await req.json();

    // 验证请求数据
    const validated = UpdateSystemSettingsSchema.parse(body);

    // 更新系统设置
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
    });

    logger.info("系统配置已更新", {
      userId: session.user.id,
      changes: validated,
    });
    invalidateSystemSettingsCache();

    return Response.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.issues[0];
      return Response.json({ error: firstError.message || "数据验证失败" }, { status: 400 });
    }

    logger.error("更新系统配置失败", { error });
    const message = error instanceof Error ? error.message : "更新系统配置失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
