"use server";

import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { resolveSessionRequestLocator } from "@/lib/session-request-locator";
import { aggregateMultipleSessionStats, findSessionOriginChain } from "@/repository/message";
import type { ProviderChainItem } from "@/types/message";
import type { ActionResult } from "./types";

export async function getSessionOriginChain(
  sessionId: string,
  requestSequence?: number,
  requestedSourceSessionId?: string
): Promise<ActionResult<ProviderChainItem[] | null>> {
  try {
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未登录" };
    }

    const [sessionStats] = await aggregateMultipleSessionStats(
      [sessionId],
      session.user.role === "admin" ? undefined : session.user.id
    );
    if (!sessionStats) {
      return { ok: false, error: "Session 不存在" };
    }

    if (session.user.role !== "admin" && sessionStats.userId !== session.user.id) {
      return { ok: false, error: "无权访问该 Session" };
    }

    const locatorResult = await resolveSessionRequestLocator(
      sessionStats.sessionId,
      requestSequence,
      requestedSourceSessionId,
      undefined,
      sessionStats.userId
    );
    if (!locatorResult.ok) return locatorResult;

    const chain = await findSessionOriginChain(
      locatorResult.locator.requestId,
      locatorResult.locator.keyId,
      sessionStats.userId
    );
    return { ok: true, data: chain ?? null };
  } catch (error) {
    logger.error("获取会话来源链失败:", error);
    return { ok: false, error: "获取会话来源链失败" };
  }
}
