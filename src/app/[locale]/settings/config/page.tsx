import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Section } from "@/components/section";
import { getSystemSettings } from "@/repository/system-config";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { AutoCleanupForm } from "./_components/auto-cleanup-form";
import { SettingsConfigSkeleton } from "./_components/settings-config-skeleton";
import { SystemSettingsForm } from "./_components/system-settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsConfigPage() {
  const t = await getTranslations("settings");

  return (
    <>
      <SettingsPageHeader
        title={t("config.title")}
        description={t("config.description")}
        icon="settings"
      />
      <Suspense fallback={<SettingsConfigSkeleton />}>
        <SettingsConfigContent />
      </Suspense>
    </>
  );
}

async function SettingsConfigContent() {
  const t = await getTranslations("settings");
  const settings = await getSystemSettings();

  return (
    <>
      <Section
        title={t("config.section.siteParams.title")}
        description={t("config.section.siteParams.description")}
        icon="settings"
        variant="default"
      >
        <SystemSettingsForm
          initialSettings={{
            siteTitle: settings.siteTitle,
            allowGlobalUsageView: settings.allowGlobalUsageView,
            currencyDisplay: settings.currencyDisplay,
            billingModelSource: settings.billingModelSource,
            verboseProviderError: settings.verboseProviderError,
            enableHttp2: settings.enableHttp2,
            interceptAnthropicWarmupRequests: settings.interceptAnthropicWarmupRequests,
            enableThinkingSignatureRectifier: settings.enableThinkingSignatureRectifier,
            enableCodexSessionIdCompletion: settings.enableCodexSessionIdCompletion,
            enableResponseFixer: settings.enableResponseFixer,
            responseFixerConfig: settings.responseFixerConfig,
          }}
        />
      </Section>

      <Section
        title={t("config.section.autoCleanup.title")}
        description={t("config.section.autoCleanup.description")}
        icon="trash"
        iconColor="text-red-400"
        variant="default"
      >
        <AutoCleanupForm settings={settings} />
      </Section>
    </>
  );
}
