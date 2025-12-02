import { Info } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getUserLimitUsage, getUsers } from "@/actions/users";
import { QuotaToolbar } from "@/components/quota/quota-toolbar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Link } from "@/i18n/routing";
import { getSystemSettings } from "@/repository/system-config";
import { UsersQuotaClient } from "./_components/users-quota-client";

// 强制动态渲染 (此页面需要实时数据和认证)
export const dynamic = "force-dynamic";

async function getUsersWithQuotas() {
  const users = await getUsers();

  const usersWithQuotas = await Promise.all(
    users.map(async (user) => {
      const result = await getUserLimitUsage(user.id);
      return {
        id: user.id,
        name: user.name,
        note: user.note,
        role: user.role,
        quota: result.ok ? result.data : null,
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
