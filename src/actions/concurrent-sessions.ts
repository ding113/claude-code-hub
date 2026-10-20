"use server";

import { logger } from "@/lib/logger";
import { SessionTracker } from "@/lib/session-tracker";
import type { ActionResult } from "./types";

/**
 * 获取当前并发 session 数量（5分钟窗口）
 */
export async function getConcurrentSessions(): Promise<ActionResult<number>> {
  try {
    const count = await SessionTracker.getObservedGlobalSessionCount();
    return {
      ok: true,
      data: count,
    };
  } catch (error) {
    logger.error("Failed to get concurrent sessions:", error);
    return {
      ok: false,
      error: "获取并发数失败",
    };
  }
}
