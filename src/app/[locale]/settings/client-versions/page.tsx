import { getTranslations } from "next-intl/server";
import { fetchClientVersionStats } from "@/actions/client-versions";
import { fetchSystemSettings } from "@/actions/system-config";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { ClientVersionStatsTable } from "./_components/client-version-stats-table";
import { ClientVersionToggle } from "./_components/client-version-toggle";

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

  const [statsResult, settingsResult] = await Promise.all([
    fetchClientVersionStats(),
    fetchSystemSettings(),
  ]);

  const stats = statsResult.ok ? statsResult.data : [];
  const enableClientVersionCheck = settingsResult.ok
    ? settingsResult.data.enableClientVersionCheck
    : false;

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
          <ClientVersionToggle enabled={enableClientVersionCheck} />
        </CardContent>
      </Card>

      {/* 版本统计表格 */}
      <Card>
        <CardHeader>
          <CardTitle>{t("clientVersions.section.distribution.title")}</CardTitle>
          <CardDescription>{t("clientVersions.section.distribution.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {stats && stats.length > 0 ? (
            <ClientVersionStatsTable data={stats} />
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-muted-foreground">{t("clientVersions.empty.title")}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("clientVersions.empty.description")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
