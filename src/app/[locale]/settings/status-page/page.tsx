import { getTranslations } from "next-intl/server";
import { parsePublicStatusDescription } from "@/lib/public-status/config";
import { findAllProviderGroups } from "@/repository/provider-groups";
import { getSystemSettings } from "@/repository/system-config";
import { SettingsPageHeader } from "../_components/settings-page-header";
import {
  PublicStatusSettingsForm,
  type PublicStatusSettingsFormGroup,
} from "./_components/public-status-settings-form";

export const dynamic = "force-dynamic";

export default async function StatusPageSettingsPage() {
  const t = await getTranslations("settings");
  const settings = await getSystemSettings();
  const groups = await findAllProviderGroups();

  const initialGroups: PublicStatusSettingsFormGroup[] = groups.map((group) => {
    const parsed = parsePublicStatusDescription(group.description);

    return {
      groupName: group.name,
      enabled: !!parsed.publicStatus && parsed.publicStatus.modelIds.length > 0,
      displayName: parsed.publicStatus?.displayName ?? "",
      modelIdsText: parsed.publicStatus?.modelIds.join("\n") ?? "",
    };
  });

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={t("statusPage.title")}
        description={t("statusPage.description")}
        icon="activity"
      />
      <PublicStatusSettingsForm
        initialWindowHours={settings.publicStatusWindowHours}
        initialAggregationIntervalMinutes={settings.publicStatusAggregationIntervalMinutes}
        initialGroups={initialGroups}
      />
    </div>
  );
}
