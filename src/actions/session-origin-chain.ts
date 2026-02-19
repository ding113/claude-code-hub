"use server";

import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { messageRequest } from "@/drizzle/schema";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { findKeyList } from "@/repository/key";
import { findSessionOriginChain } from "@/repository/message";
import type { ProviderChainItem } from "@/types/message";
import type { ActionResult } from "./types";

export async function getSessionOriginChain(
  sessionId: string
): Promise<ActionResult<ProviderChainItem[] | null>> {
  try {
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未登录" };
    }

    if (session.user.role !== "admin") {
      const userKeys = await findKeyList(session.user.id);
      const userKeyValues = userKeys.map((key) => key.key);

      const ownershipCondition =
        userKeyValues.length > 0
          ? or(
              eq(messageRequest.userId, session.user.id),
              inArray(messageRequest.key, userKeyValues)
            )
          : eq(messageRequest.userId, session.user.id);

      const [ownedSession] = await db
        .select({ id: messageRequest.id })
        .from(messageRequest)
        .where(
          and(
            eq(messageRequest.sessionId, sessionId),
            isNull(messageRequest.deletedAt),
            ownershipCondition
          )
        )
        .limit(1);

      if (!ownedSession) {
        return { ok: false, error: "无权访问该 Session" };
      }
    }

    const chain = await findSessionOriginChain(sessionId);
    return { ok: true, data: chain ?? null };
  } catch (error) {
    logger.error("获取会话来源链失败:", error);
    return { ok: false, error: "获取会话来源链失败" };
  }
}
