"use server";

import { z } from "zod";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { scheduleNotifications } from "@/lib/notification/notification-queue";
import {
  type BindingInput,
  getBindingsByType,
  type NotificationBindingWithTarget,
  type NotificationType,
  upsertBindings,
} from "@/repository/notification-bindings";
import type { ActionResult } from "./types";

const NotificationTypeSchema = z.enum(["circuit_breaker", "daily_leaderboard", "cost_alert"]);

const BindingInputSchema: z.ZodType<BindingInput> = z.object({
  targetId: z.number().int().positive(),
  isEnabled: z.boolean().optional(),
  scheduleCron: z.string().trim().max(100).optional().nullable(),
  scheduleTimezone: z.string().trim().max(50).optional().nullable(),
  templateOverride: z.record(z.string(), z.unknown()).optional().nullable(),
});

export async function getBindingsForTypeAction(
  type: NotificationType
): Promise<ActionResult<NotificationBindingWithTarget[]>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限访问通知绑定" };
    }

    const validatedType = NotificationTypeSchema.parse(type) as NotificationType;
    const bindings = await getBindingsByType(validatedType);
    return { ok: true, data: bindings };
  } catch (error) {
    logger.error("获取通知绑定失败:", error);
    const message = error instanceof Error ? error.message : "获取通知绑定失败";
    return { ok: false, error: message };
  }
}

export async function updateBindingsAction(
  type: NotificationType,
  bindings: BindingInput[]
): Promise<ActionResult<void>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validatedType = NotificationTypeSchema.parse(type) as NotificationType;
    const validatedBindings = z.array(BindingInputSchema).parse(bindings);

    await upsertBindings(validatedType, validatedBindings);
    await scheduleNotifications();
    return { ok: true, data: undefined };
  } catch (error) {
    logger.error("更新通知绑定失败:", error);
    const message = error instanceof Error ? error.message : "更新通知绑定失败";
    return { ok: false, error: message };
  }
}
