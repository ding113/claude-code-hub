"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { locales } from "@/i18n/config";
import { getSession } from "@/lib/auth";
import { invalidateSystemSettingsCache } from "@/lib/config";
import { logger } from "@/lib/logger";
import {
  collectEnabledPublicStatusGroups,
  type EnabledPublicStatusGroup,
  invalidateConfiguredPublicStatusGroupsCache,
  parsePublicStatusDescription,
  serializePublicStatusDescription,
} from "@/lib/public-status/config";
import { publishCurrentPublicStatusConfigProjection } from "@/lib/public-status/config-publisher";
import { PUBLIC_STATUS_INTERVAL_SET } from "@/lib/public-status/constants";
import { schedulePublicStatusRebuild } from "@/lib/public-status/rebuild-hints";
import { UpdateSystemSettingsSchema } from "@/lib/validation/schemas";
import { findAllProviderGroups, updateProviderGroup } from "@/repository/provider-groups";
import { updateSystemSettings } from "@/repository/system-config";
import type { ActionResult } from "./types";

export interface SavePublicStatusSettingsInput {
  publicStatusWindowHours: number;
  publicStatusAggregationIntervalMinutes: number;
  groups: Array<{
    groupName: string;
    displayName?: string;
    publicGroupSlug?: string;
    explanatoryCopy?: string | null;
    sortOrder?: number;
    publicModelKeys: string[];
  }>;
}

function normalizeEnabledGroups(
  groups: SavePublicStatusSettingsInput["groups"]
): EnabledPublicStatusGroup[] {
  return collectEnabledPublicStatusGroups(
    groups.map((group) => ({
      groupName: group.groupName,
      note: null,
      publicStatus: {
        displayName: group.displayName,
        publicGroupSlug: group.publicGroupSlug,
        explanatoryCopy: group.explanatoryCopy,
        sortOrder: group.sortOrder,
        publicModelKeys: group.publicModelKeys,
      },
    }))
  );
}

export async function savePublicStatusSettings(
  input: SavePublicStatusSettingsInput
): Promise<ActionResult<{ updatedGroupCount: number; configVersion: string }>> {
  try {
    const t = await getTranslations("settings");
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }
    if (!PUBLIC_STATUS_INTERVAL_SET.has(input.publicStatusAggregationIntervalMinutes)) {
      return {
        ok: false,
        error: t("statusPage.form.aggregationIntervalMinutesInvalid"),
      };
    }

    const validatedSettings = UpdateSystemSettingsSchema.parse({
      publicStatusWindowHours: input.publicStatusWindowHours,
      publicStatusAggregationIntervalMinutes: input.publicStatusAggregationIntervalMinutes,
    });
    const normalizedEnabledGroups = normalizeEnabledGroups(input.groups);

    const allGroups = await findAllProviderGroups();
    const enabledByName = new Map(
      normalizedEnabledGroups.map((group) => [group.groupName, group] as const)
    );
    const groupUpdates: Array<{ id: number; description: string | null }> = [];

    for (const group of allGroups) {
      const existing = parsePublicStatusDescription(group.description);
      const configured = enabledByName.get(group.name);
      const nextDescription = serializePublicStatusDescription({
        note: existing.note,
        publicStatus: configured
          ? {
              displayName: configured.displayName,
              publicGroupSlug: configured.publicGroupSlug,
              explanatoryCopy: configured.explanatoryCopy,
              sortOrder: configured.sortOrder,
              publicModelKeys: configured.publicModelKeys,
            }
          : null,
      });

      if (nextDescription && nextDescription.length > 500) {
        return {
          ok: false,
          error: "公开状态配置超过 provider_groups.description 的 500 字符限制",
        };
      }

      if ((group.description ?? null) !== nextDescription) {
        groupUpdates.push({
          id: group.id,
          description: nextDescription,
        });
      }
    }

    const settings = await updateSystemSettings({
      publicStatusWindowHours: validatedSettings.publicStatusWindowHours,
      publicStatusAggregationIntervalMinutes:
        validatedSettings.publicStatusAggregationIntervalMinutes,
    });

    for (const groupUpdate of groupUpdates) {
      await updateProviderGroup(groupUpdate.id, {
        description: groupUpdate.description,
      });
    }

    const configVersion = `cfg-${Date.now()}`;
    const publishResult = await publishCurrentPublicStatusConfigProjection({
      reason: "save-public-status-settings",
      configVersion,
    });
    if (!publishResult.written) {
      return {
        ok: false,
        error: "公开状态 Redis 投影发布失败",
      };
    }
    await schedulePublicStatusRebuild({
      intervalMinutes: settings.publicStatusAggregationIntervalMinutes,
      rangeHours: settings.publicStatusWindowHours,
      reason: "config-updated",
    });

    invalidateSystemSettingsCache();
    invalidateConfiguredPublicStatusGroupsCache();

    for (const locale of locales) {
      revalidatePath(`/${locale}/settings/config`);
      revalidatePath(`/${locale}/settings/providers`);
      revalidatePath(`/${locale}/status`);
    }
    revalidatePath("/", "layout");

    return {
      ok: true,
      data: {
        updatedGroupCount: groupUpdates.length,
        configVersion: publishResult.configVersion,
      },
    };
  } catch (error) {
    logger.error("[PublicStatus] savePublicStatusSettings failed", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "保存公开状态设置失败",
    };
  }
}
