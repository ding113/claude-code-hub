"use server";

import { getTranslations } from "next-intl/server";
import { emitActionAudit } from "@/lib/audit/emit";
import { getSession } from "@/lib/auth";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { logger } from "@/lib/logger";
import { ERROR_CODES } from "@/lib/utils/error-messages";
import { parseProviderGroups } from "@/lib/utils/provider-group";
import { findAllProvidersFresh } from "@/repository/provider";
import {
  countProvidersUsingGroup,
  ensureProviderGroupsExist,
  findAllProviderGroups,
  findProviderGroupById,
  findProviderGroupByName,
  createProviderGroup as repoCreateProviderGroup,
  deleteProviderGroup as repoDeleteProviderGroup,
  updateProviderGroup as repoUpdateProviderGroup,
} from "@/repository/provider-groups";
import type { ProviderGroup } from "@/types/provider-group";
import type { ActionResult } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderGroupWithCount = ProviderGroup & {
  providerCount: number;
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Return all provider groups with the number of providers in each group.
 * Admin-only.
 */
export async function getProviderGroups(): Promise<ActionResult<ProviderGroupWithCount[]>> {
  const tError = await getTranslations("errors");
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const [initialGroups, providers] = await Promise.all([
      findAllProviderGroups(),
      findAllProvidersFresh(),
    ]);

    // 单次遍历 providers：同时聚合引用集合与按组计数（未打 tag 的 provider 归入 default）
    const referenced = new Set<string>();
    const groupCounts = new Map<string, number>();
    for (const provider of providers) {
      const parsed = parseProviderGroups(provider.groupTag);
      if (parsed.length === 0) {
        referenced.add(PROVIDER_GROUP.DEFAULT);
        groupCounts.set(PROVIDER_GROUP.DEFAULT, (groupCounts.get(PROVIDER_GROUP.DEFAULT) || 0) + 1);
        continue;
      }
      for (const name of parsed) {
        referenced.add(name);
        groupCounts.set(name, (groupCounts.get(name) || 0) + 1);
      }
    }

    // 读时自愈：把被引用但表里缺失的分组名批量补齐。
    // 必须吞错——若 ensureProviderGroupsExist 因任何原因失败（如历史 tag 超过 provider_groups.name 长度上限），
    // Tab 依然应能展示既有分组，不能因自愈失败整页不可用。
    const existingNames = new Set(initialGroups.map((g) => g.name));
    const PROVIDER_GROUP_NAME_MAX = 200; // 与 schema 保持一致
    const missing = [...referenced].filter(
      (n) => !existingNames.has(n) && n.length <= PROVIDER_GROUP_NAME_MAX
    );
    let groups = initialGroups;
    if (missing.length > 0) {
      try {
        await ensureProviderGroupsExist(missing);
        // 重新拉取一次，拿到新插入行的完整字段（id/timestamps/默认倍率）
        groups = await findAllProviderGroups();
      } catch (syncError) {
        logger.warn("getProviderGroups:self_heal_failed", {
          error: syncError instanceof Error ? syncError.message : String(syncError),
          missingCount: missing.length,
        });
        // 继续用 initialGroups 返回，不阻塞 Tab 加载
      }
    }

    const data: ProviderGroupWithCount[] = groups.map((group) => ({
      ...group,
      providerCount: groupCounts.get(group.name) || 0,
    }));

    return { ok: true, data };
  } catch (error) {
    logger.error("Failed to fetch provider groups:", error);
    return {
      ok: false,
      error: tError("OPERATION_FAILED"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

/**
 * Create a new provider group.
 * Admin-only. Validates name is non-empty and not duplicate, costMultiplier >= 0.
 */
export async function createProviderGroup(input: {
  name: string;
  costMultiplier?: number;
  description?: string;
}): Promise<ActionResult<ProviderGroup>> {
  const t = await getTranslations("settings.providers.providerGroups");
  const tError = await getTranslations("errors");
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const name = input.name?.trim();
    if (!name) {
      return { ok: false, error: t("nameRequired"), errorCode: "NAME_REQUIRED" };
    }

    if (
      input.costMultiplier !== undefined &&
      (!Number.isFinite(input.costMultiplier) || input.costMultiplier < 0)
    ) {
      return {
        ok: false,
        error: t("invalidMultiplier"),
        errorCode: "INVALID_MULTIPLIER",
      };
    }

    // Check for duplicate name
    const existing = await findProviderGroupByName(name);
    if (existing) {
      return {
        ok: false,
        error: t("duplicateName"),
        errorCode: "DUPLICATE_NAME",
      };
    }

    const group = await repoCreateProviderGroup({
      name,
      costMultiplier: input.costMultiplier,
      description: input.description ?? null,
    });

    emitActionAudit({
      category: "provider_group",
      action: "provider_group.create",
      targetType: "provider_group",
      targetId: String(group.id),
      targetName: group.name,
      after: {
        id: group.id,
        name: group.name,
        costMultiplier: group.costMultiplier,
        description: group.description,
      },
      success: true,
    });
    return { ok: true, data: group };
  } catch (error) {
    logger.error("Failed to create provider group:", error);
    emitActionAudit({
      category: "provider_group",
      action: "provider_group.create",
      targetType: "provider_group",
      targetName: input.name?.trim() ?? null,
      success: false,
      errorMessage: "CREATE_FAILED",
    });
    return { ok: false, error: t("createFailed"), errorCode: ERROR_CODES.CREATE_FAILED };
  }
}

/**
 * Update an existing provider group by id.
 * Admin-only.
 */
export async function updateProviderGroup(
  id: number,
  input: { costMultiplier?: number; description?: string | null }
): Promise<ActionResult<ProviderGroup>> {
  const t = await getTranslations("settings.providers.providerGroups");
  const tError = await getTranslations("errors");
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    if (
      input.costMultiplier !== undefined &&
      (!Number.isFinite(input.costMultiplier) || input.costMultiplier < 0)
    ) {
      return {
        ok: false,
        error: t("invalidMultiplier"),
        errorCode: "INVALID_MULTIPLIER",
      };
    }

    const beforeGroup = await findProviderGroupById(id);

    const updated = await repoUpdateProviderGroup(id, {
      costMultiplier: input.costMultiplier,
      description: input.description,
    });

    if (!updated) {
      return { ok: false, error: tError("NOT_FOUND"), errorCode: ERROR_CODES.NOT_FOUND };
    }

    emitActionAudit({
      category: "provider_group",
      action: "provider_group.update",
      targetType: "provider_group",
      targetId: String(id),
      targetName: updated.name,
      before: beforeGroup ?? undefined,
      after: {
        id: updated.id,
        name: updated.name,
        costMultiplier: updated.costMultiplier,
        description: updated.description,
      },
      success: true,
    });
    return { ok: true, data: updated };
  } catch (error) {
    logger.error("Failed to update provider group:", error);
    emitActionAudit({
      category: "provider_group",
      action: "provider_group.update",
      targetType: "provider_group",
      targetId: String(id),
      success: false,
      errorMessage: "UPDATE_FAILED",
    });
    return { ok: false, error: t("updateFailed"), errorCode: ERROR_CODES.UPDATE_FAILED };
  }
}

/**
 * Delete a provider group by id.
 * Admin-only. Cannot delete the "default" group.
 */
export async function deleteProviderGroup(id: number): Promise<ActionResult<void>> {
  const t = await getTranslations("settings.providers.providerGroups");
  const tError = await getTranslations("errors");
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    // Pre-check: verify group exists and is not referenced by any provider.
    const existing = await findProviderGroupById(id);
    if (!existing) {
      return { ok: false, error: tError("NOT_FOUND"), errorCode: ERROR_CODES.NOT_FOUND };
    }

    if (existing.name === PROVIDER_GROUP.DEFAULT) {
      return {
        ok: false,
        error: t("cannotDeleteDefault"),
        errorCode: "CANNOT_DELETE_DEFAULT",
      };
    }

    const referenceCount = await countProvidersUsingGroup(existing.name);
    if (referenceCount > 0) {
      return {
        ok: false,
        error: t("groupInUse"),
        errorCode: "GROUP_IN_USE",
      };
    }

    await repoDeleteProviderGroup(id);
    emitActionAudit({
      category: "provider_group",
      action: "provider_group.delete",
      targetType: "provider_group",
      targetId: String(id),
      targetName: existing.name,
      before: existing,
      success: true,
    });
    return { ok: true, data: undefined };
  } catch (error) {
    // The default-group case is handled by the explicit pre-check above; the
    // repository's string-matched fallback is belt-and-suspenders only.
    logger.error("Failed to delete provider group:", error);
    emitActionAudit({
      category: "provider_group",
      action: "provider_group.delete",
      targetType: "provider_group",
      targetId: String(id),
      success: false,
      errorMessage: "DELETE_FAILED",
    });
    return { ok: false, error: t("deleteFailed"), errorCode: ERROR_CODES.DELETE_FAILED };
  }
}
