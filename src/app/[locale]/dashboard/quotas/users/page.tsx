import { getUsers } from "@/actions/users";
import { getUserLimitUsage } from "@/actions/users";
import { QuotaToolbar } from "@/components/quota/quota-toolbar";
import { UsersQuotaClient } from "./_components/users-quota-client";
import { getSystemSettings } from "@/repository/system-config";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

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
