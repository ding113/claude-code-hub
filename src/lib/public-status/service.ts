import { getCachedSystemSettings } from "@/lib/config/system-settings-cache";
import { findAllProviderGroups } from "@/repository/provider-groups";
import {
  clearPublicStatusSnapshot,
  getPublicStatusSnapshotRecord,
  savePublicStatusSnapshot,
} from "@/repository/public-status-snapshot";
import { aggregatePublicStatusSnapshot } from "./aggregation";
import {
  collectEnabledPublicStatusGroups,
  getConfiguredPublicStatusGroupsOnlyCache,
  parsePublicStatusDescription,
  setConfiguredPublicStatusGroupsCache,
} from "./config";

export async function refreshPublicStatusSnapshot(options?: {
  force?: boolean;
}): Promise<
  | { status: "disabled"; reason: "no-configured-targets" }
  | { status: "skipped"; reason: "not-due" }
  | { status: "updated"; groupCount: number; modelCount: number }
> {
  const currentSnapshot = await getPublicStatusSnapshotRecord();
  if (currentSnapshot && !options?.force) {
    const lastAggregatedAt = new Date(currentSnapshot.aggregatedAt).getTime();
    const intervalMs = currentSnapshot.payload.bucketMinutes * 60 * 1000;
    if (Number.isFinite(lastAggregatedAt) && Date.now() - lastAggregatedAt < intervalMs) {
      return {
        status: "skipped",
        reason: "not-due",
      };
    }
  }

  const settings = await getCachedSystemSettings();
  const enabledGroups =
    getConfiguredPublicStatusGroupsOnlyCache() ??
    collectEnabledPublicStatusGroups(
      (await findAllProviderGroups()).map((group) => ({
        groupName: group.name,
        ...parsePublicStatusDescription(group.description),
      }))
    );

  setConfiguredPublicStatusGroupsCache(enabledGroups);

  if (enabledGroups.length === 0) {
    await clearPublicStatusSnapshot();
    return {
      status: "disabled",
      reason: "no-configured-targets",
    };
  }

  const payload = await aggregatePublicStatusSnapshot({
    windowHours: settings.publicStatusWindowHours,
    bucketMinutes: settings.publicStatusAggregationIntervalMinutes,
    groups: enabledGroups,
  });

  await savePublicStatusSnapshot(payload);

  return {
    status: "updated",
    groupCount: enabledGroups.length,
    modelCount: enabledGroups.reduce((sum, group) => sum + group.modelIds.length, 0),
  };
}
