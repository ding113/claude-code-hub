"use server";

import { eq } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { notificationSettings } from "@/drizzle/schema";
import { logger } from "@/lib/logger";

/**
 * 通知设置类型
 */
export interface NotificationSettings {
  id: number;
  enabled: boolean;

  // 熔断器告警配置
  circuitBreakerEnabled: boolean;
  circuitBreakerWebhook: string | null;

  // 每日排行榜配置
  dailyLeaderboardEnabled: boolean;
  dailyLeaderboardWebhook: string | null;
  dailyLeaderboardTime: string | null;
  dailyLeaderboardTopN: number | null;

  // 成本预警配置
  costAlertEnabled: boolean;
  costAlertWebhook: string | null;
  costAlertThreshold: string | null; // numeric 类型作为 string
  costAlertCheckInterval: number | null;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * 更新通知设置输入
 */
export interface UpdateNotificationSettingsInput {
  enabled?: boolean;

  circuitBreakerEnabled?: boolean;
  circuitBreakerWebhook?: string | null;

  dailyLeaderboardEnabled?: boolean;
  dailyLeaderboardWebhook?: string | null;
  dailyLeaderboardTime?: string;
  dailyLeaderboardTopN?: number;

  costAlertEnabled?: boolean;
  costAlertWebhook?: string | null;
  costAlertThreshold?: string;
  costAlertCheckInterval?: number;
}

/**
 * 检查是否是表缺失错误
 */
function isTableMissingError(error: unknown, depth = 0): boolean {
  if (!error || depth > 5) {
    return false;
  }

  if (typeof error === "string") {
    const normalized = error.toLowerCase();
    return (
      normalized.includes("42p01") ||
      (normalized.includes("notification_settings") &&
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

/**
 * 创建默认通知设置
 */
function createFallbackSettings(): NotificationSettings {
  const now = new Date();
  return {
    id: 0,
    enabled: false,
    circuitBreakerEnabled: false,
    circuitBreakerWebhook: null,
    dailyLeaderboardEnabled: false,
    dailyLeaderboardWebhook: null,
    dailyLeaderboardTime: "09:00",
    dailyLeaderboardTopN: 5,
    costAlertEnabled: false,
    costAlertWebhook: null,
    costAlertThreshold: "0.80",
    costAlertCheckInterval: 60,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 获取通知设置，如果不存在则创建默认记录
 */
export async function getNotificationSettings(): Promise<NotificationSettings> {
  try {
    const [settings] = await db.select().from(notificationSettings).limit(1);

    if (settings) {
      return {
        ...settings,
        createdAt: settings.createdAt ?? new Date(),
        updatedAt: settings.updatedAt ?? new Date(),
      };
    }

    // 创建默认设置
    const [created] = await db
      .insert(notificationSettings)
      .values({
        enabled: false,
        circuitBreakerEnabled: false,
        dailyLeaderboardEnabled: false,
        dailyLeaderboardTime: "09:00",
        dailyLeaderboardTopN: 5,
        costAlertEnabled: false,
        costAlertThreshold: "0.80",
        costAlertCheckInterval: 60,
      })
      .onConflictDoNothing()
      .returning();

    if (created) {
      return {
        ...created,
        createdAt: created.createdAt ?? new Date(),
        updatedAt: created.updatedAt ?? new Date(),
      };
    }

    // 如果并发导致没有返回，重新查询一次
    const [fallback] = await db.select().from(notificationSettings).limit(1);

    if (!fallback) {
      throw new Error("Failed to initialize notification settings");
    }

    return {
      ...fallback,
      createdAt: fallback.createdAt ?? new Date(),
      updatedAt: fallback.updatedAt ?? new Date(),
    };
  } catch (error) {
    if (isTableMissingError(error)) {
      logger.warn("notification_settings 表不存在，返回默认配置。请运行数据库迁移。", { error });
      return createFallbackSettings();
    }
    throw error;
  }
}

/**
 * 更新通知设置
 */
export async function updateNotificationSettings(
  payload: UpdateNotificationSettingsInput
): Promise<NotificationSettings> {
  const current = await getNotificationSettings();

  try {
    // 构建更新对象，只更新提供的字段
    const updates: Partial<typeof notificationSettings.$inferInsert> = {
      updatedAt: new Date(),
    };

    // 全局开关
    if (payload.enabled !== undefined) {
      updates.enabled = payload.enabled;
    }

    // 熔断器告警配置
    if (payload.circuitBreakerEnabled !== undefined) {
      updates.circuitBreakerEnabled = payload.circuitBreakerEnabled;
    }
    if (payload.circuitBreakerWebhook !== undefined) {
      updates.circuitBreakerWebhook = payload.circuitBreakerWebhook;
    }

    // 每日排行榜配置
    if (payload.dailyLeaderboardEnabled !== undefined) {
      updates.dailyLeaderboardEnabled = payload.dailyLeaderboardEnabled;
    }
    if (payload.dailyLeaderboardWebhook !== undefined) {
      updates.dailyLeaderboardWebhook = payload.dailyLeaderboardWebhook;
    }
    if (payload.dailyLeaderboardTime !== undefined) {
      updates.dailyLeaderboardTime = payload.dailyLeaderboardTime;
    }
    if (payload.dailyLeaderboardTopN !== undefined) {
      updates.dailyLeaderboardTopN = payload.dailyLeaderboardTopN;
    }

    // 成本预警配置
    if (payload.costAlertEnabled !== undefined) {
      updates.costAlertEnabled = payload.costAlertEnabled;
    }
    if (payload.costAlertWebhook !== undefined) {
      updates.costAlertWebhook = payload.costAlertWebhook;
    }
    if (payload.costAlertThreshold !== undefined) {
      updates.costAlertThreshold = payload.costAlertThreshold;
    }
    if (payload.costAlertCheckInterval !== undefined) {
      updates.costAlertCheckInterval = payload.costAlertCheckInterval;
    }

    const [updated] = await db
      .update(notificationSettings)
      .set(updates)
      .where(eq(notificationSettings.id, current.id))
      .returning();

    if (!updated) {
      throw new Error("更新通知设置失败");
    }

    return {
      ...updated,
      createdAt: updated.createdAt ?? new Date(),
      updatedAt: updated.updatedAt ?? new Date(),
    };
  } catch (error) {
    if (isTableMissingError(error)) {
      throw new Error("通知设置数据表不存在，请先执行数据库迁移。");
    }
    throw error;
  }
}
