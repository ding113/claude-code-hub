import { bootstrapProviderGroupsFromProviders } from "@/lib/provider-groups/bootstrap";
import {
  createUniquePublicGroupSlug,
  parsePublicStatusDescription,
  slugifyPublicGroup,
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
  const usedDefaultSlugs = new Set<string>();

  return {
    initialWindowHours: settings.publicStatusWindowHours,
    initialAggregationIntervalMinutes: settings.publicStatusAggregationIntervalMinutes,
    initialGroups: groups.map((group) => {
      const parsed = parsePublicStatusDescription(group.description);
      const publicGroupSlug =
        parsed.publicStatus?.publicGroupSlug ??
        createUniquePublicGroupSlug(group.name, usedDefaultSlugs);
      if (parsed.publicStatus?.publicGroupSlug) {
        const normalizedConfiguredSlug = slugifyPublicGroup(parsed.publicStatus.publicGroupSlug);
        if (normalizedConfiguredSlug) {
          usedDefaultSlugs.add(normalizedConfiguredSlug);
        }
      }

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
