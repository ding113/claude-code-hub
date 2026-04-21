"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { db } from "@/drizzle/db";
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
import {
  findAllProviderGroups,
  findProviderGroupById,
  updateProviderGroup,
} from "@/repository/provider-groups";
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

export async function savePublicStatusSettings(input: SavePublicStatusSettingsInput): Promise<
  ActionResult<{
    updatedGroupCount: number;
    configVersion: string;
    publicStatusProjectionWarningCode: string | null;
  }>
> {
  try {
    const t = await getTranslations("settings");
    const tError = await getTranslations("errors");
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: tError("UNAUTHORIZED") };
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
    const groupUpdates: Array<{
      id: number;
      publicStatus: ReturnType<typeof parsePublicStatusDescription>["publicStatus"];
    }> = [];

    for (const group of allGroups) {
      const existing = parsePublicStatusDescription(group.description);
      const configured = enabledByName.get(group.name);
      const nextPublicStatus = configured
        ? {
            displayName: configured.displayName,
            publicGroupSlug: configured.publicGroupSlug,
            explanatoryCopy: configured.explanatoryCopy,
            sortOrder: configured.sortOrder,
            publicModelKeys: configured.publicModelKeys,
          }
        : null;
      const nextDescription = serializePublicStatusDescription({
        note: existing.note,
        publicStatus: nextPublicStatus,
      });

      if (nextDescription && nextDescription.length > 500) {
        return {
          ok: false,
          error: t("statusPage.form.descriptionTooLong"),
        };
      }

      if ((group.description ?? null) !== nextDescription) {
        groupUpdates.push({
          id: group.id,
          publicStatus: nextPublicStatus,
        });
      }
    }

    const settings = await db.transaction(async (tx) => {
      const updatedSettings = await updateSystemSettings(
        {
          publicStatusWindowHours: validatedSettings.publicStatusWindowHours,
          publicStatusAggregationIntervalMinutes:
            validatedSettings.publicStatusAggregationIntervalMinutes,
        },
        tx
      );

      for (const groupUpdate of groupUpdates) {
        const currentGroup = await findProviderGroupById(groupUpdate.id, tx);
        const currentNote = parsePublicStatusDescription(currentGroup?.description).note;
        await updateProviderGroup(
          groupUpdate.id,
          {
            description: serializePublicStatusDescription({
              note: currentNote,
              publicStatus: groupUpdate.publicStatus,
            }),
          },
          tx
        );
      }

      return updatedSettings;
    });

    const configVersion = `cfg-${Date.now()}`;
    let publishResult: {
      configVersion: string;
      key: string;
      written: boolean;
      groupCount: number;
    } = {
      configVersion,
      key: "",
      written: false,
      groupCount: normalizedEnabledGroups.length,
    };
    let publicStatusProjectionWarningCode: string | null = null;
    try {
      publishResult = await publishCurrentPublicStatusConfigProjection({
        reason: "save-public-status-settings",
        configVersion,
      });
    } catch (error) {
      logger.warn("[PublicStatus] DB truth saved but failed to publish Redis projection", error);
      publicStatusProjectionWarningCode = "PUBLIC_STATUS_PROJECTION_PUBLISH_FAILED";
    }

    if (!publishResult.written) {
      publicStatusProjectionWarningCode = "PUBLIC_STATUS_PROJECTION_PUBLISH_FAILED";
    } else {
      try {
        await schedulePublicStatusRebuild({
          intervalMinutes: settings.publicStatusAggregationIntervalMinutes,
          rangeHours: settings.publicStatusWindowHours,
          reason: "config-updated",
        });
      } catch (error) {
        logger.warn("[PublicStatus] DB truth saved but failed to schedule rebuild hint", error);
        publicStatusProjectionWarningCode = "PUBLIC_STATUS_BACKGROUND_REFRESH_PENDING";
      }
    }

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
        publicStatusProjectionWarningCode,
      },
    };
  } catch (error) {
    logger.error("[PublicStatus] savePublicStatusSettings failed", error);
    const t = await getTranslations("settings");
    return {
      ok: false,
      error: t("statusPage.form.saveFailed"),
    };
  }
}
