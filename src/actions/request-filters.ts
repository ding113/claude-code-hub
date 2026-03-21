"use server";

import { revalidatePath } from "next/cache";
import safeRegex from "safe-regex";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { requestFilterEngine } from "@/lib/request-filter-engine";
import type { FilterMatcher, FilterOperation, InsertOp } from "@/lib/request-filter-types";
import { parseProviderGroups } from "@/lib/utils/provider-group";
import {
  createRequestFilter,
  deleteRequestFilter,
  getAllRequestFilters,
  getRequestFilterById,
  type RequestFilter,
  type RequestFilterAction,
  type RequestFilterBindingType,
  type RequestFilterExecutionPhase,
  type RequestFilterMatchType,
  type RequestFilterRuleMode,
  type RequestFilterScope,
  updateRequestFilter,
} from "@/repository/request-filters";
import type { ActionResult } from "./types";

const SETTINGS_PATH = "/settings/request-filters";

const VALIDATION_UNSAFE_KEYS = /(?:^|[.[])(?:__proto__|constructor|prototype)(?:[.[\]]|$)/;
const MAX_OPERATIONS = 50;

function isAdmin(session: Awaited<ReturnType<typeof getSession>>): boolean {
  return !!session && session.user.role === "admin";
}

// ---------------------------------------------------------------------------
// Validation: advanced mode operations
// ---------------------------------------------------------------------------

function validateMatcher(matcher: FilterMatcher, context: string): string | null {
  if (matcher.matchType === "regex" && typeof matcher.value === "string") {
    if (!safeRegex(matcher.value)) {
      return `${context}: regex matcher has ReDoS risk`;
    }
  }
  return null;
}

function validateOperations(operations: unknown): string | null {
  if (!Array.isArray(operations) || operations.length === 0) {
    return "Advanced mode requires at least one operation";
  }

  if (operations.length > MAX_OPERATIONS) {
    return `Operations array must not exceed ${MAX_OPERATIONS} entries`;
  }

  for (let i = 0; i < operations.length; i++) {
    const raw = operations[i] as Record<string, unknown> | null | undefined;
    const prefix = `operations[${i}]`;

    if (!raw || typeof raw !== "object") {
      return `${prefix}: must be an object`;
    }

    if (!raw.op || !["set", "remove", "merge", "insert"].includes(raw.op as string)) {
      return `${prefix}: invalid op type "${String(raw.op)}"`;
    }

    if (!raw.scope || !["header", "body"].includes(raw.scope as string)) {
      return `${prefix}: invalid scope "${String(raw.scope)}"`;
    }

    const op = raw as unknown as FilterOperation;

    // merge and insert are body-only (enforced by type, validated at runtime as defense-in-depth)
    if ((op.op === "merge" || op.op === "insert") && (raw.scope as string) !== "body") {
      return `${prefix}: ${op.op} operation only supports body scope`;
    }

    if (!("path" in op) || typeof op.path !== "string" || !op.path.trim()) {
      return `${prefix}: path is required`;
    }

    // Block prototype pollution via path
    if (VALIDATION_UNSAFE_KEYS.test(op.path)) {
      return `${prefix}: path contains a forbidden property name`;
    }

    // Value validation for ops that require it
    if (op.op === "set" && !("value" in raw)) {
      return `${prefix}: value is required for set`;
    }
    if (op.op === "merge") {
      if (
        !("value" in raw) ||
        raw.value === null ||
        typeof raw.value !== "object" ||
        Array.isArray(raw.value)
      ) {
        return `${prefix}: merge value must be a plain object`;
      }
    }
    if (op.op === "insert" && !("value" in raw)) {
      return `${prefix}: value is required for insert`;
    }

    // Op-specific validation
    if (op.op === "insert") {
      const insertOp = op as InsertOp;
      if ((insertOp.position === "before" || insertOp.position === "after") && !insertOp.anchor) {
        return `${prefix}: anchor is required when position is "${insertOp.position}"`;
      }
      if (insertOp.anchor) {
        const matcherErr = validateMatcher(insertOp.anchor, `${prefix}.anchor`);
        if (matcherErr) return matcherErr;
      }
      if (insertOp.dedupe?.byFields && !Array.isArray(insertOp.dedupe.byFields)) {
        return `${prefix}: dedupe.byFields must be an array`;
      }
    }

    if (op.op === "remove" && "matcher" in op && op.matcher) {
      const matcherErr = validateMatcher(op.matcher, `${prefix}.matcher`);
      if (matcherErr) return matcherErr;
    }
  }

  return null;
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
  ruleMode?: RequestFilterRuleMode;
  operations?: FilterOperation[] | null;
}): string | null {
  if (!data.name?.trim()) return "名称不能为空";

  const ruleMode = data.ruleMode ?? "simple";

  if (ruleMode === "advanced") {
    // Advanced mode: validate operations, skip simple fields
    const opsError = validateOperations(data.operations);
    if (opsError) return opsError;
  } else {
    // Simple mode: existing validation
    if (!data.target?.trim()) return "目标字段不能为空";

    if (data.action === "text_replace" && data.matchType === "regex" && data.target) {
      if (!safeRegex(data.target)) {
        return "正则表达式存在 ReDoS 风险";
      }
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
  ruleMode?: RequestFilterRuleMode;
  executionPhase?: RequestFilterExecutionPhase;
  operations?: FilterOperation[] | null;
}): Promise<ActionResult<RequestFilter>> {
  const session = await getSession();
  if (!isAdmin(session)) return { ok: false, error: "权限不足" };

  const validationError = validatePayload(data);
  if (validationError) return { ok: false, error: validationError };

  // Reject advanced + guard combo: advanced mode only supports final phase
  const effectiveRuleMode = data.ruleMode ?? "simple";
  const effectivePhase = data.executionPhase ?? "guard";
  if (effectiveRuleMode === "advanced" && effectivePhase === "guard") {
    return { ok: false, error: "Advanced mode filters only support final execution phase" };
  }

  try {
    const created = await createRequestFilter({
      name: data.name.trim(),
      description: data.description?.trim(),
      scope: data.scope,
      action: data.action,
      target: data.target?.trim() ?? "",
      matchType: data.matchType ?? null,
      replacement: data.replacement ?? null,
      priority: data.priority ?? 0,
      bindingType: data.bindingType ?? "global",
      providerIds: data.providerIds ?? null,
      groupTags: data.groupTags ?? null,
      ruleMode: data.ruleMode ?? "simple",
      executionPhase: data.executionPhase ?? "guard",
      operations: data.operations ?? null,
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
    ruleMode: RequestFilterRuleMode;
    executionPhase: RequestFilterExecutionPhase;
    operations: FilterOperation[] | null;
  }>
): Promise<ActionResult<RequestFilter>> {
  const session = await getSession();
  if (!isAdmin(session)) return { ok: false, error: "权限不足" };

  // Fetch existing record once for all validations that need it
  const needsExisting =
    updates.ruleMode !== undefined ||
    updates.operations !== undefined ||
    updates.executionPhase !== undefined ||
    updates.target !== undefined ||
    updates.matchType !== undefined ||
    updates.action !== undefined ||
    updates.bindingType !== undefined ||
    updates.providerIds !== undefined ||
    updates.groupTags !== undefined;

  let existing: RequestFilter | null = null;
  if (needsExisting) {
    existing = await getRequestFilterById(id);
    if (!existing) {
      return { ok: false, error: "记录不存在" };
    }
  }

  // Reject advanced + guard combo: advanced mode only supports final phase
  if (updates.ruleMode !== undefined || updates.executionPhase !== undefined) {
    const effectiveRuleMode = updates.ruleMode ?? existing!.ruleMode;
    const effectivePhase = updates.executionPhase ?? existing!.executionPhase;
    if (effectiveRuleMode === "advanced" && effectivePhase === "guard") {
      return { ok: false, error: "Advanced mode filters only support final execution phase" };
    }
  }

  // Validate operations when ruleMode or operations change
  if (updates.ruleMode !== undefined || updates.operations !== undefined) {
    const effectiveRuleMode = updates.ruleMode ?? existing!.ruleMode;
    const effectiveOperations =
      updates.operations !== undefined ? updates.operations : existing!.operations;

    if (effectiveRuleMode === "advanced") {
      const opsError = validateOperations(effectiveOperations);
      if (opsError) return { ok: false, error: opsError };
    }
  }

  // ReDoS validation: applies when action is text_replace with regex matchType
  // Must check BOTH explicit updates AND existing filter state to prevent bypass
  if (
    updates.target !== undefined ||
    updates.matchType !== undefined ||
    updates.action !== undefined
  ) {
    // Determine effective target, matchType and action (from updates or existing filter)
    const effectiveTarget = updates.target ?? existing!.target;
    const effectiveMatchType = updates.matchType ?? existing!.matchType;
    const effectiveAction = updates.action ?? existing!.action;

    const isTextReplace = effectiveAction === "text_replace";
    const isRegex = effectiveMatchType === "regex";

    if (isTextReplace && isRegex && effectiveTarget && !safeRegex(effectiveTarget)) {
      return { ok: false, error: "正则表达式存在 ReDoS 风险" };
    }
  }

  // Validate binding type constraints when updating binding-related fields
  if (
    updates.bindingType !== undefined ||
    updates.providerIds !== undefined ||
    updates.groupTags !== undefined
  ) {
    const effectiveBindingType = updates.bindingType ?? existing!.bindingType;
    const effectiveProviderIds =
      updates.providerIds !== undefined ? updates.providerIds : existing!.providerIds;
    const effectiveGroupTags =
      updates.groupTags !== undefined ? updates.groupTags : existing!.groupTags;

    const validationError = validatePayload({
      name: existing!.name,
      scope: existing!.scope,
      action: existing!.action,
      target: existing!.target,
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
        const tags = parseProviderGroups(row.groupTag);
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
