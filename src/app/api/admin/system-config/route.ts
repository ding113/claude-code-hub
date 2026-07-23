import { z } from "zod";
import { getSession } from "@/lib/auth";
import { invalidateSystemSettingsCache } from "@/lib/config";
import { logger } from "@/lib/logger";
import {
  invalidateAllLeaderboardCaches,
  invalidateAllOverviewCaches,
  invalidateAllStatisticsCaches,
} from "@/lib/redis";
import {
  DISCOVERY_SETTINGS_INVALID_ERROR_CODE,
  DISCOVERY_WINDOW_INVALID_ERROR_CODE,
  getDiscoveryValidationErrorCode,
} from "@/lib/validation/discovery-settings";
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
    const current = await getSystemSettings();

    // 验证请求数据
    const validated = UpdateSystemSettingsSchema.parse(body);
    const discoverySlaMs = validated.discoverySlaMs ?? current.discoverySlaMs;
    const stickySlaMs = validated.stickySlaMs ?? current.stickySlaMs;
    const maxDiscoveryRounds = validated.maxDiscoveryRounds ?? current.maxDiscoveryRounds;
    const racingTotalTimeoutMs = validated.racingTotalTimeoutMs ?? current.racingTotalTimeoutMs;
    if (racingTotalTimeoutMs < stickySlaMs + maxDiscoveryRounds * discoverySlaMs) {
      return Response.json(
        { error: "discoveryWindowInvalid", errorCode: DISCOVERY_WINDOW_INVALID_ERROR_CODE },
        { status: 400 }
      );
    }

    // 更新系统设置
    const updated = await updateSystemSettings({
      siteTitle: validated.siteTitle?.trim(),
      allowGlobalUsageView: validated.allowGlobalUsageView,
      currencyDisplay: validated.currencyDisplay,
      billingModelSource: validated.billingModelSource,
      codexPriorityBillingSource: validated.codexPriorityBillingSource,
      discoveryEnabled: validated.discoveryEnabled,
      discoveryConcurrency: validated.discoveryConcurrency,
      maxDiscoveryRounds: validated.maxDiscoveryRounds,
      discoverySlaMs: validated.discoverySlaMs,
      stickySlaMs: validated.stickySlaMs,
      racingTotalTimeoutMs: validated.racingTotalTimeoutMs,
      stickyTimeoutCooldownMs: validated.stickyTimeoutCooldownMs,
      timezone: validated.timezone,
      enableAutoCleanup: validated.enableAutoCleanup,
      cleanupRetentionDays: validated.cleanupRetentionDays,
      cleanupSchedule: validated.cleanupSchedule,
      cleanupBatchSize: validated.cleanupBatchSize,
      enableClientVersionCheck: validated.enableClientVersionCheck,
      verboseProviderError: validated.verboseProviderError,
      passThroughUpstreamErrorMessage: validated.passThroughUpstreamErrorMessage,
      enableHttp2: validated.enableHttp2,
      enableOpenaiResponsesWebsocket: validated.enableOpenaiResponsesWebsocket,
      enableHighConcurrencyMode: validated.enableHighConcurrencyMode,
      interceptAnthropicWarmupRequests: validated.interceptAnthropicWarmupRequests,
      enableThinkingSignatureRectifier: validated.enableThinkingSignatureRectifier,
      enableThinkingBudgetRectifier: validated.enableThinkingBudgetRectifier,
      enableGeminiFunctionIdRectifier: validated.enableGeminiFunctionIdRectifier,
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
    const { invalidateProviderSelectorSystemSettingsCache } = await import(
      "@/app/v1/_lib/proxy/provider-selector-settings-cache"
    );
    invalidateProviderSelectorSystemSettingsCache();
    if (validated.timezone !== undefined) {
      await Promise.all([
        invalidateAllOverviewCaches(),
        invalidateAllStatisticsCaches(),
        invalidateAllLeaderboardCaches(),
      ]).catch((error) => {
        logger.warn("[SystemSettings] Failed to invalidate timezone-sensitive dashboard caches", {
          error,
        });
      });
    }

    return Response.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorCode = getDiscoveryValidationErrorCode(error.issues);
      if (errorCode === DISCOVERY_WINDOW_INVALID_ERROR_CODE) {
        return Response.json({ error: "discoveryWindowInvalid", errorCode }, { status: 400 });
      }
      if (errorCode === DISCOVERY_SETTINGS_INVALID_ERROR_CODE) {
        return Response.json({ error: "discoverySettingsInvalid", errorCode }, { status: 400 });
      }
      const firstError = error.issues[0];
      return Response.json({ error: firstError.message || "数据验证失败" }, { status: 400 });
    }

    logger.error("更新系统配置失败", { error });
    const message = error instanceof Error ? error.message : "更新系统配置失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
