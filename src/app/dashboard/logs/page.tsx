import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Section } from "@/components/section";
import { UsageLogsView } from "./_components/usage-logs-view";
import { ActiveSessionsPanel } from "@/components/customs/active-sessions-panel";
import { getUsers } from "@/actions/users";
import { getProviders } from "@/actions/providers";
import { getSystemSettings } from "@/repository/system-config";
import { getPrivacyContext } from "@/lib/utils/privacy-filter.server";

export const dynamic = "force-dynamic";

export default async function UsageLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const isAdmin = session.user.role === "admin";

  // 只有 admin 才需要获取用户和供应商列表
  const [users, providers, resolvedSearchParams, systemSettings, privacyContext] = isAdmin
    ? await Promise.all([
        getUsers(),
        getProviders(),
        searchParams,
        getSystemSettings(),
        getPrivacyContext(),
      ])
    : [[], [], await searchParams, await getSystemSettings(), await getPrivacyContext()];

  return (
    <div className="space-y-6">
      <ActiveSessionsPanel
        currencyCode={privacyContext.userCurrency}
        canViewProviderInfo={privacyContext.isAdmin || privacyContext.allowViewProviderInfo}
      />

      <Section
        title="使用记录"
        description="查看 API 调用日志和使用统计"
      >
        <Suspense fallback={<div className="text-center py-8 text-muted-foreground">加载中...</div>}>
          <UsageLogsView
            isAdmin={isAdmin}
            users={users}
            providers={providers}
            searchParams={resolvedSearchParams}
            privacyContext={privacyContext}
          />
        </Suspense>
      </Section>
    </div>
  );
}
