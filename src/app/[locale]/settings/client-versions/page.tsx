import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { fetchClientVersionStats } from "@/actions/client-versions";
import { fetchSystemSettings } from "@/actions/system-config";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { ClientVersionStatsTable } from "./_components/client-version-stats-table";
import { ClientVersionToggle } from "./_components/client-version-toggle";
import {
  ClientVersionsSettingsSkeleton,
  ClientVersionsTableSkeleton,
} from "./_components/client-versions-skeleton";

export default async function ClientVersionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  // Await params to ensure locale is available in the async context
  const { locale } = await params;

  const t = await getTranslations("settings");
  const session = await getSession();

  if (!session || session.user.role !== "admin") {
    return redirect({ href: "/login", locale });
  }

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={t("clientVersions.title")}
        description={t("clientVersions.description")}
      />
      {/* 功能开关和说明 */}
      <Card>
        <CardHeader>
          <CardTitle>{t("clientVersions.section.settings.title")}</CardTitle>
          <CardDescription>{t("clientVersions.section.settings.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<ClientVersionsSettingsSkeleton />}>
            <ClientVersionsSettingsContent />
          </Suspense>
        </CardContent>
      </Card>

      {/* 版本统计表格 */}
      <Card>
        <CardHeader>
          <CardTitle>{t("clientVersions.section.distribution.title")}</CardTitle>
          <CardDescription>{t("clientVersions.section.distribution.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<ClientVersionsTableSkeleton />}>
            <ClientVersionsStatsContent />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

async function ClientVersionsSettingsContent() {
  const settingsResult = await fetchSystemSettings();
  const enableClientVersionCheck = settingsResult.ok
    ? settingsResult.data.enableClientVersionCheck
    : false;

  return <ClientVersionToggle enabled={enableClientVersionCheck} />;
}

async function ClientVersionsStatsContent() {
  const t = await getTranslations("settings");
  const statsResult = await fetchClientVersionStats();
  const stats = statsResult.ok ? statsResult.data : [];

  if (!stats || stats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground">{t("clientVersions.empty.title")}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("clientVersions.empty.description")}
        </p>
      </div>
    );
  }

  return <ClientVersionStatsTable data={stats} />;
}
