"use server";

import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { ProxyStatusTracker } from "@/lib/proxy-status-tracker";
import type { ProxyStatusResponse } from "@/types/proxy-status";
import type { ActionResult } from "./types";

export async function getProxyStatus(): Promise<ActionResult<ProxyStatusResponse>> {
  try {
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未授权，请先登录" };
    }

    // 权限检查：仅 admin 用户可访问
    if (session.user.role !== "admin") {
      return { ok: false, error: "权限不足" };
    }

    const tracker = ProxyStatusTracker.getInstance();
    const status = await tracker.getAllUsersStatus();
    return { ok: true, data: status };
  } catch (error) {
    logger.error("获取代理状态失败:", error);
    return { ok: false, error: "获取代理状态失败" };
  }
}
