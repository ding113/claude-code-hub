"use server";

import { getSession } from "@/lib/auth";
import { ClientVersionChecker, type ClientVersionStats } from "@/lib/client-version-checker";
import { logger } from "@/lib/logger";
import type { ActionResult } from "./types";

/**
 * 获取所有客户端的版本统计信息
 *
 * 权限要求：管理员
 *
 * @returns 客户端版本统计数据
 */
export async function fetchClientVersionStats(): Promise<ActionResult<ClientVersionStats[]>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限访问客户端版本统计" };
    }

    const stats = await ClientVersionChecker.getAllClientStats();
    return { ok: true, data: stats };
  } catch (error) {
    logger.error({ error }, "获取客户端版本统计失败");
    const message = error instanceof Error ? error.message : "获取客户端版本统计失败";
    return { ok: false, error: message };
  }
}
