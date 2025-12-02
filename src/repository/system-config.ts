"use server";

import { eq } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { systemSettings } from "@/drizzle/schema";
import { logger } from "@/lib/logger";
import type { SystemSettings, UpdateSystemSettingsInput } from "@/types/system-config";
import { toSystemSettings } from "./_shared/transformers";

const DEFAULT_SITE_TITLE = "Claude Code Hub";

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

function createFallbackSettings(): SystemSettings {
  const now = new Date();
  return {
    id: 0,
    siteTitle: DEFAULT_SITE_TITLE,
    allowGlobalUsageView: false,
    currencyDisplay: "USD",
    billingModelSource: "original",
    enableAutoCleanup: false,
    cleanupRetentionDays: 30,
    cleanupSchedule: "0 2 * * *",
    cleanupBatchSize: 10000,
    enableClientVersionCheck: false,
    verboseProviderError: false,
    enableHttp2: false,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 获取系统设置，如果不存在则创建默认记录
 */
export async function getSystemSettings(): Promise<SystemSettings> {
  try {
    const [settings] = await db
      .select({
        id: systemSettings.id,
        siteTitle: systemSettings.siteTitle,
        allowGlobalUsageView: systemSettings.allowGlobalUsageView,
        currencyDisplay: systemSettings.currencyDisplay,
        billingModelSource: systemSettings.billingModelSource,
        enableAutoCleanup: systemSettings.enableAutoCleanup,
        cleanupRetentionDays: systemSettings.cleanupRetentionDays,
        cleanupSchedule: systemSettings.cleanupSchedule,
        cleanupBatchSize: systemSettings.cleanupBatchSize,
        enableClientVersionCheck: systemSettings.enableClientVersionCheck,
        verboseProviderError: systemSettings.verboseProviderError,
        enableHttp2: systemSettings.enableHttp2,
        createdAt: systemSettings.createdAt,
        updatedAt: systemSettings.updatedAt,
      })
      .from(systemSettings)
      .limit(1);

    if (settings) {
      return toSystemSettings(settings);
    }

    const [created] = await db
      .insert(systemSettings)
      .values({
        siteTitle: DEFAULT_SITE_TITLE,
        allowGlobalUsageView: false,
        currencyDisplay: "USD",
        billingModelSource: "original",
      })
      .onConflictDoNothing()
      .returning({
        id: systemSettings.id,
        siteTitle: systemSettings.siteTitle,
        allowGlobalUsageView: systemSettings.allowGlobalUsageView,
        currencyDisplay: systemSettings.currencyDisplay,
        billingModelSource: systemSettings.billingModelSource,
        enableAutoCleanup: systemSettings.enableAutoCleanup,
        cleanupRetentionDays: systemSettings.cleanupRetentionDays,
        cleanupSchedule: systemSettings.cleanupSchedule,
        cleanupBatchSize: systemSettings.cleanupBatchSize,
        enableClientVersionCheck: systemSettings.enableClientVersionCheck,
        verboseProviderError: systemSettings.verboseProviderError,
        enableHttp2: systemSettings.enableHttp2,
        createdAt: systemSettings.createdAt,
        updatedAt: systemSettings.updatedAt,
      });

    if (created) {
      return toSystemSettings(created);
    }

    // 如果并发导致没有返回，重新查询一次
    const [fallback] = await db
      .select({
        id: systemSettings.id,
        siteTitle: systemSettings.siteTitle,
        allowGlobalUsageView: systemSettings.allowGlobalUsageView,
        currencyDisplay: systemSettings.currencyDisplay,
        billingModelSource: systemSettings.billingModelSource,
        enableAutoCleanup: systemSettings.enableAutoCleanup,
        cleanupRetentionDays: systemSettings.cleanupRetentionDays,
        cleanupSchedule: systemSettings.cleanupSchedule,
        cleanupBatchSize: systemSettings.cleanupBatchSize,
        enableClientVersionCheck: systemSettings.enableClientVersionCheck,
        verboseProviderError: systemSettings.verboseProviderError,
        enableHttp2: systemSettings.enableHttp2,
        createdAt: systemSettings.createdAt,
        updatedAt: systemSettings.updatedAt,
      })
      .from(systemSettings)
      .limit(1);

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
  payload: UpdateSystemSettingsInput
): Promise<SystemSettings> {
  const current = await getSystemSettings();

  try {
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

    // HTTP/2 配置字段（如果提供）
    if (payload.enableHttp2 !== undefined) {
      updates.enableHttp2 = payload.enableHttp2;
    }

    const [updated] = await db
      .update(systemSettings)
      .set(updates)
      .where(eq(systemSettings.id, current.id))
      .returning({
        id: systemSettings.id,
        siteTitle: systemSettings.siteTitle,
        allowGlobalUsageView: systemSettings.allowGlobalUsageView,
        currencyDisplay: systemSettings.currencyDisplay,
        billingModelSource: systemSettings.billingModelSource,
        enableAutoCleanup: systemSettings.enableAutoCleanup,
        cleanupRetentionDays: systemSettings.cleanupRetentionDays,
        cleanupSchedule: systemSettings.cleanupSchedule,
        cleanupBatchSize: systemSettings.cleanupBatchSize,
        enableClientVersionCheck: systemSettings.enableClientVersionCheck,
        verboseProviderError: systemSettings.verboseProviderError,
        enableHttp2: systemSettings.enableHttp2,
        createdAt: systemSettings.createdAt,
        updatedAt: systemSettings.updatedAt,
      });

    if (!updated) {
      throw new Error("更新系统设置失败");
    }

    return toSystemSettings(updated);
  } catch (error) {
    if (isTableMissingError(error)) {
      throw new Error("系统设置数据表不存在，请先执行数据库迁移。");
    }
    throw error;
  }
}
