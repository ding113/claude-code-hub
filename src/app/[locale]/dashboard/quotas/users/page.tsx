import { Info } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getUserLimitUsage, getUsers } from "@/actions/users";
import { QuotaToolbar } from "@/components/quota/quota-toolbar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Link } from "@/i18n/routing";
import { sumKeyTotalCostById, sumUserTotalCost } from "@/repository/statistics";
import { getSystemSettings } from "@/repository/system-config";
import type { UserKeyWithUsage, UserQuotaWithUsage } from "./_components/types";
import { UsersQuotaClient } from "./_components/users-quota-client";

// Force dynamic rendering (this page needs real-time data and auth)
export const dynamic = "force-dynamic";

// Max age for "all time" total usage query (100 years in days)
const ALL_TIME_MAX_AGE_DAYS = 36500;

async function getUsersWithQuotas(): Promise<UserQuotaWithUsage[]> {
  const users = await getUsers();

  const usersWithQuotas = await Promise.all(
    users.map(async (user) => {
      // Fetch quota usage and total cost in parallel
      const [quotaResult, totalUsage] = await Promise.all([
        getUserLimitUsage(user.id),
        sumUserTotalCost(user.id, ALL_TIME_MAX_AGE_DAYS),
      ]);

      // Map keys with their total usage
      const keysWithUsage: UserKeyWithUsage[] = await Promise.all(
        user.keys.map(async (key) => {
          const keyTotalUsage = await sumKeyTotalCostById(key.id, ALL_TIME_MAX_AGE_DAYS);
          return {
            id: key.id,
            name: key.name,
            status: key.status,
            todayUsage: key.todayUsage,
            totalUsage: keyTotalUsage,
            limit5hUsd: key.limit5hUsd,
            limitDailyUsd: key.limitDailyUsd,
            limitWeeklyUsd: key.limitWeeklyUsd,
            limitMonthlyUsd: key.limitMonthlyUsd,
            limitTotalUsd: key.limitTotalUsd ?? null,
            limitConcurrentSessions: key.limitConcurrentSessions,
            dailyResetMode: key.dailyResetMode,
            dailyResetTime: key.dailyResetTime,
          };
        })
      );

      return {
        id: user.id,
        name: user.name,
        note: user.note,
        role: user.role,
        providerGroup: user.providerGroup,
        tags: user.tags,
        quota: quotaResult.ok ? quotaResult.data : null,
        limit5hUsd: user.limit5hUsd ?? null,
        limitWeeklyUsd: user.limitWeeklyUsd ?? null,
        limitMonthlyUsd: user.limitMonthlyUsd ?? null,
        limitTotalUsd: user.limitTotalUsd ?? null,
        limitConcurrentSessions: user.limitConcurrentSessions ?? null,
        totalUsage,
        keys: keysWithUsage,
      };
    })
  );

  return usersWithQuotas;
}

export default async function UsersQuotaPage() {
  const [users, systemSettings] = await Promise.all([getUsersWithQuotas(), getSystemSettings()]);
  const t = await getTranslations("quota.users");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">{t("title")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("totalCount", { count: users.length })}
          </p>
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

      <UsersQuotaClient users={users} currencyCode={systemSettings.currencyDisplay} />
    </div>
  );
}
