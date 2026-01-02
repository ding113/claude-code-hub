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
  type RequestFilterBindingType,
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
  bindingType?: RequestFilterBindingType;
  providerIds?: number[] | null;
  groupTags?: string[] | null;
}): string | null {
  if (!data.name?.trim()) return "名称不能为空";
  if (!data.target?.trim()) return "目标字段不能为空";

  if (data.action === "text_replace" && data.matchType === "regex" && data.target) {
    if (!safeRegex(data.target)) {
      return "正则表达式存在 ReDoS 风险";
    }
  }

  // Validate binding type constraints
  const bindingType = data.bindingType ?? "global";
  if (bindingType === "providers") {
    if (!data.providerIds || data.providerIds.length === 0) {
      return "至少选择一个 Provider";
    }
    if (data.groupTags && data.groupTags.length > 0) {
      return "不能同时选择 Providers 和 Groups";
    }
  }
  if (bindingType === "groups") {
    if (!data.groupTags || data.groupTags.length === 0) {
      return "至少选择一个 Group Tag";
    }
    if (data.providerIds && data.providerIds.length > 0) {
      return "不能同时选择 Providers 和 Groups";
    }
  }
  if (bindingType === "global") {
    if (
      (data.providerIds && data.providerIds.length > 0) ||
      (data.groupTags && data.groupTags.length > 0)
    ) {
      return "Global 类型不能指定 Providers 或 Groups";
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
  bindingType?: RequestFilterBindingType;
  providerIds?: number[] | null;
  groupTags?: string[] | null;
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
      bindingType: data.bindingType ?? "global",
      providerIds: data.providerIds ?? null,
      groupTags: data.groupTags ?? null,
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
    bindingType: RequestFilterBindingType;
    providerIds: number[] | null;
    groupTags: string[] | null;
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

  // Validate binding type constraints when updating binding-related fields
  if (
    updates.bindingType !== undefined ||
    updates.providerIds !== undefined ||
    updates.groupTags !== undefined
  ) {
    // Need to merge updates with existing data
    const existing = await getRequestFilterById(id);
    if (!existing) {
      return { ok: false, error: "记录不存在" };
    }

    const effectiveBindingType = updates.bindingType ?? existing.bindingType;
    const effectiveProviderIds =
      updates.providerIds !== undefined ? updates.providerIds : existing.providerIds;
    const effectiveGroupTags =
      updates.groupTags !== undefined ? updates.groupTags : existing.groupTags;

    const validationError = validatePayload({
      name: existing.name,
      scope: existing.scope,
      action: existing.action,
      target: existing.target,
      bindingType: effectiveBindingType,
      providerIds: effectiveProviderIds,
      groupTags: effectiveGroupTags,
    });

    if (validationError) {
      return { ok: false, error: validationError };
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

/**
 * Get list of all providers for filter binding selection
 */
export async function listProvidersForFilterAction(): Promise<
  ActionResult<Array<{ id: number; name: string }>>
> {
  const session = await getSession();
  if (!isAdmin(session)) return { ok: false, error: "权限不足" };

  try {
    const { findAllProviders } = await import("@/repository/provider");
    const providers = await findAllProviders();
    const simplified = providers.map((p) => ({ id: p.id, name: p.name }));
    return { ok: true, data: simplified };
  } catch (error) {
    logger.error("[RequestFiltersAction] Failed to list providers", { error });
    return { ok: false, error: "获取 Provider 列表失败" };
  }
}

/**
 * Get distinct provider group tags for filter binding selection
 */
export async function getDistinctProviderGroupsAction(): Promise<ActionResult<string[]>> {
  const session = await getSession();
  if (!isAdmin(session)) return { ok: false, error: "权限不足" };

  try {
    const { db } = await import("@/drizzle/db");
    const { providers } = await import("@/drizzle/schema");
    const { isNull, isNotNull, ne, and } = await import("drizzle-orm");

    const result = await db
      .selectDistinct({ groupTag: providers.groupTag })
      .from(providers)
      .where(
        and(
          isNull(providers.deletedAt),
          and(isNotNull(providers.groupTag), ne(providers.groupTag, ""))
        )
      );

    // Parse comma-separated tags and flatten into unique array
    const allTags = new Set<string>();
    for (const row of result) {
      if (row.groupTag) {
        const tags = row.groupTag.split(",").map((tag) => tag.trim());
        for (const tag of tags) {
          if (tag) allTags.add(tag);
        }
      }
    }

    return { ok: true, data: Array.from(allTags).sort() };
  } catch (error) {
    logger.error("[RequestFiltersAction] Failed to get distinct group tags", { error });
    return { ok: false, error: "获取 Group Tags 失败" };
  }
}
