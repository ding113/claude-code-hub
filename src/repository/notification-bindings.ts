"use server";

import { and, desc, eq, notInArray } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { notificationTargetBindings, webhookTargets } from "@/drizzle/schema";
import type { WebhookProviderType, WebhookTarget, WebhookTestResult } from "./webhook-targets";

export type NotificationType = "circuit_breaker" | "daily_leaderboard" | "cost_alert";

const DEFAULT_TIMEZONE = "Asia/Shanghai";

export interface NotificationBinding {
  id: number;
  notificationType: NotificationType;
  targetId: number;
  isEnabled: boolean;
  scheduleCron: string | null;
  scheduleTimezone: string | null;
  templateOverride: Record<string, unknown> | null;
  createdAt: Date | null;
}

export interface NotificationBindingWithTarget extends NotificationBinding {
  target: WebhookTarget;
}

export interface BindingInput {
  targetId: number;
  isEnabled?: boolean;
  scheduleCron?: string | null;
  scheduleTimezone?: string | null;
  templateOverride?: Record<string, unknown> | null;
}

const BINDING_WITH_TARGET_SELECT = {
  bindingId: notificationTargetBindings.id,
  bindingNotificationType: notificationTargetBindings.notificationType,
  bindingTargetId: notificationTargetBindings.targetId,
  bindingIsEnabled: notificationTargetBindings.isEnabled,
  bindingScheduleCron: notificationTargetBindings.scheduleCron,
  bindingScheduleTimezone: notificationTargetBindings.scheduleTimezone,
  bindingTemplateOverride: notificationTargetBindings.templateOverride,
  bindingCreatedAt: notificationTargetBindings.createdAt,

  targetId: webhookTargets.id,
  targetName: webhookTargets.name,
  targetProviderType: webhookTargets.providerType,
  targetWebhookUrl: webhookTargets.webhookUrl,
  targetTelegramBotToken: webhookTargets.telegramBotToken,
  targetTelegramChatId: webhookTargets.telegramChatId,
  targetDingtalkSecret: webhookTargets.dingtalkSecret,
  targetCustomTemplate: webhookTargets.customTemplate,
  targetCustomHeaders: webhookTargets.customHeaders,
  targetProxyUrl: webhookTargets.proxyUrl,
  targetProxyFallbackToDirect: webhookTargets.proxyFallbackToDirect,
  targetIsEnabled: webhookTargets.isEnabled,
  targetLastTestAt: webhookTargets.lastTestAt,
  targetLastTestResult: webhookTargets.lastTestResult,
  targetCreatedAt: webhookTargets.createdAt,
  targetUpdatedAt: webhookTargets.updatedAt,
};

type BindingWithTargetRow = {
  bindingId: number;
  bindingNotificationType: unknown;
  bindingTargetId: number;
  bindingIsEnabled: boolean | null;
  bindingScheduleCron: string | null;
  bindingScheduleTimezone: string | null;
  bindingTemplateOverride: unknown;
  bindingCreatedAt: Date | null;

  targetId: number;
  targetName: string;
  targetProviderType: unknown;
  targetWebhookUrl: string | null;
  targetTelegramBotToken: string | null;
  targetTelegramChatId: string | null;
  targetDingtalkSecret: string | null;
  targetCustomTemplate: unknown;
  targetCustomHeaders: unknown;
  targetProxyUrl: string | null;
  targetProxyFallbackToDirect: boolean | null;
  targetIsEnabled: boolean | null;
  targetLastTestAt: Date | null;
  targetLastTestResult: unknown;
  targetCreatedAt: Date | null;
  targetUpdatedAt: Date | null;
};

function mapBindingRow(row: BindingWithTargetRow): NotificationBindingWithTarget {
  return {
    id: row.bindingId,
    notificationType: row.bindingNotificationType as NotificationType,
    targetId: row.bindingTargetId,
    isEnabled: row.bindingIsEnabled ?? true,
    scheduleCron: row.bindingScheduleCron ?? null,
    scheduleTimezone: row.bindingScheduleTimezone ?? null,
    templateOverride: (row.bindingTemplateOverride as Record<string, unknown> | null) ?? null,
    createdAt: row.bindingCreatedAt ?? null,
    target: {
      id: row.targetId,
      name: row.targetName,
      providerType: row.targetProviderType as WebhookProviderType,
      webhookUrl: row.targetWebhookUrl ?? null,
      telegramBotToken: row.targetTelegramBotToken ?? null,
      telegramChatId: row.targetTelegramChatId ?? null,
      dingtalkSecret: row.targetDingtalkSecret ?? null,
      customTemplate: (row.targetCustomTemplate as Record<string, unknown> | null) ?? null,
      customHeaders: (row.targetCustomHeaders as Record<string, string> | null) ?? null,
      proxyUrl: row.targetProxyUrl ?? null,
      proxyFallbackToDirect: row.targetProxyFallbackToDirect ?? false,
      isEnabled: row.targetIsEnabled ?? true,
      lastTestAt: row.targetLastTestAt ?? null,
      lastTestResult: (row.targetLastTestResult as WebhookTestResult | null) ?? null,
      createdAt: row.targetCreatedAt ?? null,
      updatedAt: row.targetUpdatedAt ?? null,
    },
  };
}

export async function getBindingById(id: number): Promise<NotificationBinding | null> {
  const [row] = await db
    .select()
    .from(notificationTargetBindings)
    .where(eq(notificationTargetBindings.id, id))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    notificationType: row.notificationType as NotificationType,
    targetId: row.targetId,
    isEnabled: row.isEnabled ?? true,
    scheduleCron: row.scheduleCron ?? null,
    scheduleTimezone: row.scheduleTimezone ?? null,
    templateOverride: (row.templateOverride as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt ?? null,
  };
}

export async function getBindingsByType(
  type: NotificationType
): Promise<NotificationBindingWithTarget[]> {
  const rows = await db
    .select(BINDING_WITH_TARGET_SELECT)
    .from(notificationTargetBindings)
    .innerJoin(webhookTargets, eq(notificationTargetBindings.targetId, webhookTargets.id))
    .where(eq(notificationTargetBindings.notificationType, type))
    .orderBy(desc(notificationTargetBindings.id));

  return rows.map((row) => mapBindingRow(row as BindingWithTargetRow));
}

export async function upsertBindings(
  type: NotificationType,
  bindings: BindingInput[]
): Promise<void> {
  const normalized = bindings
    .map((b) => ({
      targetId: b.targetId,
      isEnabled: b.isEnabled ?? true,
      scheduleCron: b.scheduleCron ?? null,
      scheduleTimezone: b.scheduleTimezone ?? DEFAULT_TIMEZONE,
      templateOverride: b.templateOverride ?? null,
    }))
    .filter((b) => Number.isFinite(b.targetId) && b.targetId > 0);

  const targetIds = Array.from(new Set(normalized.map((b) => b.targetId)));

  await db.transaction(async (tx) => {
    // 删除不存在的绑定（按类型维度）
    if (targetIds.length === 0) {
      await tx
        .delete(notificationTargetBindings)
        .where(eq(notificationTargetBindings.notificationType, type));
    } else {
      await tx
        .delete(notificationTargetBindings)
        .where(
          and(
            eq(notificationTargetBindings.notificationType, type),
            notInArray(notificationTargetBindings.targetId, targetIds)
          )
        );
    }

    // Upsert 目标绑定
    for (const binding of normalized) {
      await tx
        .insert(notificationTargetBindings)
        .values({
          notificationType: type,
          targetId: binding.targetId,
          isEnabled: binding.isEnabled,
          scheduleCron: binding.scheduleCron,
          scheduleTimezone: binding.scheduleTimezone,
          templateOverride: binding.templateOverride,
        })
        .onConflictDoUpdate({
          target: [
            notificationTargetBindings.notificationType,
            notificationTargetBindings.targetId,
          ],
          set: {
            isEnabled: binding.isEnabled,
            scheduleCron: binding.scheduleCron,
            scheduleTimezone: binding.scheduleTimezone,
            templateOverride: binding.templateOverride,
          },
        });
    }
  });
}

export async function deleteBindingsForTarget(targetId: number): Promise<void> {
  await db
    .delete(notificationTargetBindings)
    .where(eq(notificationTargetBindings.targetId, targetId));
}

export async function getEnabledBindingsByType(
  type: NotificationType
): Promise<NotificationBindingWithTarget[]> {
  const rows = await db
    .select(BINDING_WITH_TARGET_SELECT)
    .from(notificationTargetBindings)
    .innerJoin(webhookTargets, eq(notificationTargetBindings.targetId, webhookTargets.id))
    .where(
      and(
        eq(notificationTargetBindings.notificationType, type),
        eq(notificationTargetBindings.isEnabled, true),
        eq(webhookTargets.isEnabled, true)
      )
    )
    .orderBy(desc(notificationTargetBindings.id));

  return rows.map((row) => mapBindingRow(row as BindingWithTargetRow));
}
