import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getKeys } from "@/actions/keys";
import { getProviders } from "@/actions/providers";
import { getUsers } from "@/actions/users";
import { ActiveSessionsPanel } from "@/components/customs/active-sessions-panel";
import { Section } from "@/components/section";
import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { getSystemSettings } from "@/repository/system-config";
import { UsageLogsView } from "./_components/usage-logs-view";

export const dynamic = "force-dynamic";

export default async function UsageLogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Await params to ensure locale is available in the async context
  const { locale } = await params;

  const session = await getSession();
  if (!session) {
    return redirect({ href: "/login", locale });
  }

  const isAdmin = session.user.role === "admin";

  const t = await getTranslations("dashboard");

  // 管理员：获取用户和供应商列表
  // 非管理员：获取当前用户的 Keys 列表
  const [users, providers, initialKeys, resolvedSearchParams, systemSettings] = isAdmin
    ? await Promise.all([
        getUsers(),
        getProviders(),
        Promise.resolve({ ok: true, data: [] }),
        searchParams,
        getSystemSettings(),
      ])
    : await Promise.all([
        Promise.resolve([]),
        Promise.resolve([]),
        getKeys(session.user.id),
        searchParams,
        getSystemSettings(),
      ]);

  return (
    <div className="space-y-6">
      <ActiveSessionsPanel currencyCode={systemSettings.currencyDisplay} />

      <Section title={t("title.usageLogs")} description={t("title.usageLogsDescription")}>
        <Suspense
          fallback={
            <div className="text-center py-8 text-muted-foreground">{t("logs.stats.loading")}</div>
          }
        >
          <UsageLogsView
            isAdmin={isAdmin}
            users={users}
            providers={providers}
            initialKeys={initialKeys.ok ? initialKeys.data : []}
            searchParams={resolvedSearchParams}
            currencyCode={systemSettings.currencyDisplay}
            billingModelSource={systemSettings.billingModelSource}
          />
        </Suspense>
      </Section>
    </div>
  );
}
