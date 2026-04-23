"use server";

import { eq } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { systemSettings } from "@/drizzle/schema";
import { logger } from "@/lib/logger";
import { DEFAULT_SITE_TITLE } from "@/lib/site-title";
import type { SystemSettings, UpdateSystemSettingsInput } from "@/types/system-config";
import { toSystemSettings } from "./_shared/transformers";

type TransactionExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];
type SystemSettingsMutationExecutor = Pick<TransactionExecutor, "update">;

function isTableMissingError(error: unknown, depth = 0): boolean {
  if (!error || depth > 5) {
    return false;
  }

  if (typeof error === "string") {
    const normalized = error.toLowerCase();
    return (
      normalized.includes("42p01") ||
      (normalized.includes("system_settings") &&
        (normalized.includes("does not exist") ||
          normalized.includes("doesn't exist") ||
          normalized.includes("找不到")))
    );
  }

  if (typeof error === "object") {
    const err = error as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
      errors?: unknown;
      originalError?: unknown;
    };

    if (typeof err.code === "string" && err.code.toUpperCase() === "42P01") {
      return true;
    }

    if (typeof err.message === "string" && isTableMissingError(err.message, depth + 1)) {
      return true;
    }

    if ("cause" in err && err.cause && isTableMissingError(err.cause, depth + 1)) {
      return true;
    }

    if (Array.isArray(err.errors)) {
      return err.errors.some((item) => isTableMissingError(item, depth + 1));
    }

    if (err.originalError && isTableMissingError(err.originalError, depth + 1)) {
      return true;
    }

    // 最后尝试字符串化整个对象
    const stringified = (() => {
      try {
        return String(error);
      } catch {
        return undefined;
      }
    })();

    if (stringified) {
      return isTableMissingError(stringified, depth + 1);
    }
  }

  return false;
}

function isUndefinedColumnError(error: unknown, depth = 0): boolean {
  if (!error || depth > 5) {
    return false;
  }

  if (typeof error === "string") {
    const normalized = error.toLowerCase();
    return (
      normalized.includes("42703") ||
      (normalized.includes("column") &&
        (normalized.includes("does not exist") ||
          normalized.includes("doesn't exist") ||
          normalized.includes("不存在")))
    );
  }

  if (typeof error === "object") {
    const err = error as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
      errors?: unknown;
      originalError?: unknown;
    };

    if (typeof err.code === "string" && err.code.toUpperCase() === "42703") {
      return true;
    }

    if (typeof err.message === "string" && isUndefinedColumnError(err.message, depth + 1)) {
      return true;
    }

    if ("cause" in err && err.cause && isUndefinedColumnError(err.cause, depth + 1)) {
      return true;
    }

    if (Array.isArray(err.errors)) {
      return err.errors.some((item) => isUndefinedColumnError(item, depth + 1));
    }

    if (err.originalError && isUndefinedColumnError(err.originalError, depth + 1)) {
      return true;
    }

    const stringified = (() => {
      try {
        return String(error);
      } catch {
        return undefined;
      }
    })();

    if (stringified) {
      return isUndefinedColumnError(stringified, depth + 1);
    }
  }

  return false;
}

function createFallbackSettings(): SystemSettings {
  const now = new Date();
  return {
    id: 0,
    siteTitle: DEFAULT_SITE_TITLE,
    allowGlobalUsageView: false,
    currencyDisplay: "USD",
    billingModelSource: "original",
    codexPriorityBillingSource: "requested",
    timezone: null,
    enableAutoCleanup: false,
    cleanupRetentionDays: 30,
    cleanupSchedule: "0 2 * * *",
    cleanupBatchSize: 10000,
    enableClientVersionCheck: false,
    verboseProviderError: false,
    passThroughUpstreamErrorMessage: true,
    enableHttp2: false,
    enableHighConcurrencyMode: false,
    interceptAnthropicWarmupRequests: false,
    enableThinkingSignatureRectifier: true,
    enableThinkingBudgetRectifier: true,
    enableBillingHeaderRectifier: true,
    enableResponseInputRectifier: true,
    allowNonConversationEndpointProviderFallback: true,
    enableCodexSessionIdCompletion: true,
    enableClaudeMetadataUserIdInjection: true,
    enableResponseFixer: true,
    responseFixerConfig: {
      fixTruncatedJson: true,
      fixSseFormat: true,
      fixEncoding: true,
      maxJsonDepth: 200,
      maxFixSize: 1024 * 1024,
    },
    quotaDbRefreshIntervalSeconds: 10,
    quotaLeasePercent5h: 0.05,
    quotaLeasePercentDaily: 0.05,
    quotaLeasePercentWeekly: 0.05,
    quotaLeasePercentMonthly: 0.05,
    quotaLeaseCapUsd: null,
    publicStatusWindowHours: 24,
    publicStatusAggregationIntervalMinutes: 5,
    ipExtractionConfig: null,
    ipGeoLookupEnabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 获取系统设置，如果不存在则创建默认记录
 */
export async function getSystemSettings(): Promise<SystemSettings> {
  async function selectSettingsRow() {
    const selectionWithoutHighConcurrencyMode = {
      id: systemSettings.id,
      siteTitle: systemSettings.siteTitle,
      allowGlobalUsageView: systemSettings.allowGlobalUsageView,
      currencyDisplay: systemSettings.currencyDisplay,
      billingModelSource: systemSettings.billingModelSource,
      timezone: systemSettings.timezone,
      enableAutoCleanup: systemSettings.enableAutoCleanup,
      cleanupRetentionDays: systemSettings.cleanupRetentionDays,
      cleanupSchedule: systemSettings.cleanupSchedule,
      cleanupBatchSize: systemSettings.cleanupBatchSize,
      enableClientVersionCheck: systemSettings.enableClientVersionCheck,
      verboseProviderError: systemSettings.verboseProviderError,
      enableHttp2: systemSettings.enableHttp2,
      codexPriorityBillingSource: systemSettings.codexPriorityBillingSource,
      interceptAnthropicWarmupRequests: systemSettings.interceptAnthropicWarmupRequests,
      enableThinkingSignatureRectifier: systemSettings.enableThinkingSignatureRectifier,
      enableThinkingBudgetRectifier: systemSettings.enableThinkingBudgetRectifier,
      enableBillingHeaderRectifier: systemSettings.enableBillingHeaderRectifier,
      enableResponseInputRectifier: systemSettings.enableResponseInputRectifier,
      allowNonConversationEndpointProviderFallback:
        systemSettings.allowNonConversationEndpointProviderFallback,
      enableCodexSessionIdCompletion: systemSettings.enableCodexSessionIdCompletion,
      enableClaudeMetadataUserIdInjection: systemSettings.enableClaudeMetadataUserIdInjection,
      enableResponseFixer: systemSettings.enableResponseFixer,
      responseFixerConfig: systemSettings.responseFixerConfig,
      quotaDbRefreshIntervalSeconds: systemSettings.quotaDbRefreshIntervalSeconds,
      quotaLeasePercent5h: systemSettings.quotaLeasePercent5h,
      quotaLeasePercentDaily: systemSettings.quotaLeasePercentDaily,
      quotaLeasePercentWeekly: systemSettings.quotaLeasePercentWeekly,
      quotaLeasePercentMonthly: systemSettings.quotaLeasePercentMonthly,
      quotaLeaseCapUsd: systemSettings.quotaLeaseCapUsd,
      publicStatusWindowHours: systemSettings.publicStatusWindowHours,
      publicStatusAggregationIntervalMinutes: systemSettings.publicStatusAggregationIntervalMinutes,
      createdAt: systemSettings.createdAt,
      updatedAt: systemSettings.updatedAt,
    };
    const selectionWithoutPassThrough = {
      ...selectionWithoutHighConcurrencyMode,
      enableHighConcurrencyMode: systemSettings.enableHighConcurrencyMode,
      ipExtractionConfig: systemSettings.ipExtractionConfig,
      ipGeoLookupEnabled: systemSettings.ipGeoLookupEnabled,
    };
    const selectionWithoutCodexAndHighConcurrency = {
      id: systemSettings.id,
      siteTitle: systemSettings.siteTitle,
      allowGlobalUsageView: systemSettings.allowGlobalUsageView,
      currencyDisplay: systemSettings.currencyDisplay,
      billingModelSource: systemSettings.billingModelSource,
      timezone: systemSettings.timezone,
      enableAutoCleanup: systemSettings.enableAutoCleanup,
      cleanupRetentionDays: systemSettings.cleanupRetentionDays,
      cleanupSchedule: systemSettings.cleanupSchedule,
      cleanupBatchSize: systemSettings.cleanupBatchSize,
      enableClientVersionCheck: systemSettings.enableClientVersionCheck,
      verboseProviderError: systemSettings.verboseProviderError,
      enableHttp2: systemSettings.enableHttp2,
      interceptAnthropicWarmupRequests: systemSettings.interceptAnthropicWarmupRequests,
      enableThinkingSignatureRectifier: systemSettings.enableThinkingSignatureRectifier,
      enableThinkingBudgetRectifier: systemSettings.enableThinkingBudgetRectifier,
      enableBillingHeaderRectifier: systemSettings.enableBillingHeaderRectifier,
      enableResponseInputRectifier: systemSettings.enableResponseInputRectifier,
      allowNonConversationEndpointProviderFallback:
        systemSettings.allowNonConversationEndpointProviderFallback,
      enableCodexSessionIdCompletion: systemSettings.enableCodexSessionIdCompletion,
      enableClaudeMetadataUserIdInjection: systemSettings.enableClaudeMetadataUserIdInjection,
      enableResponseFixer: systemSettings.enableResponseFixer,
      responseFixerConfig: systemSettings.responseFixerConfig,
      quotaDbRefreshIntervalSeconds: systemSettings.quotaDbRefreshIntervalSeconds,
      quotaLeasePercent5h: systemSettings.quotaLeasePercent5h,
      quotaLeasePercentDaily: systemSettings.quotaLeasePercentDaily,
      quotaLeasePercentWeekly: systemSettings.quotaLeasePercentWeekly,
      quotaLeasePercentMonthly: systemSettings.quotaLeasePercentMonthly,
      quotaLeaseCapUsd: systemSettings.quotaLeaseCapUsd,
      publicStatusWindowHours: systemSettings.publicStatusWindowHours,
      publicStatusAggregationIntervalMinutes: systemSettings.publicStatusAggregationIntervalMinutes,
      createdAt: systemSettings.createdAt,
      updatedAt: systemSettings.updatedAt,
    };
    const fullSelection = {
      passThroughUpstreamErrorMessage: systemSettings.passThroughUpstreamErrorMessage,
      ...selectionWithoutPassThrough,
    };

    try {
      const [row] = await db.select(fullSelection).from(systemSettings).limit(1);
      return row ?? null;
    } catch (error) {
      // 兼容旧版本数据库：system_settings 表存在但列未迁移齐全
      if (isUndefinedColumnError(error)) {
        logger.warn("system_settings 表列缺失，使用降级字段集读取（建议运行数据库迁移）。", {
          error,
        });

        // 第一层降级：仅移除本次新增的 allowNonConversationEndpointProviderFallback 列，
        // 其它已迁移的现代字段保留，避免只缺该列时其它设置被连带默认化。
        const {
          allowNonConversationEndpointProviderFallback: _omitNonConversationFallback,
          ...selectionWithoutNonConversationFallback
        } = fullSelection;

        try {
          const [row] = await db
            .select(selectionWithoutNonConversationFallback)
            .from(systemSettings)
            .limit(1);
          return row ?? null;
        } catch (nonConversationFallbackError) {
          if (!isUndefinedColumnError(nonConversationFallbackError)) {
            throw nonConversationFallbackError;
          }

          logger.warn(
            "system_settings 表除新增列外仍有列缺失，继续回退到 withoutHighConcurrencyMode 字段集。",
            { error: nonConversationFallbackError }
          );
        }

        try {
          const [row] = await db.select(selectionWithoutPassThrough).from(systemSettings).limit(1);
          return row ?? null;
        } catch (passThroughFallbackError) {
          if (!isUndefinedColumnError(passThroughFallbackError)) {
            throw passThroughFallbackError;
          }

          logger.warn(
            "system_settings 表缺少 passThroughUpstreamErrorMessage 之外的新列，继续降级读取。",
            {
              error: passThroughFallbackError,
            }
          );

          try {
            const [row] = await db
              .select(selectionWithoutHighConcurrencyMode)
              .from(systemSettings)
              .limit(1);
            return row ?? null;
          } catch (fallbackError) {
            if (!isUndefinedColumnError(fallbackError)) {
              throw fallbackError;
            }

            logger.warn("system_settings 表存在多个缺失列，继续使用 legacy 字段集读取。", {
              error: fallbackError,
            });

            try {
              const [row] = await db
                .select(selectionWithoutCodexAndHighConcurrency)
                .from(systemSettings)
                .limit(1);
              return row ?? null;
            } catch (legacyFallbackError) {
              if (!isUndefinedColumnError(legacyFallbackError)) {
                throw legacyFallbackError;
              }

              logger.warn("system_settings 表存在更多缺失列，继续使用最小字段集读取。", {
                error: legacyFallbackError,
              });

              // 第三层 / 最终回退：仅查询最小核心字段，剩余字段交给 toSystemSettings 补默认值。
              const minimalSelection = {
                id: systemSettings.id,
                siteTitle: systemSettings.siteTitle,
                allowGlobalUsageView: systemSettings.allowGlobalUsageView,
                currencyDisplay: systemSettings.currencyDisplay,
                billingModelSource: systemSettings.billingModelSource,
                createdAt: systemSettings.createdAt,
                updatedAt: systemSettings.updatedAt,
              };

              const [row] = await db.select(minimalSelection).from(systemSettings).limit(1);
              return row ?? null;
            }
          }
        }
      }

      throw error;
    }
  }

  try {
    const settings = await selectSettingsRow();

    if (settings) {
      return toSystemSettings(settings);
    }

    try {
      await db
        .insert(systemSettings)
        .values({
          siteTitle: DEFAULT_SITE_TITLE,
          allowGlobalUsageView: false,
          currencyDisplay: "USD",
          billingModelSource: "original",
          codexPriorityBillingSource: "requested",
          passThroughUpstreamErrorMessage: true,
          allowNonConversationEndpointProviderFallback: true,
          enableHighConcurrencyMode: false,
          publicStatusWindowHours: 24,
          publicStatusAggregationIntervalMinutes: 5,
        })
        .onConflictDoNothing();
    } catch (error) {
      if (!isUndefinedColumnError(error)) {
        throw error;
      }

      logger.warn("system_settings 表列缺失，使用降级字段集初始化默认记录。", {
        error,
      });

      await db
        .insert(systemSettings)
        .values({
          siteTitle: DEFAULT_SITE_TITLE,
          allowGlobalUsageView: false,
          currencyDisplay: "USD",
          billingModelSource: "original",
        })
        .onConflictDoNothing();
    }

    const fallback = await selectSettingsRow();
    if (!fallback) {
      throw new Error("Failed to initialize system settings");
    }

    return toSystemSettings(fallback);
  } catch (error) {
    if (isTableMissingError(error)) {
      logger.warn("system_settings 表不存在，返回默认配置。请运行数据库迁移。", { error });
      return createFallbackSettings();
    }
    throw error;
  }
}

/**
 * 更新系统设置
 */
export async function updateSystemSettings(
  payload: UpdateSystemSettingsInput,
  executor: SystemSettingsMutationExecutor = db
): Promise<SystemSettings> {
  const returningWithoutHighConcurrencyMode = {
    id: systemSettings.id,
    siteTitle: systemSettings.siteTitle,
    allowGlobalUsageView: systemSettings.allowGlobalUsageView,
    currencyDisplay: systemSettings.currencyDisplay,
    billingModelSource: systemSettings.billingModelSource,
    timezone: systemSettings.timezone,
    enableAutoCleanup: systemSettings.enableAutoCleanup,
    cleanupRetentionDays: systemSettings.cleanupRetentionDays,
    cleanupSchedule: systemSettings.cleanupSchedule,
    cleanupBatchSize: systemSettings.cleanupBatchSize,
    enableClientVersionCheck: systemSettings.enableClientVersionCheck,
    verboseProviderError: systemSettings.verboseProviderError,
    enableHttp2: systemSettings.enableHttp2,
    codexPriorityBillingSource: systemSettings.codexPriorityBillingSource,
    interceptAnthropicWarmupRequests: systemSettings.interceptAnthropicWarmupRequests,
    enableThinkingSignatureRectifier: systemSettings.enableThinkingSignatureRectifier,
    enableThinkingBudgetRectifier: systemSettings.enableThinkingBudgetRectifier,
    enableBillingHeaderRectifier: systemSettings.enableBillingHeaderRectifier,
    enableResponseInputRectifier: systemSettings.enableResponseInputRectifier,
    allowNonConversationEndpointProviderFallback:
      systemSettings.allowNonConversationEndpointProviderFallback,
    enableCodexSessionIdCompletion: systemSettings.enableCodexSessionIdCompletion,
    enableClaudeMetadataUserIdInjection: systemSettings.enableClaudeMetadataUserIdInjection,
    enableResponseFixer: systemSettings.enableResponseFixer,
    responseFixerConfig: systemSettings.responseFixerConfig,
    quotaDbRefreshIntervalSeconds: systemSettings.quotaDbRefreshIntervalSeconds,
    quotaLeasePercent5h: systemSettings.quotaLeasePercent5h,
    quotaLeasePercentDaily: systemSettings.quotaLeasePercentDaily,
    quotaLeasePercentWeekly: systemSettings.quotaLeasePercentWeekly,
    quotaLeasePercentMonthly: systemSettings.quotaLeasePercentMonthly,
    quotaLeaseCapUsd: systemSettings.quotaLeaseCapUsd,
    publicStatusWindowHours: systemSettings.publicStatusWindowHours,
    publicStatusAggregationIntervalMinutes: systemSettings.publicStatusAggregationIntervalMinutes,
    createdAt: systemSettings.createdAt,
    updatedAt: systemSettings.updatedAt,
  };
  const returningWithoutPassThrough = {
    ...returningWithoutHighConcurrencyMode,
    enableHighConcurrencyMode: systemSettings.enableHighConcurrencyMode,
    ipExtractionConfig: systemSettings.ipExtractionConfig,
    ipGeoLookupEnabled: systemSettings.ipGeoLookupEnabled,
  };
  const returningWithoutCodexAndHighConcurrency = {
    id: systemSettings.id,
    siteTitle: systemSettings.siteTitle,
    allowGlobalUsageView: systemSettings.allowGlobalUsageView,
    currencyDisplay: systemSettings.currencyDisplay,
    billingModelSource: systemSettings.billingModelSource,
    timezone: systemSettings.timezone,
    enableAutoCleanup: systemSettings.enableAutoCleanup,
    cleanupRetentionDays: systemSettings.cleanupRetentionDays,
    cleanupSchedule: systemSettings.cleanupSchedule,
    cleanupBatchSize: systemSettings.cleanupBatchSize,
    enableClientVersionCheck: systemSettings.enableClientVersionCheck,
    verboseProviderError: systemSettings.verboseProviderError,
    enableHttp2: systemSettings.enableHttp2,
    interceptAnthropicWarmupRequests: systemSettings.interceptAnthropicWarmupRequests,
    enableThinkingSignatureRectifier: systemSettings.enableThinkingSignatureRectifier,
    enableThinkingBudgetRectifier: systemSettings.enableThinkingBudgetRectifier,
    enableBillingHeaderRectifier: systemSettings.enableBillingHeaderRectifier,
    enableResponseInputRectifier: systemSettings.enableResponseInputRectifier,
    enableCodexSessionIdCompletion: systemSettings.enableCodexSessionIdCompletion,
    enableClaudeMetadataUserIdInjection: systemSettings.enableClaudeMetadataUserIdInjection,
    enableResponseFixer: systemSettings.enableResponseFixer,
    responseFixerConfig: systemSettings.responseFixerConfig,
    quotaDbRefreshIntervalSeconds: systemSettings.quotaDbRefreshIntervalSeconds,
    quotaLeasePercent5h: systemSettings.quotaLeasePercent5h,
    quotaLeasePercentDaily: systemSettings.quotaLeasePercentDaily,
    quotaLeasePercentWeekly: systemSettings.quotaLeasePercentWeekly,
    quotaLeasePercentMonthly: systemSettings.quotaLeasePercentMonthly,
    quotaLeaseCapUsd: systemSettings.quotaLeaseCapUsd,
    publicStatusWindowHours: systemSettings.publicStatusWindowHours,
    publicStatusAggregationIntervalMinutes: systemSettings.publicStatusAggregationIntervalMinutes,
    createdAt: systemSettings.createdAt,
    updatedAt: systemSettings.updatedAt,
  };
  const fullReturning = {
    passThroughUpstreamErrorMessage: systemSettings.passThroughUpstreamErrorMessage,
    ...returningWithoutPassThrough,
  };

  try {
    const current = await getSystemSettings();

    // 构建更新对象，只更新提供的字段（非 undefined）
    const updates: Partial<typeof systemSettings.$inferInsert> = {
      updatedAt: new Date(),
    };

    // 基础配置字段（如果提供）
    if (payload.siteTitle !== undefined) {
      updates.siteTitle = payload.siteTitle;
    }
    if (payload.allowGlobalUsageView !== undefined) {
      updates.allowGlobalUsageView = payload.allowGlobalUsageView;
    }

    // 货币显示配置字段（如果提供）
    if (payload.currencyDisplay !== undefined) {
      updates.currencyDisplay = payload.currencyDisplay;
    }

    // 计费模型来源配置字段（如果提供）
    if (payload.billingModelSource !== undefined) {
      updates.billingModelSource = payload.billingModelSource;
    }
    if (payload.codexPriorityBillingSource !== undefined) {
      updates.codexPriorityBillingSource = payload.codexPriorityBillingSource;
    }

    // 系统时区配置字段（如果提供）
    if (payload.timezone !== undefined) {
      updates.timezone = payload.timezone;
    }

    // 日志清理配置字段（如果提供）
    if (payload.enableAutoCleanup !== undefined) {
      updates.enableAutoCleanup = payload.enableAutoCleanup;
    }
    if (payload.cleanupRetentionDays !== undefined) {
      updates.cleanupRetentionDays = payload.cleanupRetentionDays;
    }
    if (payload.cleanupSchedule !== undefined) {
      updates.cleanupSchedule = payload.cleanupSchedule;
    }
    if (payload.cleanupBatchSize !== undefined) {
      updates.cleanupBatchSize = payload.cleanupBatchSize;
    }

    // 客户端版本检查配置字段（如果提供）
    if (payload.enableClientVersionCheck !== undefined) {
      updates.enableClientVersionCheck = payload.enableClientVersionCheck;
    }

    // 供应商错误详情配置字段（如果提供）
    if (payload.verboseProviderError !== undefined) {
      updates.verboseProviderError = payload.verboseProviderError;
    }

    // 上游错误 message 透传开关（如果提供）
    if (payload.passThroughUpstreamErrorMessage !== undefined) {
      updates.passThroughUpstreamErrorMessage = payload.passThroughUpstreamErrorMessage;
    }

    // HTTP/2 配置字段（如果提供）
    if (payload.enableHttp2 !== undefined) {
      updates.enableHttp2 = payload.enableHttp2;
    }

    // 高并发模式开关（如果提供）
    if (payload.enableHighConcurrencyMode !== undefined) {
      updates.enableHighConcurrencyMode = payload.enableHighConcurrencyMode;
    }

    // Warmup 拦截开关（如果提供）
    if (payload.interceptAnthropicWarmupRequests !== undefined) {
      updates.interceptAnthropicWarmupRequests = payload.interceptAnthropicWarmupRequests;
    }

    // thinking signature 整流器开关（如果提供）
    if (payload.enableThinkingSignatureRectifier !== undefined) {
      updates.enableThinkingSignatureRectifier = payload.enableThinkingSignatureRectifier;
    }

    // thinking budget 整流器开关（如果提供）
    if (payload.enableThinkingBudgetRectifier !== undefined) {
      updates.enableThinkingBudgetRectifier = payload.enableThinkingBudgetRectifier;
    }

    // billing header 整流器开关（如果提供）
    if (payload.enableBillingHeaderRectifier !== undefined) {
      updates.enableBillingHeaderRectifier = payload.enableBillingHeaderRectifier;
    }

    // Response API input 整流器开关（如果提供）
    if (payload.enableResponseInputRectifier !== undefined) {
      updates.enableResponseInputRectifier = payload.enableResponseInputRectifier;
    }

    // 非对话端点跨供应商 fallback 开关（如果提供）
    if (payload.allowNonConversationEndpointProviderFallback !== undefined) {
      updates.allowNonConversationEndpointProviderFallback =
        payload.allowNonConversationEndpointProviderFallback;
    }

    // Codex Session ID 补全开关（如果提供）
    if (payload.enableCodexSessionIdCompletion !== undefined) {
      updates.enableCodexSessionIdCompletion = payload.enableCodexSessionIdCompletion;
    }

    // Claude metadata.user_id 注入开关（如果提供）
    if (payload.enableClaudeMetadataUserIdInjection !== undefined) {
      updates.enableClaudeMetadataUserIdInjection = payload.enableClaudeMetadataUserIdInjection;
    }

    // 响应整流开关（如果提供）
    if (payload.enableResponseFixer !== undefined) {
      updates.enableResponseFixer = payload.enableResponseFixer;
    }

    if (payload.responseFixerConfig !== undefined) {
      updates.responseFixerConfig = {
        ...current.responseFixerConfig,
        ...payload.responseFixerConfig,
      };
    }

    // Quota lease settings（如果提供）
    if (payload.quotaDbRefreshIntervalSeconds !== undefined) {
      updates.quotaDbRefreshIntervalSeconds = payload.quotaDbRefreshIntervalSeconds;
    }
    if (payload.quotaLeasePercent5h !== undefined) {
      updates.quotaLeasePercent5h = String(payload.quotaLeasePercent5h);
    }
    if (payload.quotaLeasePercentDaily !== undefined) {
      updates.quotaLeasePercentDaily = String(payload.quotaLeasePercentDaily);
    }
    if (payload.quotaLeasePercentWeekly !== undefined) {
      updates.quotaLeasePercentWeekly = String(payload.quotaLeasePercentWeekly);
    }
    if (payload.quotaLeasePercentMonthly !== undefined) {
      updates.quotaLeasePercentMonthly = String(payload.quotaLeasePercentMonthly);
    }
    if (payload.quotaLeaseCapUsd !== undefined) {
      updates.quotaLeaseCapUsd =
        payload.quotaLeaseCapUsd === null ? null : String(payload.quotaLeaseCapUsd);
    }
    if (payload.publicStatusWindowHours !== undefined) {
      updates.publicStatusWindowHours = payload.publicStatusWindowHours;
    }
    if (payload.publicStatusAggregationIntervalMinutes !== undefined) {
      updates.publicStatusAggregationIntervalMinutes =
        payload.publicStatusAggregationIntervalMinutes;
    }

    // 客户端 IP 提取链（如果提供；null 表示显式清空走默认）
    if (payload.ipExtractionConfig !== undefined) {
      updates.ipExtractionConfig = payload.ipExtractionConfig;
    }
    if (payload.ipGeoLookupEnabled !== undefined) {
      updates.ipGeoLookupEnabled = payload.ipGeoLookupEnabled;
    }

    let updated;
    try {
      [updated] = await executor
        .update(systemSettings)
        .set(updates)
        .where(eq(systemSettings.id, current.id))
        .returning(fullReturning);
    } catch (error) {
      if (!isUndefinedColumnError(error)) {
        throw error;
      }

      logger.warn("system_settings 表列缺失，使用降级字段集更新系统设置。", {
        error,
      });

      // 第一层降级：仅移除本次新增的 allowNonConversationEndpointProviderFallback 列，
      // 其它字段继续原值更新 / 返回，避免只缺该列时连带丢失 codex/highConcurrency 等更新。
      const {
        allowNonConversationEndpointProviderFallback: _omitUpdate,
        ...updatesWithoutNonConversationFallback
      } = updates;
      const {
        allowNonConversationEndpointProviderFallback: _omitReturning,
        ...returningWithoutNonConversationFallback
      } = fullReturning;

      try {
        [updated] = await executor
          .update(systemSettings)
          .set(updatesWithoutNonConversationFallback)
          .where(eq(systemSettings.id, current.id))
          .returning(returningWithoutNonConversationFallback);
      } catch (nonConversationFallbackError) {
        if (!isUndefinedColumnError(nonConversationFallbackError)) {
          throw nonConversationFallbackError;
        }

        logger.warn(
          "system_settings 表除新增列外仍有列缺失，继续回退到 passThrough / highConcurrency 字段集更新。",
          { error: nonConversationFallbackError }
        );

        try {
          const withoutPassThroughUpdates = { ...updates };
          delete withoutPassThroughUpdates.passThroughUpstreamErrorMessage;
          [updated] = await executor
            .update(systemSettings)
            .set(withoutPassThroughUpdates)
            .where(eq(systemSettings.id, current.id))
            .returning(returningWithoutPassThrough);
        } catch (passThroughFallbackError) {
          if (!isUndefinedColumnError(passThroughFallbackError)) {
            throw passThroughFallbackError;
          }

          const downgradedUpdates = { ...updates };
          delete downgradedUpdates.passThroughUpstreamErrorMessage;
          delete downgradedUpdates.enableHighConcurrencyMode;
          delete downgradedUpdates.publicStatusWindowHours;
          delete downgradedUpdates.publicStatusAggregationIntervalMinutes;
          delete downgradedUpdates.ipExtractionConfig;
          delete downgradedUpdates.ipGeoLookupEnabled;

          const legacyUpdates = { ...downgradedUpdates };
          delete legacyUpdates.codexPriorityBillingSource;
          delete legacyUpdates.allowNonConversationEndpointProviderFallback;

          try {
            [updated] = await executor
              .update(systemSettings)
              .set(downgradedUpdates)
              .where(eq(systemSettings.id, current.id))
              .returning(returningWithoutHighConcurrencyMode);
          } catch (downgradedFallbackError) {
            if (!isUndefinedColumnError(downgradedFallbackError)) {
              throw downgradedFallbackError;
            }

            logger.warn(
              "system_settings 表缺少 codexPriorityBillingSource 之外的新列，继续降级重试。",
              { error: downgradedFallbackError }
            );

            [updated] = await executor
              .update(systemSettings)
              .set(legacyUpdates)
              .where(eq(systemSettings.id, current.id))
              .returning(returningWithoutCodexAndHighConcurrency);
          }

          if (!updated) {
            [updated] = await executor
              .update(systemSettings)
              .set(legacyUpdates)
              .where(eq(systemSettings.id, current.id))
              .returning(returningWithoutCodexAndHighConcurrency);
          }
        }
      }
    }

    if (!updated) {
      throw new Error("更新系统设置失败");
    }

    return toSystemSettings(updated);
  } catch (error) {
    if (isTableMissingError(error)) {
      throw new Error("系统设置数据表不存在，请先执行数据库迁移。");
    }
    if (isUndefinedColumnError(error)) {
      throw new Error("system_settings 表列缺失，请执行数据库迁移以升级数据库结构。");
    }
    throw error;
  }
}
