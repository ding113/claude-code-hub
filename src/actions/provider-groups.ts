"use server";

import { getTranslations } from "next-intl/server";
import { emitActionAudit } from "@/lib/audit/emit";
import { getSession } from "@/lib/auth";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { logger } from "@/lib/logger";
import { bootstrapProviderGroupsFromProviders } from "@/lib/provider-groups/bootstrap";
import { normalizeProviderGroupMatchRules } from "@/lib/provider-groups/match-rules";
import { normalizeProviderGroupModelMatchRules } from "@/lib/provider-groups/model-match-rules";
import { normalizeProviderGroupSharedSettings } from "@/lib/provider-groups/shared-settings";
import {
  normalizeProviderGroupHealthTestModels,
  resolveProviderGroupHealthTestModelFallback,
} from "@/lib/provider-health-test/model-config";
import {
  parsePublicStatusDescription,
  serializePublicStatusDescription,
} from "@/lib/public-status/config";
import { exceedsProviderGroupDescriptionLimit } from "@/lib/public-status/description-limit";
import { ERROR_CODES } from "@/lib/utils/error-messages";
import {
  applyProviderGroupSharedSettingsToMembers,
  countProvidersUsingGroup,
  findProviderGroupById,
  findProviderGroupByName,
  createProviderGroup as repoCreateProviderGroup,
  deleteProviderGroup as repoDeleteProviderGroup,
  reorderProviderGroups as repoReorderProviderGroups,
  updateProviderGroup as repoUpdateProviderGroup,
} from "@/repository/provider-groups";
import type {
  ProviderGroup,
  ProviderGroupMatchRule,
  ProviderGroupModelMatchRule,
  ProviderGroupSharedSettings,
} from "@/types/provider-group";
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

    const { groups, groupCounts } = await bootstrapProviderGroupsFromProviders({
      logSelfHealFailure: (error, missing) => {
        logger.warn("getProviderGroups:self_heal_failed", {
          error: error instanceof Error ? error.message : String(error),
          missingCount: missing.length,
        });
      },
    });

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
  healthTestModel?: string | null;
  healthTestModels?: string[] | null;
  healthTestModelFallback?: string | null;
  sharedSettings?: ProviderGroupSharedSettings | null;
  applySharedSettingsToMembers?: boolean;
  sortOrder?: number;
  matchRules?: ProviderGroupMatchRule[] | null;
  modelMatchRules?: ProviderGroupModelMatchRule[] | null;
}): Promise<ActionResult<ProviderGroup & { appliedMembers?: number }>> {
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

    if (exceedsProviderGroupDescriptionLimit(input.description)) {
      return {
        ok: false,
        error: t("descriptionTooLong"),
        errorCode: "DESCRIPTION_TOO_LONG",
      };
    }

    const healthTestModels = normalizeProviderGroupHealthTestModels(
      input.healthTestModels,
      input.healthTestModel
    );
    const healthTestModelFallback = resolveProviderGroupHealthTestModelFallback(
      input.healthTestModelFallback,
      healthTestModels,
      input.healthTestModel
    );
    const sharedSettings = normalizeProviderGroupSharedSettings(input.sharedSettings);
    const matchRules = normalizeProviderGroupMatchRules(input.matchRules);
    const modelMatchRules = normalizeProviderGroupModelMatchRules(input.modelMatchRules);

    const group = await repoCreateProviderGroup({
      name,
      costMultiplier: input.costMultiplier,
      description: input.description ?? null,
      healthTestModels,
      healthTestModelFallback,
      sharedSettings,
      sortOrder: input.sortOrder,
      matchRules,
      modelMatchRules,
    });

    let appliedMembers = 0;
    if (input.applySharedSettingsToMembers && sharedSettings) {
      appliedMembers = await applyProviderGroupSharedSettingsToMembers(group.name, sharedSettings);
      try {
        const { publishProviderCacheInvalidation } = await import("@/lib/cache/provider-cache");
        await publishProviderCacheInvalidation();
      } catch {
        // best-effort
      }
    }

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
        healthTestModel: group.healthTestModel,
        healthTestModels: group.healthTestModels,
        healthTestModelFallback: group.healthTestModelFallback,
        sharedSettings: group.sharedSettings,
        sortOrder: group.sortOrder,
        matchRules: group.matchRules,
        modelMatchRules: group.modelMatchRules,
        appliedMembers,
      },
      success: true,
    });
    return { ok: true, data: { ...group, appliedMembers } };
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
  input: {
    costMultiplier?: number;
    description?: string | null;
    descriptionNote?: string | null;
    healthTestModel?: string | null;
    healthTestModels?: string[] | null;
    healthTestModelFallback?: string | null;
    sharedSettings?: ProviderGroupSharedSettings | null;
    applySharedSettingsToMembers?: boolean;
    sortOrder?: number;
    matchRules?: ProviderGroupMatchRule[] | null;
    modelMatchRules?: ProviderGroupModelMatchRule[] | null;
  }
): Promise<ActionResult<ProviderGroup & { appliedMembers?: number }>> {
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
    const nextDescription =
      input.descriptionNote !== undefined
        ? serializePublicStatusDescription({
            note: input.descriptionNote,
            publicStatus: parsePublicStatusDescription(beforeGroup?.description).publicStatus,
          })
        : input.description;
    if (exceedsProviderGroupDescriptionLimit(nextDescription)) {
      return {
        ok: false,
        error: t("descriptionTooLong"),
        errorCode: "DESCRIPTION_TOO_LONG",
      };
    }

    const healthTestModelsPatch =
      input.healthTestModels !== undefined || input.healthTestModel !== undefined
        ? normalizeProviderGroupHealthTestModels(input.healthTestModels, input.healthTestModel)
        : undefined;
    const fallbackModels = healthTestModelsPatch ?? beforeGroup?.healthTestModels ?? [];
    const healthTestModelFallbackInput =
      input.healthTestModelFallback !== undefined
        ? input.healthTestModelFallback
        : healthTestModelsPatch !== undefined
          ? beforeGroup?.healthTestModelFallback
          : undefined;
    const healthTestModelFallbackPatch =
      healthTestModelFallbackInput !== undefined || healthTestModelsPatch !== undefined
        ? resolveProviderGroupHealthTestModelFallback(
            healthTestModelFallbackInput,
            fallbackModels,
            beforeGroup?.healthTestModel
          )
        : undefined;

    const sharedSettingsPatch =
      input.sharedSettings === undefined
        ? undefined
        : normalizeProviderGroupSharedSettings(input.sharedSettings);
    const matchRulesPatch =
      input.matchRules === undefined
        ? undefined
        : normalizeProviderGroupMatchRules(input.matchRules);
    const modelMatchRulesPatch =
      input.modelMatchRules === undefined
        ? undefined
        : normalizeProviderGroupModelMatchRules(input.modelMatchRules);

    const updated = await repoUpdateProviderGroup(id, {
      costMultiplier: input.costMultiplier,
      description: nextDescription,
      ...(healthTestModelsPatch !== undefined
        ? { healthTestModels: healthTestModelsPatch }
        : {}),
      ...(healthTestModelFallbackPatch !== undefined
        ? { healthTestModelFallback: healthTestModelFallbackPatch }
        : {}),
      ...(sharedSettingsPatch !== undefined ? { sharedSettings: sharedSettingsPatch } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(matchRulesPatch !== undefined ? { matchRules: matchRulesPatch } : {}),
      ...(modelMatchRulesPatch !== undefined ? { modelMatchRules: modelMatchRulesPatch } : {}),
    });

    if (!updated) {
      return { ok: false, error: tError("NOT_FOUND"), errorCode: ERROR_CODES.NOT_FOUND };
    }

    let appliedMembers = 0;
    const settingsToApply =
      sharedSettingsPatch !== undefined ? sharedSettingsPatch : updated.sharedSettings;
    if (input.applySharedSettingsToMembers && settingsToApply) {
      appliedMembers = await applyProviderGroupSharedSettingsToMembers(
        updated.name,
        settingsToApply
      );
      try {
        const { publishProviderCacheInvalidation } = await import("@/lib/cache/provider-cache");
        await publishProviderCacheInvalidation();
      } catch {
        // best-effort
      }
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
        healthTestModel: updated.healthTestModel,
        healthTestModels: updated.healthTestModels,
        healthTestModelFallback: updated.healthTestModelFallback,
        sharedSettings: updated.sharedSettings,
        sortOrder: updated.sortOrder,
        matchRules: updated.matchRules,
        modelMatchRules: updated.modelMatchRules,
        appliedMembers,
      },
      success: true,
    });
    return { ok: true, data: { ...updated, appliedMembers } };
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

    // Pre-check: verify group exists (except default).
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

    // 产品行为：删除分组时自动解除引用——repository 会从所有引用该分组的
    // provider.groupTag 中移除该组名（为空则归入 default），不再拒绝删除。
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

/**
 * Reorder provider groups for keyword classification priority.
 * Admin-only. orderedIds is top-to-bottom; default is ignored/pinned.
 */
export async function reorderProviderGroups(
  orderedIds: number[]
): Promise<ActionResult<ProviderGroupWithCount[]>> {
  const t = await getTranslations("settings.providers.providerGroups");
  const tError = await getTranslations("errors");
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return { ok: false, error: t("reorderInvalid"), errorCode: "INVALID_ORDER" };
    }

    const groups = await repoReorderProviderGroups(orderedIds);
    const data: ProviderGroupWithCount[] = [];
    for (const group of groups) {
      const providerCount = await countProvidersUsingGroup(group.name);
      data.push({ ...group, providerCount });
    }

    emitActionAudit({
      category: "provider_group",
      action: "provider_group.reorder",
      targetType: "provider_group",
      after: { orderedIds },
      success: true,
    });
    return { ok: true, data };
  } catch (error) {
    logger.error("Failed to reorder provider groups:", error);
    emitActionAudit({
      category: "provider_group",
      action: "provider_group.reorder",
      targetType: "provider_group",
      success: false,
      errorMessage: "UPDATE_FAILED",
    });
    return { ok: false, error: t("reorderFailed"), errorCode: ERROR_CODES.UPDATE_FAILED };
  }
}

/**
 * Fetch the aggregated model list returned by every enabled provider that
 * belongs to the given provider group (all relay groups of this group).
 * Admin-only. Providers that fail to respond are skipped individually.
 */
export async function fetchProviderGroupUpstreamModels(
  groupId: number
): Promise<ActionResult<{ models: string[]; failed: string[] }>> {
  const tError = await getTranslations("errors");
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const group = await findProviderGroupById(groupId);
    if (!group) {
      return { ok: false, error: "group_not_found", errorCode: "NOT_FOUND" };
    }

    const { findAllProviders } = await import("@/repository/provider");
    const { resolveProviderGroupsWithDefault } = await import("@/lib/utils/provider-group");
    const { fetchModelsFromProvider } = await import("@/app/v1/_lib/models/available-models");

    const groupNames = new Set(resolveProviderGroupsWithDefault(group.name));
    const all = await findAllProviders();
    const members = all.filter(
      (provider) =>
        provider.isEnabled &&
        provider.deletedAt == null &&
        resolveProviderGroupsWithDefault(provider.groupTag).some((tag) => groupNames.has(tag))
    );

    const modelIds = new Set<string>();
    const failed: string[] = [];
    const settled = await Promise.allSettled(
      members.map(async (provider) => {
        const models = await fetchModelsFromProvider(provider);
        return { provider, models };
      })
    );
    for (const result of settled) {
      if (result.status === "fulfilled") {
        for (const model of result.value.models) {
          if (model.id && model.id.trim()) modelIds.add(model.id.trim());
        }
      } else {
        failed.push(
          result.reason instanceof Error ? result.reason.message : String(result.reason)
        );
      }
    }

    return {
      ok: true,
      data: { models: [...modelIds].sort((a, b) => a.localeCompare(b)), failed },
    };
  } catch (error) {
    logger.error("Failed to fetch provider group upstream models:", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "OPERATION_FAILED",
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}
