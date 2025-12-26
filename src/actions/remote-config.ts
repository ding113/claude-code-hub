"use server";

import { z } from "zod";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { findRemoteConfigSyncByKey } from "@/repository/remote-config";
import type { RemoteConfigSync } from "@/types/remote-config";
import type { ActionResult } from "./types";

const ConfigKeySchema = z.string().trim().min(1).max(64);

function isAdminSession(session: Awaited<ReturnType<typeof getSession>>): boolean {
  return Boolean(session && session.user.role === "admin");
}

function zodErrorToMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => issue.message).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

export async function getRemoteConfigSyncStatus(
  configKey: string
): Promise<ActionResult<RemoteConfigSync | null>> {
  try {
    const session = await getSession();
    if (!isAdminSession(session)) {
      return { ok: false, error: "无权限执行此操作" };
    }

    const validatedKey = ConfigKeySchema.parse(configKey);
    const row = await findRemoteConfigSyncByKey(validatedKey);
    return { ok: true, data: row };
  } catch (error) {
    logger.error("[remote-config.getRemoteConfigSyncStatus] failed", { error });
    return { ok: false, error: zodErrorToMessage(error) };
  }
}
