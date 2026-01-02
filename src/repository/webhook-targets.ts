"use server";

import { desc, eq } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { webhookTargets } from "@/drizzle/schema";

export type WebhookProviderType = "wechat" | "feishu" | "dingtalk" | "telegram" | "custom";

export interface WebhookTestResult {
  success: boolean;
  error?: string;
  latencyMs?: number;
}

export interface WebhookTarget {
  id: number;
  name: string;
  providerType: WebhookProviderType;

  webhookUrl: string | null;

  telegramBotToken: string | null;
  telegramChatId: string | null;

  dingtalkSecret: string | null;

  customTemplate: Record<string, unknown> | null;
  customHeaders: Record<string, string> | null;

  proxyUrl: string | null;
  proxyFallbackToDirect: boolean;

  isEnabled: boolean;
  lastTestAt: Date | null;
  lastTestResult: WebhookTestResult | null;

  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface CreateWebhookTargetData {
  name: string;
  providerType: WebhookProviderType;

  webhookUrl?: string | null;

  telegramBotToken?: string | null;
  telegramChatId?: string | null;

  dingtalkSecret?: string | null;

  customTemplate?: Record<string, unknown> | null;
  customHeaders?: Record<string, string> | null;

  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean;

  isEnabled?: boolean;
}

export type UpdateWebhookTargetData = Partial<CreateWebhookTargetData>;

function toWebhookTarget(row: typeof webhookTargets.$inferSelect): WebhookTarget {
  return {
    id: row.id,
    name: row.name,
    providerType: row.providerType as WebhookProviderType,
    webhookUrl: row.webhookUrl ?? null,
    telegramBotToken: row.telegramBotToken ?? null,
    telegramChatId: row.telegramChatId ?? null,
    dingtalkSecret: row.dingtalkSecret ?? null,
    customTemplate: (row.customTemplate as Record<string, unknown> | null) ?? null,
    customHeaders: (row.customHeaders as Record<string, string> | null) ?? null,
    proxyUrl: row.proxyUrl ?? null,
    proxyFallbackToDirect: row.proxyFallbackToDirect ?? false,
    isEnabled: row.isEnabled ?? true,
    lastTestAt: row.lastTestAt ?? null,
    lastTestResult: (row.lastTestResult as WebhookTestResult | null) ?? null,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

export async function getAllWebhookTargets(): Promise<WebhookTarget[]> {
  const rows = await db.select().from(webhookTargets).orderBy(desc(webhookTargets.id));
  return rows.map(toWebhookTarget);
}

export async function getWebhookTargetById(id: number): Promise<WebhookTarget | null> {
  const [row] = await db.select().from(webhookTargets).where(eq(webhookTargets.id, id)).limit(1);
  return row ? toWebhookTarget(row) : null;
}

export async function createWebhookTarget(data: CreateWebhookTargetData): Promise<WebhookTarget> {
  const now = new Date();

  const [created] = await db
    .insert(webhookTargets)
    .values({
      name: data.name,
      providerType: data.providerType,
      webhookUrl: data.webhookUrl ?? null,
      telegramBotToken: data.telegramBotToken ?? null,
      telegramChatId: data.telegramChatId ?? null,
      dingtalkSecret: data.dingtalkSecret ?? null,
      customTemplate: data.customTemplate ?? null,
      customHeaders: data.customHeaders ?? null,
      proxyUrl: data.proxyUrl ?? null,
      proxyFallbackToDirect: data.proxyFallbackToDirect ?? false,
      isEnabled: data.isEnabled ?? true,
      updatedAt: now,
    })
    .returning();

  if (!created) {
    throw new Error("创建 Webhook 目标失败");
  }

  return toWebhookTarget(created);
}

export async function updateWebhookTarget(
  id: number,
  data: UpdateWebhookTargetData
): Promise<WebhookTarget> {
  const now = new Date();

  const [updated] = await db
    .update(webhookTargets)
    .set({
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.providerType !== undefined ? { providerType: data.providerType } : {}),
      ...(data.webhookUrl !== undefined ? { webhookUrl: data.webhookUrl } : {}),
      ...(data.telegramBotToken !== undefined ? { telegramBotToken: data.telegramBotToken } : {}),
      ...(data.telegramChatId !== undefined ? { telegramChatId: data.telegramChatId } : {}),
      ...(data.dingtalkSecret !== undefined ? { dingtalkSecret: data.dingtalkSecret } : {}),
      ...(data.customTemplate !== undefined ? { customTemplate: data.customTemplate } : {}),
      ...(data.customHeaders !== undefined ? { customHeaders: data.customHeaders } : {}),
      ...(data.proxyUrl !== undefined ? { proxyUrl: data.proxyUrl } : {}),
      ...(data.proxyFallbackToDirect !== undefined
        ? { proxyFallbackToDirect: data.proxyFallbackToDirect }
        : {}),
      ...(data.isEnabled !== undefined ? { isEnabled: data.isEnabled } : {}),
      updatedAt: now,
    })
    .where(eq(webhookTargets.id, id))
    .returning();

  if (!updated) {
    throw new Error("更新 Webhook 目标失败");
  }

  return toWebhookTarget(updated);
}

export async function deleteWebhookTarget(id: number): Promise<void> {
  await db.delete(webhookTargets).where(eq(webhookTargets.id, id));
}

export async function updateTestResult(id: number, result: WebhookTestResult): Promise<void> {
  const now = new Date();
  await db
    .update(webhookTargets)
    .set({
      lastTestAt: now,
      lastTestResult: result,
      updatedAt: now,
    })
    .where(eq(webhookTargets.id, id));
}
