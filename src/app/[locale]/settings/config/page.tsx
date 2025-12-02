import { getTranslations } from "next-intl/server";
import { Section } from "@/components/section";
import { getSystemSettings } from "@/repository/system-config";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { AutoCleanupForm } from "./_components/auto-cleanup-form";
import { SystemSettingsForm } from "./_components/system-settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsConfigPage() {
  const t = await getTranslations("settings");
  const settings = await getSystemSettings();

  return (
    <>
      <SettingsPageHeader title={t("config.title")} description={t("config.description")} />

      <Section
        title={t("config.section.siteParams.title")}
        description={t("config.section.siteParams.description")}
      >
        <SystemSettingsForm
          initialSettings={{
            siteTitle: settings.siteTitle,
            allowGlobalUsageView: settings.allowGlobalUsageView,
            currencyDisplay: settings.currencyDisplay,
            billingModelSource: settings.billingModelSource,
            verboseProviderError: settings.verboseProviderError,
            enableHttp2: settings.enableHttp2,
          }}
        />
      </Section>

      <Section
        title={t("config.section.autoCleanup.title")}
        description={t("config.section.autoCleanup.description")}
      >
        <AutoCleanupForm settings={settings} />
      </Section>
    </>
  );
}
