import { getTranslations } from "next-intl/server";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { PublicStatusSettingsForm } from "./_components/public-status-settings-form";
import { loadStatusPageSettings } from "./loader";

export const dynamic = "force-dynamic";

export default async function StatusPageSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "settings" });
  const settings = await loadStatusPageSettings();

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={t("statusPage.title")}
        description={t("statusPage.description")}
        icon="activity"
      />
      <PublicStatusSettingsForm
        initialWindowHours={settings.initialWindowHours}
        initialAggregationIntervalMinutes={settings.initialAggregationIntervalMinutes}
        initialGroups={settings.initialGroups}
      />
    </div>
  );
}
