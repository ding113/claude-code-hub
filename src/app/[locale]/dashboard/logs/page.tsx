import { Suspense } from "react";
import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { Section } from "@/components/section";
import { UsageLogsView } from "./_components/usage-logs-view";
import { ActiveSessionsPanel } from "@/components/customs/active-sessions-panel";
import { getUsers } from "@/actions/users";
import { getProviders } from "@/actions/providers";
import { getKeys } from "@/actions/keys";
import { getSystemSettings } from "@/repository/system-config";

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

  // 管理员：获取用户和供应商列表
  // 非管理员：获取当前用户的 Keys 列表
  const [users, providers, initialKeys, resolvedSearchParams, systemSettings] = isAdmin
    ? await Promise.all([getUsers(), getProviders(), Promise.resolve({ ok: true, data: [] }), searchParams, getSystemSettings()])
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

      <Section
        title="使用记录"
        description="查看 API 调用日志和使用统计"
      >
        <Suspense fallback={<div className="text-center py-8 text-muted-foreground">加载中...</div>}>
          <UsageLogsView
            isAdmin={isAdmin}
            users={users}
            providers={providers}
            initialKeys={initialKeys.ok ? initialKeys.data : []}
            searchParams={resolvedSearchParams}
            currencyCode={systemSettings.currencyDisplay}
          />
        </Suspense>
      </Section>
    </div>
  );
}
