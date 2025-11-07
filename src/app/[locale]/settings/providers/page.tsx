import { getTranslations } from "next-intl/server";
import { getProviders, getProvidersHealthStatus } from "@/actions/providers";
import { Section } from "@/components/section";
import { ProviderManager } from "./_components/provider-manager";
import { AddProviderDialog } from "./_components/add-provider-dialog";
import { SchedulingRulesDialog } from "./_components/scheduling-rules-dialog";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { getSession } from "@/lib/auth";
import { getSystemSettings } from "@/repository/system-config";
import { getEnvConfig } from "@/lib/config/env.schema";

export const dynamic = "force-dynamic";

export default async function SettingsProvidersPage() {
  const t = await getTranslations("settings");
  const [providers, session, healthStatus, systemSettings] = await Promise.all([
    getProviders(),
    getSession(),
    getProvidersHealthStatus(),
    getSystemSettings(),
  ]);

  // 读取多供应商类型支持配置
  const enableMultiProviderTypes = getEnvConfig().ENABLE_MULTI_PROVIDER_TYPES;

  return (
    <>
      <SettingsPageHeader title={t("providers.title")} description={t("providers.description")} />

      <Section
        title={t("providers.section.title")}
        description={t("providers.section.description")}
        actions={
          <div className="flex gap-2">
            <SchedulingRulesDialog />
            <AddProviderDialog enableMultiProviderTypes={enableMultiProviderTypes} />
          </div>
        }
      >
        <ProviderManager
          providers={providers}
          currentUser={session?.user}
          healthStatus={healthStatus}
          currencyCode={systemSettings.currencyDisplay}
          enableMultiProviderTypes={enableMultiProviderTypes}
        />
      </Section>
    </>
  );
}
