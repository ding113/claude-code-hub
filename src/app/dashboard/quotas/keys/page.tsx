import { getUsers } from "@/actions/users";
import { getKeyLimitUsage } from "@/actions/keys";
import { KeysQuotaManager } from "./_components/keys-quota-manager";
import { getSystemSettings } from "@/repository/system-config";

async function getUsersWithKeysQuotas() {
  const users = await getUsers();

  const usersWithKeysQuotas = await Promise.all(
    users.map(async (user) => {
      const keysWithQuotas = await Promise.all(
        user.keys.map(async (key) => {
          const result = await getKeyLimitUsage(key.id);
          return {
            id: key.id,
            name: key.name,
            status: key.status,
            expiresAt: key.expiresAt,
            quota: result.ok ? result.data : null,
          };
        })
      );

      return {
        id: user.id,
        name: user.name,
        role: user.role,
        keys: keysWithQuotas,
      };
    })
  );

  return usersWithKeysQuotas;
}

export default async function KeysQuotaPage() {
  const [users, systemSettings] = await Promise.all([
    getUsersWithKeysQuotas(),
    getSystemSettings(),
  ]);
  const totalKeys = users.reduce((sum, user) => sum + user.keys.length, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">密钥限额统计</h3>
          <p className="text-sm text-muted-foreground">
            共 {users.length} 个用户，{totalKeys} 个密钥
          </p>
        </div>
      </div>

      <KeysQuotaManager users={users} currencyCode={systemSettings.currencyDisplay} />
    </div>
  );
}
