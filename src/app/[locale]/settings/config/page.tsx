import { getTranslations } from "next-intl/server";
import { Section } from "@/components/section";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { getSystemSettings } from "@/repository/system-config";
import { SystemSettingsForm } from "./_components/system-settings-form";
import { AutoCleanupForm } from "./_components/auto-cleanup-form";
import { getEnvConfig } from "@/lib/config/env.schema";

export const dynamic = "force-dynamic";

export default async function SettingsConfigPage() {
  const t = await getTranslations("settings");
  const settings = await getSystemSettings();
  const env = getEnvConfig();

  const envFallback = env.ALLOW_CROSS_GROUP_DEGRADE;
  const isDatabaseSource = settings.id > 0;
  const crossGroupSource: "database" | "environment" | "default" = isDatabaseSource
    ? "database"
    : envFallback !== undefined
      ? "environment"
      : "default";

  const effectiveAllowCrossGroupOnDegrade = isDatabaseSource
    ? settings.allowCrossGroupOnDegrade
    : envFallback ?? false;

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
            allowCrossGroupOnDegrade: effectiveAllowCrossGroupOnDegrade,
            crossGroupConfigSource: crossGroupSource,
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
