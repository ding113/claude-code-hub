"use server";

import { asc, eq } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/drizzle/db";
import { systemSettings } from "@/drizzle/schema";
import { logger } from "@/lib/logger";
import { DEFAULT_SITE_TITLE } from "@/lib/site-title";
import {
  DEFAULT_FAKE_STREAMING_WHITELIST,
  type SystemSettings,
  type UpdateSystemSettingsInput,
} from "@/types/system-config";
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
    billNonSuccessfulRequests: false,
    billHedgeLosers: true,
    timezone: null,
    enableAutoCleanup: false,
    cleanupRetentionDays: 30,
    cleanupSchedule: "0 2 * * *",
    cleanupBatchSize: 10000,
    enableClientVersionCheck: false,
    verboseProviderError: false,
    passThroughUpstreamErrorMessage: true,
    enableHttp2: false,
    enableOpenaiResponsesWebsocket: true,
    enableHighConcurrencyMode: false,
    interceptAnthropicWarmupRequests: false,
    enableThinkingSignatureRectifier: true,
    enableThinkingBudgetRectifier: true,
    enableThinkingEffortConflictRectifier: true,
    enableGeminiFunctionIdRectifier: true,
    enableBillingHeaderRectifier: true,
    enableResponseInputRectifier: true,
    allowNonConversationEndpointProviderFallback: true,
    fakeStreamingWhitelist: DEFAULT_FAKE_STREAMING_WHITELIST.map((entry) => ({
      model: entry.model,
      groupTags: [...entry.groupTags],
    })),
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
    streamGateMode: "enforce",
    affinityIgnoreClientSessionId: true,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// system_settings 列降级阶梯（数据驱动）
//
// 滚动部署期间线上 schema 可能落后于代码（新列尚未迁移）。读取 / 更新遇到
// 42703（列缺失）时按以下顺序逐层缩小字段集重试：
//   1. 全量字段集；
//   2. 近代新增列按引入顺序逐列累计剥离（RECENT_COLUMN_LADDER，最新列在最前）；
//   3. 历史世代字段集（passThrough -> highConcurrency -> codex 世代，已冻结）；
//   4. 仅读取链：最小核心字段集，缺失字段交给 toSystemSettings 补默认值。
//
// 新增 system_settings 列时，在 RECENT_COLUMN_LADDER 头部插入一项即可同时
// 接入读取与更新的降级链（全量字段集由 BASE + 阶梯自动合成）。
// ---------------------------------------------------------------------------

type SettingsSelection = Record<string, AnyPgColumn>;

// 引入逐列降级阶梯之前已存在的列（含历史世代字段集仍会选取的列）。
const BASE_SETTINGS_COLUMNS: SettingsSelection = {
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
  passThroughUpstreamErrorMessage: systemSettings.passThroughUpstreamErrorMessage,
  enableHighConcurrencyMode: systemSettings.enableHighConcurrencyMode,
  ipExtractionConfig: systemSettings.ipExtractionConfig,
  ipGeoLookupEnabled: systemSettings.ipGeoLookupEnabled,
};

// 近代新增列的降级阶梯：最新列在最前，第 N 层降级累计剥离前 N 项。
const RECENT_COLUMN_LADDER: ReadonlyArray<{
  key: string;
  column: AnyPgColumn;
  // 本层读取失败（仍有列缺失）时记录的告警
  selectWarn: string;
  // 本层更新失败（仍有列缺失）时记录的告警
  updateWarn: string;
}> = [
  {
    key: "affinityIgnoreClientSessionId",
    column: systemSettings.affinityIgnoreClientSessionId,
    selectWarn:
      "system_settings 表除 affinityIgnoreClientSessionId 外仍有列缺失，继续回退到上一代字段集。",
    updateWarn: "system_settings 表除 affinityIgnoreClientSessionId 外仍有列缺失，继续降级更新。",
  },
  {
    key: "streamGateMode",
    column: systemSettings.streamGateMode,
    selectWarn: "system_settings 表除 streamGateMode 外仍有列缺失，继续回退到上一代字段集。",
    updateWarn: "system_settings 表除 streamGateMode 外仍有列缺失，继续降级更新。",
  },
  {
    key: "enableGeminiFunctionIdRectifier",
    column: systemSettings.enableGeminiFunctionIdRectifier,
    selectWarn:
      "system_settings 表除 enableGeminiFunctionIdRectifier 外仍有列缺失，继续回退到上一代字段集。",
    updateWarn: "system_settings 表除 enableGeminiFunctionIdRectifier 外仍有列缺失，继续降级更新。",
  },
  {
    key: "enableThinkingEffortConflictRectifier",
    column: systemSettings.enableThinkingEffortConflictRectifier,
    selectWarn:
      "system_settings 表除 enableThinkingEffortConflictRectifier 外仍有列缺失，继续回退到上一代字段集。",
    updateWarn:
      "system_settings 表除 enableThinkingEffortConflictRectifier 外仍有列缺失，继续降级更新。",
  },
  {
    key: "billHedgeLosers",
    column: systemSettings.billHedgeLosers,
    selectWarn: "system_settings 表除 billHedgeLosers 外仍有列缺失，继续回退到上一代字段集。",
    updateWarn: "system_settings 表除 billHedgeLosers 外仍有列缺失，继续降级更新。",
  },
  {
    key: "billNonSuccessfulRequests",
    column: systemSettings.billNonSuccessfulRequests,
    selectWarn:
      "system_settings 表除 billNonSuccessfulRequests 外仍有列缺失，继续回退到上一代字段集。",
    updateWarn: "system_settings 表除 billNonSuccessfulRequests 外仍有列缺失，继续降级更新。",
  },
  {
    key: "enableOpenaiResponsesWebsocket",
    column: systemSettings.enableOpenaiResponsesWebsocket,
    selectWarn:
      "system_settings 表除 enableOpenaiResponsesWebsocket 外仍有列缺失，继续回退到上一代字段集。",
    updateWarn: "system_settings 表除 enableOpenaiResponsesWebsocket 外仍有列缺失，继续降级更新。",
  },
  {
    key: "fakeStreamingWhitelist",
    column: systemSettings.fakeStreamingWhitelist,
    selectWarn:
      "system_settings 表除 fakeStreamingWhitelist 外仍有列缺失，继续回退到上一代字段集。",
    updateWarn:
      "system_settings 表除 fakeStreamingWhitelist 外仍有列缺失，继续回退到 allowNonConversationEndpointProviderFallback 之外的字段集。",
  },
  {
    key: "allowNonConversationEndpointProviderFallback",
    column: systemSettings.allowNonConversationEndpointProviderFallback,
    selectWarn:
      "system_settings 表除新增列外仍有列缺失，继续回退到 withoutHighConcurrencyMode 字段集。",
    updateWarn:
      "system_settings 表除新增列外仍有列缺失，继续回退到 passThrough / highConcurrency 字段集更新。",
  },
];

// 历史世代字段集（冻结）：passThrough 世代之前的 schema 没有以下五列。
// 注意：世代字段集相对近代阶梯末层会重新选取更晚引入的列（与历史实现一致）。
const PASS_THROUGH_ERA_OMIT: readonly string[] = [
  "billHedgeLosers",
  "billNonSuccessfulRequests",
  "passThroughUpstreamErrorMessage",
  "fakeStreamingWhitelist",
  "enableOpenaiResponsesWebsocket",
];
const HIGH_CONCURRENCY_ERA_OMIT: readonly string[] = [
  ...PASS_THROUGH_ERA_OMIT,
  "enableHighConcurrencyMode",
  "ipExtractionConfig",
  "ipGeoLookupEnabled",
];
// 历史实现的不对称：读取链的 codex 世代保留 allowNonConversationEndpointProviderFallback，
// 更新链的 codex 世代连同剥离。
const CODEX_ERA_SELECT_OMIT: readonly string[] = [
  ...HIGH_CONCURRENCY_ERA_OMIT,
  "codexPriorityBillingSource",
];
const CODEX_ERA_RETURNING_OMIT: readonly string[] = [
  ...CODEX_ERA_SELECT_OMIT,
  "allowNonConversationEndpointProviderFallback",
];
// 最终回退：仅查询最小核心字段，剩余字段交给 toSystemSettings 补默认值。
const MINIMAL_SELECTION_KEYS: readonly string[] = [
  "id",
  "siteTitle",
  "allowGlobalUsageView",
  "currencyDisplay",
  "billingModelSource",
  "createdAt",
  "updatedAt",
];

function omitKeys<T extends Record<string, unknown>>(source: T, keys: readonly string[]): T {
  const result: Record<string, unknown> = { ...source };
  for (const key of keys) {
    delete result[key];
  }
  return result as T;
}

function pickKeys(source: SettingsSelection, keys: readonly string[]): SettingsSelection {
  const result: SettingsSelection = {};
  for (const key of keys) {
    result[key] = source[key];
  }
  return result;
}

function buildFullSettingsSelection(): SettingsSelection {
  const selection: SettingsSelection = { ...BASE_SETTINGS_COLUMNS };
  for (const rung of RECENT_COLUMN_LADDER) {
    selection[rung.key] = rung.column;
  }
  return selection;
}

type SelectAttempt = {
  selection: SettingsSelection;
  // 本层读取失败时记录的告警；最后一层不设告警，错误直接向上抛出。
  warnOnMissingColumn?: string;
};

function buildSelectAttempts(): SelectAttempt[] {
  const fullSelection = buildFullSettingsSelection();
  const attempts: SelectAttempt[] = [
    {
      selection: fullSelection,
      warnOnMissingColumn: "system_settings 表列缺失，使用降级字段集读取（建议运行数据库迁移）。",
    },
  ];

  const strippedKeys: string[] = [];
  for (const rung of RECENT_COLUMN_LADDER) {
    strippedKeys.push(rung.key);
    attempts.push({
      selection: omitKeys(fullSelection, strippedKeys),
      warnOnMissingColumn: rung.selectWarn,
    });
  }

  attempts.push(
    {
      selection: omitKeys(fullSelection, PASS_THROUGH_ERA_OMIT),
      warnOnMissingColumn:
        "system_settings 表缺少 passThroughUpstreamErrorMessage 之外的新列，继续降级读取。",
    },
    {
      selection: omitKeys(fullSelection, HIGH_CONCURRENCY_ERA_OMIT),
      warnOnMissingColumn: "system_settings 表存在多个缺失列，继续使用 legacy 字段集读取。",
    },
    {
      selection: omitKeys(fullSelection, CODEX_ERA_SELECT_OMIT),
      warnOnMissingColumn: "system_settings 表存在更多缺失列，继续使用最小字段集读取。",
    },
    { selection: pickKeys(fullSelection, MINIMAL_SELECTION_KEYS) }
  );

  return attempts;
}

async function selectSettingsRow() {
  for (const attempt of buildSelectAttempts()) {
    try {
      const [row] = await db
        .select(attempt.selection)
        .from(systemSettings)
        .orderBy(asc(systemSettings.id))
        .limit(1);
      return row ?? null;
    } catch (error) {
      // 兼容旧版本数据库：system_settings 表存在但列未迁移齐全。
      // 没有告警文案说明已是最低字段集，错误向上抛出。
      if (attempt.warnOnMissingColumn === undefined || !isUndefinedColumnError(error)) {
        throw error;
      }
      logger.warn(attempt.warnOnMissingColumn, { error });
    }
  }

  throw new Error("system_settings 降级读取链意外耗尽");
}

/**
 * 获取系统设置，如果不存在则创建默认记录
 */
export async function getSystemSettings(): Promise<SystemSettings> {
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

// 近代阶梯全部失败后的历史世代降级更新（passThrough -> highConcurrency -> codex）。
async function runLegacyUpdateFallbacks(
  executor: SystemSettingsMutationExecutor,
  settingsId: number,
  prunedUpdates: Partial<typeof systemSettings.$inferInsert>
) {
  const fullSelection = buildFullSettingsSelection();
  const returningWithoutPassThrough = omitKeys(fullSelection, PASS_THROUGH_ERA_OMIT);
  const returningWithoutHighConcurrencyMode = omitKeys(fullSelection, HIGH_CONCURRENCY_ERA_OMIT);
  const returningWithoutCodexAndHighConcurrency = omitKeys(fullSelection, CODEX_ERA_RETURNING_OMIT);

  let updated;
  try {
    // 从已剥离近代列的对象继续裁剪，避免把新列重新带回旧 schema 再次失败。
    const withoutPassThroughUpdates = omitKeys(prunedUpdates, ["passThroughUpstreamErrorMessage"]);
    [updated] = await executor
      .update(systemSettings)
      .set(withoutPassThroughUpdates)
      .where(eq(systemSettings.id, settingsId))
      .returning(returningWithoutPassThrough);
  } catch (passThroughFallbackError) {
    if (!isUndefinedColumnError(passThroughFallbackError)) {
      throw passThroughFallbackError;
    }

    const downgradedUpdates = omitKeys(prunedUpdates, [
      "passThroughUpstreamErrorMessage",
      "enableHighConcurrencyMode",
      "publicStatusWindowHours",
      "publicStatusAggregationIntervalMinutes",
      "ipExtractionConfig",
      "ipGeoLookupEnabled",
    ]);
    const legacyUpdates = omitKeys(downgradedUpdates, ["codexPriorityBillingSource"]);

    try {
      [updated] = await executor
        .update(systemSettings)
        .set(downgradedUpdates)
        .where(eq(systemSettings.id, settingsId))
        .returning(returningWithoutHighConcurrencyMode);
    } catch (downgradedFallbackError) {
      if (!isUndefinedColumnError(downgradedFallbackError)) {
        throw downgradedFallbackError;
      }

      logger.warn("system_settings 表缺少 codexPriorityBillingSource 之外的新列，继续降级重试。", {
        error: downgradedFallbackError,
      });

      [updated] = await executor
        .update(systemSettings)
        .set(legacyUpdates)
        .where(eq(systemSettings.id, settingsId))
        .returning(returningWithoutCodexAndHighConcurrency);
    }

    if (!updated) {
      [updated] = await executor
        .update(systemSettings)
        .set(legacyUpdates)
        .where(eq(systemSettings.id, settingsId))
        .returning(returningWithoutCodexAndHighConcurrency);
    }
  }

  return updated;
}

/**
 * 更新系统设置
 */
export async function updateSystemSettings(
  payload: UpdateSystemSettingsInput,
  executor: SystemSettingsMutationExecutor = db
): Promise<SystemSettings> {
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

    // 非成功请求按 token 用量计费开关（如果提供）
    if (payload.billNonSuccessfulRequests !== undefined) {
      updates.billNonSuccessfulRequests = payload.billNonSuccessfulRequests;
    }

    // 供应商竞速输家计费开关（如果提供）
    if (payload.billHedgeLosers !== undefined) {
      updates.billHedgeLosers = payload.billHedgeLosers;
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

    // OpenAI Responses WebSocket 开关（如果提供）
    if (payload.enableOpenaiResponsesWebsocket !== undefined) {
      updates.enableOpenaiResponsesWebsocket = payload.enableOpenaiResponsesWebsocket;
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

    // thinking effort 冲突整流器开关（如果提供）
    if (payload.enableThinkingEffortConflictRectifier !== undefined) {
      updates.enableThinkingEffortConflictRectifier = payload.enableThinkingEffortConflictRectifier;
    }

    // Gemini function id 整流器开关（如果提供）
    if (payload.enableGeminiFunctionIdRectifier !== undefined) {
      updates.enableGeminiFunctionIdRectifier = payload.enableGeminiFunctionIdRectifier;
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

    // Fake 流式输出白名单（如果提供；空数组表示显式禁用，null 留待 transformer 落默认）
    if (payload.fakeStreamingWhitelist !== undefined) {
      updates.fakeStreamingWhitelist = payload.fakeStreamingWhitelist;
    }

    // F1 流式内容门控模式（如果提供）
    if (payload.streamGateMode !== undefined) {
      updates.streamGateMode = payload.streamGateMode;
    }

    // 忽略客户端 Session ID 开关（如果提供）
    if (payload.affinityIgnoreClientSessionId !== undefined) {
      updates.affinityIgnoreClientSessionId = payload.affinityIgnoreClientSessionId;
    }

    let updated;
    try {
      [updated] = await executor
        .update(systemSettings)
        .set(updates)
        .where(eq(systemSettings.id, current.id))
        .returning(buildFullSettingsSelection());
    } catch (error) {
      if (!isUndefinedColumnError(error)) {
        throw error;
      }

      logger.warn("system_settings 表列缺失，使用降级字段集更新系统设置。", {
        error,
      });

      // 按阶梯逐层剥离近代新增列重试；某层命中行则停止，
      // 命中空结果（列齐全但行不匹配）则静默继续向下尝试。
      let prunedUpdates = updates;
      let prunedReturning = buildFullSettingsSelection();
      for (let index = 0; index < RECENT_COLUMN_LADDER.length; index++) {
        const rung = RECENT_COLUMN_LADDER[index];
        prunedUpdates = omitKeys(prunedUpdates, [rung.key]);
        prunedReturning = omitKeys(prunedReturning, [rung.key]);

        if (updated) {
          continue;
        }

        try {
          [updated] = await executor
            .update(systemSettings)
            .set(prunedUpdates)
            .where(eq(systemSettings.id, current.id))
            .returning(prunedReturning);
        } catch (rungError) {
          if (!isUndefinedColumnError(rungError)) {
            throw rungError;
          }

          logger.warn(rung.updateWarn, { error: rungError });

          if (index === RECENT_COLUMN_LADDER.length - 1) {
            updated = await runLegacyUpdateFallbacks(executor, current.id, prunedUpdates);
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
