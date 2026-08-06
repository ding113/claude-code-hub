"use server";

import { getTranslations } from "next-intl/server";
import { emitActionAudit } from "@/lib/audit/emit";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { ERROR_CODES } from "@/lib/utils/error-messages";
import {
  findAllProviderSitesWithRates,
  findProviderSiteById,
  findProviderSiteByName,
  findProviderSiteGroupRateById,
  createProviderSite as repoCreateProviderSite,
  deleteProviderSite as repoDeleteProviderSite,
  deleteProviderSiteGroupRate as repoDeleteProviderSiteGroupRate,
  reorderProviderSites as repoReorderProviderSites,
  updateProviderSite as repoUpdateProviderSite,
  updateProviderSiteGroupRate as repoUpdateProviderSiteGroupRate,
  upsertProviderSiteGroupRate as repoUpsertProviderSiteGroupRate,
} from "@/repository/provider-sites";
import type {
  CreateProviderSiteInput,
  ProviderSite,
  ProviderSiteGroupRate,
  ProviderSiteWithRates,
  UpdateProviderSiteGroupRateInput,
  UpdateProviderSiteInput,
  UpsertProviderSiteGroupRateInput,
} from "@/types/provider-site";
import type { ActionResult } from "./types";

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function toIsoRate(rate: ProviderSiteGroupRate) {
  return {
    id: rate.id,
    siteId: rate.siteId,
    groupName: rate.groupName,
    description: rate.description,
    ratio: rate.ratio,
    completionRatio: rate.completionRatio,
    dispatchGroupTag: rate.dispatchGroupTag,
    lastSeenAt: rate.lastSeenAt.toISOString(),
    createdAt: rate.createdAt.toISOString(),
    updatedAt: rate.updatedAt.toISOString(),
  };
}

function toIsoSiteBase(site: ProviderSite) {
  return {
    id: site.id,
    name: site.name,
    siteUrl: site.siteUrl,
    siteType: site.siteType,
    providerVendorId: site.providerVendorId,
    notes: site.notes,
    isEnabled: site.isEnabled,
    sortOrder: site.sortOrder,
    upstreamHubChannelId: site.upstreamHubChannelId,
    username: site.username,
    hasPassword: site.hasPassword,
    turnstileEnabled: site.turnstileEnabled,
    captchaProvider: site.captchaProvider,
    hasCaptchaApiKey: site.hasCaptchaApiKey,
    captchaEndpoint: site.captchaEndpoint,
    lastBalance: site.lastBalance,
    lastBalanceAt: site.lastBalanceAt?.toISOString() ?? null,
    todayCost: site.todayCost,
    totalCost: site.totalCost,
    lastSyncError: site.lastSyncError,
    lastSyncAt: site.lastSyncAt?.toISOString() ?? null,
    lastRateSyncedAt: site.lastRateSyncedAt?.toISOString() ?? null,
    lastCostSyncedAt: site.lastCostSyncedAt?.toISOString() ?? null,
    createdAt: site.createdAt.toISOString(),
    updatedAt: site.updatedAt.toISOString(),
  };
}

function toIsoSiteWithRates(site: ProviderSiteWithRates) {
  return {
    ...toIsoSiteBase(site),
    groupRates: site.groupRates.map(toIsoRate),
    providerCount: site.providerCount,
    enabledProviderCount: site.enabledProviderCount,
  };
}

export type ProviderSiteListItem = ReturnType<typeof toIsoSiteWithRates>;
export type ProviderSiteDto = ReturnType<typeof toIsoSiteBase>;
export type ProviderSiteGroupRateDto = ReturnType<typeof toIsoRate>;
export type ProviderSiteSyncResultDto = {
  siteId: number;
  siteName: string;
  ok: boolean;
  groupsUpserted: number;
  groupsSeen: number;
  balance: number | null;
  todayCost: number | null;
  totalCost: number | null;
  error?: string;
  durationMs: number;
  keysSynced?: {
    created: number;
    deleted: number;
    reused: number;
    skippedGroups: string[];
    keysSeen: number;
    keysAutoCreated?: number;
    unboundUpstreamKeysDeleted?: number;
  };
};

/**
 * List all upstream sites (中转单位) with expandable group rates.
 * Admin-only.
 */
export async function getProviderSites(): Promise<ActionResult<ProviderSiteListItem[]>> {
  const tError = await getTranslations("errors");
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const sites = await findAllProviderSitesWithRates();
    return {
      ok: true,
      data: sites.map((site) => toIsoSiteWithRates(site)),
    };
  } catch (error) {
    logger.error("Failed to fetch provider sites:", error);
    return {
      ok: false,
      error: tError("OPERATION_FAILED"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

export async function createProviderSite(
  input: CreateProviderSiteInput
): Promise<ActionResult<ProviderSiteDto>> {
  const t = await getTranslations("settings.providers.providerSites");
  const tError = await getTranslations("errors");
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const name = input.name?.trim();
    const siteUrl = input.siteUrl?.trim();
    if (!name) {
      return { ok: false, error: t("nameRequired"), errorCode: "NAME_REQUIRED" };
    }
    if (!siteUrl || !isValidUrl(siteUrl)) {
      return { ok: false, error: t("invalidUrl"), errorCode: "INVALID_URL" };
    }
    const existing = await findProviderSiteByName(name);
    if (existing) {
      return { ok: false, error: t("duplicateName"), errorCode: "DUPLICATE_NAME" };
    }

    const site = await repoCreateProviderSite({
      name,
      siteUrl,
      siteType: input.siteType,
      providerVendorId: input.providerVendorId,
      notes: input.notes,
      isEnabled: input.isEnabled,
      upstreamHubChannelId: input.upstreamHubChannelId,
      username: input.username,
      password: input.password,
      turnstileEnabled: input.turnstileEnabled,
      captchaProvider: input.captchaProvider,
      captchaApiKey: input.captchaApiKey,
      captchaEndpoint: input.captchaEndpoint,
    });

    emitActionAudit({
      category: "provider",
      action: "provider_site.create",
      targetType: "provider_site",
      targetId: String(site.id),
      targetName: site.name,
      after: {
        id: site.id,
        name: site.name,
        siteUrl: site.siteUrl,
        siteType: site.siteType,
        isEnabled: site.isEnabled,
      },
      success: true,
    });

    return { ok: true, data: toIsoSiteBase(site) };
  } catch (error) {
    logger.error("Failed to create provider site:", error);
    return {
      ok: false,
      error: t("createFailed"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

export async function updateProviderSite(
  id: number,
  input: UpdateProviderSiteInput
): Promise<ActionResult<ProviderSiteDto>> {
  const t = await getTranslations("settings.providers.providerSites");
  const tError = await getTranslations("errors");
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const existing = await findProviderSiteById(id);
    if (!existing) {
      return { ok: false, error: t("notFound"), errorCode: "NOT_FOUND" };
    }

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) {
        return { ok: false, error: t("nameRequired"), errorCode: "NAME_REQUIRED" };
      }
      const duplicate = await findProviderSiteByName(name);
      if (duplicate && duplicate.id !== id) {
        return { ok: false, error: t("duplicateName"), errorCode: "DUPLICATE_NAME" };
      }
    }
    if (input.siteUrl !== undefined) {
      const siteUrl = input.siteUrl.trim();
      if (!siteUrl || !isValidUrl(siteUrl)) {
        return { ok: false, error: t("invalidUrl"), errorCode: "INVALID_URL" };
      }
    }
    const site = await repoUpdateProviderSite(id, input);
    if (!site) {
      return { ok: false, error: t("notFound"), errorCode: "NOT_FOUND" };
    }

    emitActionAudit({
      category: "provider",
      action: "provider_site.update",
      targetType: "provider_site",
      targetId: String(site.id),
      targetName: site.name,
      before: {
        id: existing.id,
        name: existing.name,
        siteUrl: existing.siteUrl,
        isEnabled: existing.isEnabled,
      },
      after: {
        id: site.id,
        name: site.name,
        siteUrl: site.siteUrl,
        isEnabled: site.isEnabled,
      },
      success: true,
    });

    return { ok: true, data: toIsoSiteBase(site) };
  } catch (error) {
    logger.error("Failed to update provider site:", error);
    return {
      ok: false,
      error: t("updateFailed"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

export async function deleteProviderSite(id: number): Promise<ActionResult<void>> {
  const t = await getTranslations("settings.providers.providerSites");
  const tError = await getTranslations("errors");
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const existing = await findProviderSiteById(id);
    if (!existing) {
      return { ok: false, error: t("notFound"), errorCode: "NOT_FOUND" };
    }

    const ok = await repoDeleteProviderSite(id);
    if (!ok) {
      return { ok: false, error: t("notFound"), errorCode: "NOT_FOUND" };
    }

    emitActionAudit({
      category: "provider",
      action: "provider_site.delete",
      targetType: "provider_site",
      targetId: String(existing.id),
      targetName: existing.name,
      before: {
        id: existing.id,
        name: existing.name,
        siteUrl: existing.siteUrl,
      },
      success: true,
    });

    return { ok: true, data: undefined };
  } catch (error) {
    logger.error("Failed to delete provider site:", error);
    return {
      ok: false,
      error: t("deleteFailed"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

export async function reorderProviderSites(
  orderedIds: number[]
): Promise<ActionResult<ProviderSiteListItem[]>> {
  const t = await getTranslations("settings.providers.providerSites");
  const tError = await getTranslations("errors");
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const ids = Array.from(
      new Set(orderedIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))
    );
    if (ids.length === 0) {
      return { ok: false, error: t("reorderInvalid"), errorCode: ERROR_CODES.INVALID_FORMAT };
    }

    await repoReorderProviderSites(ids);
    const sites = await findAllProviderSitesWithRates();
    emitActionAudit({
      category: "provider",
      action: "provider_site.reorder",
      targetType: "provider_site",
      targetId: "bulk",
      targetName: `reorder:${ids.length}`,
      after: { orderedIds: ids },
      success: true,
    });
    return { ok: true, data: sites.map(toIsoSiteWithRates) };
  } catch (error) {
    logger.error("Failed to reorder provider sites:", error);
    return {
      ok: false,
      error: t("reorderFailed"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

export async function upsertProviderSiteGroupRate(
  siteId: number,
  input: UpsertProviderSiteGroupRateInput
): Promise<ActionResult<ProviderSiteGroupRateDto>> {
  const t = await getTranslations("settings.providers.providerSites");
  const tError = await getTranslations("errors");
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const site = await findProviderSiteById(siteId);
    if (!site) {
      return { ok: false, error: t("notFound"), errorCode: "NOT_FOUND" };
    }

    const groupName = input.groupName?.trim();
    if (!groupName) {
      return { ok: false, error: t("groupNameRequired"), errorCode: "GROUP_NAME_REQUIRED" };
    }
    if (input.ratio !== undefined && (!Number.isFinite(input.ratio) || input.ratio < 0)) {
      return { ok: false, error: t("invalidRatio"), errorCode: "INVALID_RATIO" };
    }
    if (
      input.completionRatio !== undefined &&
      input.completionRatio != null &&
      (!Number.isFinite(input.completionRatio) || input.completionRatio < 0)
    ) {
      return {
        ok: false,
        error: t("invalidCompletionRatio"),
        errorCode: "INVALID_COMPLETION_RATIO",
      };
    }

    const rate = await repoUpsertProviderSiteGroupRate(siteId, {
      ...input,
      groupName,
    });

    emitActionAudit({
      category: "provider",
      action: "provider_site.group_rate.upsert",
      targetType: "provider_site_group_rate",
      targetId: String(rate.id),
      targetName: `${site.name}/${rate.groupName}`,
      after: {
        id: rate.id,
        siteId: rate.siteId,
        groupName: rate.groupName,
        ratio: rate.ratio,
        completionRatio: rate.completionRatio,
        dispatchGroupTag: rate.dispatchGroupTag,
      },
      success: true,
    });

    return { ok: true, data: toIsoRate(rate) };
  } catch (error) {
    logger.error("Failed to upsert provider site group rate:", error);
    return {
      ok: false,
      error: t("rateSaveFailed"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

export async function updateProviderSiteGroupRate(
  id: number,
  input: UpdateProviderSiteGroupRateInput
): Promise<ActionResult<ProviderSiteGroupRateDto>> {
  const t = await getTranslations("settings.providers.providerSites");
  const tError = await getTranslations("errors");
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const existing = await findProviderSiteGroupRateById(id);
    if (!existing) {
      return { ok: false, error: t("rateNotFound"), errorCode: "NOT_FOUND" };
    }

    if (input.groupName !== undefined && !input.groupName.trim()) {
      return { ok: false, error: t("groupNameRequired"), errorCode: "GROUP_NAME_REQUIRED" };
    }
    if (input.ratio !== undefined && (!Number.isFinite(input.ratio) || input.ratio < 0)) {
      return { ok: false, error: t("invalidRatio"), errorCode: "INVALID_RATIO" };
    }
    if (
      input.completionRatio !== undefined &&
      input.completionRatio != null &&
      (!Number.isFinite(input.completionRatio) || input.completionRatio < 0)
    ) {
      return {
        ok: false,
        error: t("invalidCompletionRatio"),
        errorCode: "INVALID_COMPLETION_RATIO",
      };
    }

    const rate = await repoUpdateProviderSiteGroupRate(id, input);
    if (!rate) {
      return { ok: false, error: t("rateNotFound"), errorCode: "NOT_FOUND" };
    }

    emitActionAudit({
      category: "provider",
      action: "provider_site.group_rate.update",
      targetType: "provider_site_group_rate",
      targetId: String(rate.id),
      targetName: rate.groupName,
      before: {
        id: existing.id,
        groupName: existing.groupName,
        ratio: existing.ratio,
        completionRatio: existing.completionRatio,
      },
      after: {
        id: rate.id,
        groupName: rate.groupName,
        ratio: rate.ratio,
        completionRatio: rate.completionRatio,
      },
      success: true,
    });

    return { ok: true, data: toIsoRate(rate) };
  } catch (error) {
    logger.error("Failed to update provider site group rate:", error);
    return {
      ok: false,
      error: t("rateSaveFailed"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

export async function deleteProviderSiteGroupRate(id: number): Promise<ActionResult<void>> {
  const t = await getTranslations("settings.providers.providerSites");
  const tError = await getTranslations("errors");
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const existing = await findProviderSiteGroupRateById(id);
    if (!existing) {
      return { ok: false, error: t("rateNotFound"), errorCode: "NOT_FOUND" };
    }

    const ok = await repoDeleteProviderSiteGroupRate(id);
    if (!ok) {
      return { ok: false, error: t("rateNotFound"), errorCode: "NOT_FOUND" };
    }

    emitActionAudit({
      category: "provider",
      action: "provider_site.group_rate.delete",
      targetType: "provider_site_group_rate",
      targetId: String(existing.id),
      targetName: existing.groupName,
      before: {
        id: existing.id,
        siteId: existing.siteId,
        groupName: existing.groupName,
        ratio: existing.ratio,
      },
      success: true,
    });

    return { ok: true, data: undefined };
  } catch (error) {
    logger.error("Failed to delete provider site group rate:", error);
    return {
      ok: false,
      error: t("rateDeleteFailed"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

export async function syncProviderSiteRates(
  id: number
): Promise<ActionResult<ProviderSiteSyncResultDto>> {
  const t = await getTranslations("settings.providers.providerSites");
  const tError = await getTranslations("errors");
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const existing = await findProviderSiteById(id);
    if (!existing) {
      return { ok: false, error: t("notFound"), errorCode: "NOT_FOUND" };
    }

    const { syncProviderSiteFromUpstream } = await import(
      "@/lib/provider-sites/sync-from-upstream"
    );
    const result = await syncProviderSiteFromUpstream(id);

    emitActionAudit({
      category: "provider",
      action: "provider_site.sync_rates",
      targetType: "provider_site",
      targetId: String(id),
      targetName: existing.name,
      after: {
        ok: result.ok,
        groupsUpserted: result.groupsUpserted,
        balance: result.balance,
        error: result.error ?? null,
      },
      success: result.ok,
    });

    if (!result.ok) {
      return {
        ok: false,
        error: result.error || t("syncFailed"),
        errorCode: ERROR_CODES.OPERATION_FAILED,
      };
    }

    return { ok: true, data: result };
  } catch (error) {
    logger.error("Failed to sync provider site rates:", error);
    return {
      ok: false,
      error: t("syncFailed"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

export async function syncAllProviderSiteRates(): Promise<
  ActionResult<{ items: ProviderSiteSyncResultDto[] }>
> {
  const t = await getTranslations("settings.providers.providerSites");
  const tError = await getTranslations("errors");
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
    }

    const { syncAllEnabledProviderSitesFromUpstream } = await import(
      "@/lib/provider-sites/sync-from-upstream"
    );
    const items = await syncAllEnabledProviderSitesFromUpstream({ concurrency: 3 });

    emitActionAudit({
      category: "provider",
      action: "provider_site.sync_rates_all",
      targetType: "provider_site",
      targetId: "all",
      targetName: "all_enabled_sites",
      after: {
        total: items.length,
        ok: items.filter((i) => i.ok).length,
        failed: items.filter((i) => !i.ok).length,
      },
      success: true,
    });

    return { ok: true, data: { items } };
  } catch (error) {
    logger.error("Failed to sync all provider site rates:", error);
    return {
      ok: false,
      error: t("syncFailed"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}
