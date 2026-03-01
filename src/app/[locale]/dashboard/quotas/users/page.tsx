import { Info } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getUserLimitUsage, getUsers } from "@/actions/users";
import { QuotaToolbar } from "@/components/quota/quota-toolbar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Link, redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { sumKeyTotalCostBatchByIds, sumUserTotalCostBatch } from "@/repository/statistics";
import { getSystemSettings } from "@/repository/system-config";
import { UsersQuotaSkeleton } from "../_components/users-quota-skeleton";
import type { UserKeyWithUsage, UserQuotaWithUsage } from "./_components/types";
import { UsersQuotaClient } from "./_components/users-quota-client";

// Force dynamic rendering (this page needs real-time data and auth)
export const dynamic = "force-dynamic";

async function getUsersWithQuotas(): Promise<UserQuotaWithUsage[]> {
  const users = await getUsers();

  const allUserIds = users.map((u) => u.id);
  const allKeyIds = users.flatMap((u) => u.keys.map((k) => k.id));

  // 3 queries total instead of N+M individual SUM queries
  const [quotaResults, userCostMap, keyCostMap] = await Promise.all([
    Promise.all(users.map((u) => getUserLimitUsage(u.id))),
    sumUserTotalCostBatch(allUserIds),
    sumKeyTotalCostBatchByIds(allKeyIds),
  ]);

  return users.map((user, idx) => {
    const quotaResult = quotaResults[idx];

    const keysWithUsage: UserKeyWithUsage[] = user.keys.map((key) => ({
      id: key.id,
      name: key.name,
      status: key.status,
      todayUsage: key.todayUsage,
      totalUsage: keyCostMap.get(key.id) ?? 0,
      limit5hUsd: key.limit5hUsd,
      limitDailyUsd: key.limitDailyUsd,
      limitWeeklyUsd: key.limitWeeklyUsd,
      limitMonthlyUsd: key.limitMonthlyUsd,
      limitTotalUsd: key.limitTotalUsd ?? null,
      limitConcurrentSessions: key.limitConcurrentSessions,
      limitConcurrentUas: key.limitConcurrentUas,
      dailyResetMode: key.dailyResetMode,
      dailyResetTime: key.dailyResetTime,
    }));

    return {
      id: user.id,
      name: user.name,
      note: user.note,
      role: user.role,
      isEnabled: user.isEnabled,
      expiresAt: user.expiresAt ?? null,
      providerGroup: user.providerGroup,
      tags: user.tags,
      quota: quotaResult.ok ? quotaResult.data : null,
      limit5hUsd: user.limit5hUsd ?? null,
      limitWeeklyUsd: user.limitWeeklyUsd ?? null,
      limitMonthlyUsd: user.limitMonthlyUsd ?? null,
      limitTotalUsd: user.limitTotalUsd ?? null,
      limitConcurrentSessions: user.limitConcurrentSessions ?? null,
      limitConcurrentUas: user.limitConcurrentUas ?? null,
      totalUsage: userCostMap.get(user.id) ?? 0,
      keys: keysWithUsage,
    };
  });
}

export default async function UsersQuotaPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();

  if (!session || session.user.role !== "admin") {
    return redirect({ href: session ? "/dashboard/my-quota" : "/login", locale });
  }

  const t = await getTranslations("quota.users");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">{t("title")}</h3>
        </div>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          {t("manageNotice")}{" "}
          <Link href="/dashboard/users" className="font-medium underline underline-offset-4">
            {t("manageLink")}
          </Link>
        </AlertDescription>
      </Alert>

      <QuotaToolbar
        sortOptions={[
          { value: "name", label: t("sort.name") },
          { value: "usage", label: t("sort.usage") },
        ]}
        filterOptions={[
          { value: "all", label: t("filter.all") },
          { value: "warning", label: t("filter.warning") },
          { value: "exceeded", label: t("filter.exceeded") },
        ]}
      />

      <Suspense fallback={<UsersQuotaSkeleton />}>
        <UsersQuotaContent />
      </Suspense>
    </div>
  );
}

async function UsersQuotaContent() {
  const [users, systemSettings] = await Promise.all([getUsersWithQuotas(), getSystemSettings()]);
  const t = await getTranslations("quota.users");

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("totalCount", { count: users.length })}</p>
      <UsersQuotaClient users={users} currencyCode={systemSettings.currencyDisplay} />
    </div>
  );
}
