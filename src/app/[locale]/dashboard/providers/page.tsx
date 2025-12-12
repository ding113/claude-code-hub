import { BarChart3 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getProviders, getProvidersHealthStatus } from "@/actions/providers";
import { AddProviderDialog } from "@/app/[locale]/settings/providers/_components/add-provider-dialog";
import { ProviderManager } from "@/app/[locale]/settings/providers/_components/provider-manager";
import { SchedulingRulesDialog } from "@/app/[locale]/settings/providers/_components/scheduling-rules-dialog";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Link, redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { getEnvConfig } from "@/lib/config/env.schema";
import { getSystemSettings } from "@/repository/system-config";

export const dynamic = "force-dynamic";

export default async function DashboardProvidersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  // Await params to ensure locale is available in the async context
  const { locale } = await params;

  // 权限检查：仅 admin 用户可访问
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    redirect({ href: session ? "/dashboard" : "/login", locale });
  }

  // TypeScript: session is guaranteed to be non-null after the redirect check
  const currentUser = session!.user;

  const t = await getTranslations("settings");
  const [providers, healthStatus, systemSettings] = await Promise.all([
    getProviders(),
    getProvidersHealthStatus(),
    getSystemSettings(),
  ]);

  // 读取多供应商类型支持配置
  const enableMultiProviderTypes = getEnvConfig().ENABLE_MULTI_PROVIDER_TYPES;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("providers.title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("providers.description")}</p>
      </div>

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
        <ProviderManager
          providers={providers}
          currentUser={currentUser}
          healthStatus={healthStatus}
          currencyCode={systemSettings.currencyDisplay}
          enableMultiProviderTypes={enableMultiProviderTypes}
        />
      </Section>
    </div>
  );
}
