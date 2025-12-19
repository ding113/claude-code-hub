import { BarChart3 } from "lucide-react";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { getProviders, getProvidersHealthStatus } from "@/actions/providers";
import { LoadingState, TableSkeleton } from "@/components/loading/page-skeletons";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { getEnvConfig } from "@/lib/config/env.schema";
import { getSystemSettings } from "@/repository/system-config";
import type { User } from "@/types/user";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { AddProviderDialog } from "./_components/add-provider-dialog";
import { ProviderManager } from "./_components/provider-manager";
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
            <AddProviderDialog enableMultiProviderTypes={enableMultiProviderTypes} />
          </>
        }
      >
        <Suspense
          fallback={
            <div className="space-y-4">
              <TableSkeleton rows={6} columns={6} />
              <LoadingState />
            </div>
          }
        >
          <SettingsProvidersContent
            currentUser={session?.user}
            enableMultiProviderTypes={enableMultiProviderTypes}
          />
        </Suspense>
      </Section>
    </>
  );
}

async function SettingsProvidersContent({
  currentUser,
  enableMultiProviderTypes,
}: {
  currentUser?: User;
  enableMultiProviderTypes: boolean;
}) {
  const [providers, healthStatus, systemSettings] = await Promise.all([
    getProviders(),
    getProvidersHealthStatus(),
    getSystemSettings(),
  ]);

  return (
    <ProviderManager
      providers={providers}
      currentUser={currentUser}
      healthStatus={healthStatus}
      currencyCode={systemSettings.currencyDisplay}
      enableMultiProviderTypes={enableMultiProviderTypes}
    />
  );
}
