"use server";

import { revalidatePath } from "next/cache";
import safeRegex from "safe-regex";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { requestFilterEngine } from "@/lib/request-filter-engine";
import {
  createRequestFilter,
  deleteRequestFilter,
  getAllRequestFilters,
  getRequestFilterById,
  type RequestFilter,
  type RequestFilterAction,
  type RequestFilterMatchType,
  type RequestFilterScope,
  updateRequestFilter,
} from "@/repository/request-filters";
import type { ActionResult } from "./types";

const SETTINGS_PATH = "/settings/request-filters";

function isAdmin(session: Awaited<ReturnType<typeof getSession>>): boolean {
  return !!session && session.user.role === "admin";
}

function validatePayload(data: {
  name: string;
  scope: RequestFilterScope;
  action: RequestFilterAction;
  target: string;
  matchType?: RequestFilterMatchType;
  replacement?: unknown;
}): string | null {
  if (!data.name?.trim()) return "名称不能为空";
  if (!data.target?.trim()) return "目标字段不能为空";

  if (data.action === "text_replace" && data.matchType === "regex" && data.target) {
    if (!safeRegex(data.target)) {
      return "正则表达式存在 ReDoS 风险";
    }
  }
  return null;
}

export async function listRequestFilters(): Promise<RequestFilter[]> {
  try {
    const session = await getSession();
    if (!isAdmin(session)) {
      return [];
    }
    return await getAllRequestFilters();
  } catch (error) {
    logger.error("[RequestFiltersAction] Failed to list filters", { error });
    return [];
  }
}

export async function createRequestFilterAction(data: {
  name: string;
  description?: string;
  scope: RequestFilterScope;
  action: RequestFilterAction;
  target: string;
  matchType?: RequestFilterMatchType;
  replacement?: unknown;
  priority?: number;
}): Promise<ActionResult<RequestFilter>> {
  const session = await getSession();
  if (!isAdmin(session)) return { ok: false, error: "权限不足" };

  const validationError = validatePayload(data);
  if (validationError) return { ok: false, error: validationError };

  try {
    const created = await createRequestFilter({
      name: data.name.trim(),
      description: data.description?.trim(),
      scope: data.scope,
      action: data.action,
      target: data.target.trim(),
      matchType: data.matchType ?? null,
      replacement: data.replacement ?? null,
      priority: data.priority ?? 0,
    });

    revalidatePath(SETTINGS_PATH);
    return { ok: true, data: created };
  } catch (error) {
    logger.error("[RequestFiltersAction] Failed to create filter", { error, data });
    return { ok: false, error: "创建失败" };
  }
}

export async function updateRequestFilterAction(
  id: number,
  updates: Partial<{
    name: string;
    description: string | null;
    scope: RequestFilterScope;
    action: RequestFilterAction;
    target: string;
    matchType: RequestFilterMatchType;
    replacement: unknown;
    priority: number;
    isEnabled: boolean;
  }>
): Promise<ActionResult<RequestFilter>> {
  const session = await getSession();
  if (!isAdmin(session)) return { ok: false, error: "权限不足" };

  // ReDoS validation: applies when action is text_replace with regex matchType
  // Must check BOTH explicit updates AND existing filter state to prevent bypass
  if (updates.target) {
    // Determine effective matchType and action (from updates or existing filter)
    let effectiveMatchType = updates.matchType;
    let effectiveAction = updates.action;

    // If matchType or action not in updates, need to check existing filter
    if (effectiveMatchType === undefined || effectiveAction === undefined) {
      const existing = await getRequestFilterById(id);
      if (existing) {
        if (effectiveMatchType === undefined) effectiveMatchType = existing.matchType;
        if (effectiveAction === undefined) effectiveAction = existing.action;
      }
    }

    const isTextReplace = effectiveAction === "text_replace";
    const isRegex = effectiveMatchType === "regex";

    if (isTextReplace && isRegex && !safeRegex(updates.target)) {
      return { ok: false, error: "正则表达式存在 ReDoS 风险" };
    }
  }

  try {
    const updated = await updateRequestFilter(id, updates);
    if (!updated) {
      return { ok: false, error: "记录不存在" };
    }

    revalidatePath(SETTINGS_PATH);
    return { ok: true, data: updated };
  } catch (error) {
    logger.error("[RequestFiltersAction] Failed to update filter", { error, id, updates });
    return { ok: false, error: "更新失败" };
  }
}

export async function deleteRequestFilterAction(id: number): Promise<ActionResult> {
  const session = await getSession();
  if (!isAdmin(session)) return { ok: false, error: "权限不足" };

  try {
    const ok = await deleteRequestFilter(id);
    if (!ok) return { ok: false, error: "记录不存在" };
    revalidatePath(SETTINGS_PATH);
    return { ok: true };
  } catch (error) {
    logger.error("[RequestFiltersAction] Failed to delete filter", { error, id });
    return { ok: false, error: "删除失败" };
  }
}

export async function refreshRequestFiltersCache(): Promise<ActionResult<{ count: number }>> {
  const session = await getSession();
  if (!isAdmin(session)) return { ok: false, error: "权限不足" };

  try {
    await requestFilterEngine.reload();
    const stats = requestFilterEngine.getStats();
    revalidatePath(SETTINGS_PATH);
    return { ok: true, data: { count: stats.count } };
  } catch (error) {
    logger.error("[RequestFiltersAction] Failed to refresh cache", { error });
    return { ok: false, error: "刷新失败" };
  }
}
