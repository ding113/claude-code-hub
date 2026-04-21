"use server";

import { revalidatePath } from "next/cache";
import { locales } from "@/i18n/config";
import { getSession } from "@/lib/auth";
import { invalidateSystemSettingsCache } from "@/lib/config";
import { logger } from "@/lib/logger";
import {
  type EnabledPublicStatusGroup,
  invalidateConfiguredPublicStatusGroupsCache,
  parsePublicStatusDescription,
  serializePublicStatusDescription,
} from "@/lib/public-status/config";
import {
  startPublicStatusScheduler,
  stopPublicStatusScheduler,
} from "@/lib/public-status/scheduler";
import { refreshPublicStatusSnapshot } from "@/lib/public-status/service";
import { findAllProviderGroups, updateProviderGroup } from "@/repository/provider-groups";
import { clearPublicStatusSnapshot } from "@/repository/public-status-snapshot";
import { updateSystemSettings } from "@/repository/system-config";
import type { ActionResult } from "./types";

export interface SavePublicStatusSettingsInput {
  publicStatusWindowHours: number;
  publicStatusAggregationIntervalMinutes: number;
  groups: EnabledPublicStatusGroup[];
}

export async function savePublicStatusSettings(
  input: SavePublicStatusSettingsInput
): Promise<ActionResult<{ updatedGroupCount: number }>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    await updateSystemSettings({
      publicStatusWindowHours: input.publicStatusWindowHours,
      publicStatusAggregationIntervalMinutes: input.publicStatusAggregationIntervalMinutes,
    });

    const allGroups = await findAllProviderGroups();
    const enabledByName = new Map(input.groups.map((group) => [group.groupName, group]));

    let updatedGroupCount = 0;

    for (const group of allGroups) {
      const existing = parsePublicStatusDescription(group.description);
      const configured = enabledByName.get(group.name);
      const nextDescription = serializePublicStatusDescription({
        note: existing.note,
        publicStatus: configured
          ? {
              displayName: configured.displayName,
              modelIds: configured.modelIds,
            }
          : null,
      });

      if (nextDescription && nextDescription.length > 500) {
        return {
          ok: false,
          error: "公开状态配置超过 provider_groups.description 的 500 字符限制",
        };
      }

      if ((group.description ?? null) === nextDescription) {
        continue;
      }

      await updateProviderGroup(group.id, {
        description: nextDescription,
      });
      updatedGroupCount++;
    }

    const hasConfiguredTargets = input.groups.some((group) => group.modelIds.length > 0);
    invalidateSystemSettingsCache();
    invalidateConfiguredPublicStatusGroupsCache();

    if (hasConfiguredTargets) {
      await refreshPublicStatusSnapshot({ force: true });
      startPublicStatusScheduler();
    } else {
      await clearPublicStatusSnapshot();
      await stopPublicStatusScheduler();
    }
    for (const locale of locales) {
      revalidatePath(`/${locale}/settings/status-page`);
      revalidatePath(`/${locale}/status`);
    }
    revalidatePath("/", "layout");

    return { ok: true, data: { updatedGroupCount } };
  } catch (error) {
    logger.error("[PublicStatus] savePublicStatusSettings failed", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "保存公开状态设置失败",
    };
  }
}
