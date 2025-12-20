import { BarChart3 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { getEnvConfig } from "@/lib/config/env.schema";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { AddProviderDialog } from "./_components/add-provider-dialog";
import { ProviderManagerLoader } from "./_components/provider-manager-loader";
import { SchedulingRulesDialog } from "./_components/scheduling-rules-dialog";

export const dynamic = "force-dynamic";

export default async function SettingsProvidersPage() {
  const t = await getTranslations("settings");
  const session = await getSession();

  // 读取多供应商类型支持配置
  const enableMultiProviderTypes = getEnvConfig().ENABLE_MULTI_PROVIDER_TYPES;

  return (
    <>
      <SettingsPageHeader title={t("providers.title")} description={t("providers.description")} />

      <Section
        title={t("providers.section.title")}
        description={t("providers.section.description")}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/dashboard/leaderboard?scope=provider">
                <BarChart3 className="h-4 w-4" />
                {t("providers.section.leaderboard")}
              </Link>
            </Button>
            <SchedulingRulesDialog />
          </>
        }
      >
        <ProviderManagerLoader
          currentUser={session?.user}
          enableMultiProviderTypes={enableMultiProviderTypes}
          addDialogSlot={<AddProviderDialog enableMultiProviderTypes={enableMultiProviderTypes} />}
        />
      </Section>
    </>
  );
}
