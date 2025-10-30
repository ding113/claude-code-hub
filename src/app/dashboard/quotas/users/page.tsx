import { getUsers } from "@/actions/users";
import { getUserLimitUsage } from "@/actions/users";
import { QuotaToolbar } from "@/components/quota/quota-toolbar";
import { UsersQuotaClient } from "./_components/users-quota-client";
import { getSystemSettings } from "@/repository/system-config";

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
  const [users, systemSettings] = await Promise.all([
    getUsersWithQuotas(),
    getSystemSettings(),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">用户限额统计</h3>
          <p className="text-sm text-muted-foreground">共 {users.length} 个用户</p>
        </div>
      </div>

      <QuotaToolbar
        sortOptions={[
          { value: "name", label: "按名称" },
          { value: "usage", label: "按使用率" },
        ]}
        filterOptions={[
          { value: "all", label: "全部" },
          { value: "warning", label: "接近限额 (>60%)" },
          { value: "exceeded", label: "已超限 (≥100%)" },
        ]}
      />

      <UsersQuotaClient users={users} currencyCode={systemSettings.currencyDisplay} />
    </div>
  );
}
