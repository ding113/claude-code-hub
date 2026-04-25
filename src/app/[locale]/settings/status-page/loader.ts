import { bootstrapProviderGroupsFromProviders } from "@/lib/provider-groups/bootstrap";
import {
  createUniquePublicGroupSlug,
  normalizePublicGroupSlug,
  parsePublicStatusDescription,
} from "@/lib/public-status/config";
import { getSystemSettings } from "@/repository/system-config";
import type { PublicStatusSettingsFormGroup } from "./_components/public-status-settings-form";

export async function loadStatusPageSettings(): Promise<{
  initialWindowHours: number;
  initialAggregationIntervalMinutes: number;
  initialGroups: PublicStatusSettingsFormGroup[];
}> {
  const settings = await getSystemSettings();
  const { groups } = await bootstrapProviderGroupsFromProviders();
  const parsedGroups = groups.map((group) => ({
    group,
    parsed: parsePublicStatusDescription(group.description),
  }));
  const usedDefaultSlugs = new Set<string>();
  for (const { group, parsed } of parsedGroups) {
    if (parsed.publicStatus?.publicGroupSlug) {
      usedDefaultSlugs.add(
        normalizePublicGroupSlug(group.name, parsed.publicStatus.publicGroupSlug)
      );
    }
  }

  return {
    initialWindowHours: settings.publicStatusWindowHours,
    initialAggregationIntervalMinutes: settings.publicStatusAggregationIntervalMinutes,
    initialGroups: parsedGroups.map(({ group, parsed }) => {
      const publicGroupSlug =
        parsed.publicStatus?.publicGroupSlug ??
        createUniquePublicGroupSlug(group.name, usedDefaultSlugs);

      return {
        groupName: group.name,
        enabled: (parsed.publicStatus?.publicModels.length ?? 0) > 0,
        displayName: parsed.publicStatus?.displayName ?? "",
        publicGroupSlug,
        explanatoryCopy: parsed.publicStatus?.explanatoryCopy ?? "",
        sortOrder: parsed.publicStatus?.sortOrder ?? 0,
        publicModels: parsed.publicStatus?.publicModels ?? [],
      };
    }),
  };
}
