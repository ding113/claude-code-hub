/**
 * 服务器端隐私保护工具函数
 * 用于在服务器端（actions/repository）中获取隐私过滤上下文
 */

"use server";

import { getSession } from "@/lib/auth";
import { getSystemSettings } from "@/repository/system-config";
import { createPrivacyContext, type PrivacyFilterContext } from "./privacy-filter";

/**
 * 获取当前请求的隐私过滤上下文
 * 自动读取 session 和系统设置
 */
export async function getPrivacyContext(): Promise<PrivacyFilterContext> {
  const [session, settings] = await Promise.all([getSession(), getSystemSettings()]);

  const isAdmin = session?.user?.role === "admin";

  return createPrivacyContext(isAdmin, settings);
}

/**
 * 检查当前用户是否是管理员
 */
export async function isCurrentUserAdmin(): Promise<boolean> {
  const session = await getSession();
  return session?.user?.role === "admin";
}
