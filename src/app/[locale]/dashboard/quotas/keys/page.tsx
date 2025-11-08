import { getUsers, getUserLimitUsage } from "@/actions/users";
import { getKeyLimitUsage } from "@/actions/keys";
import { KeysQuotaManager } from "./_components/keys-quota-manager";
import { getSystemSettings } from "@/repository/system-config";
import { getTranslations } from "next-intl/server";

async function getUsersWithKeysQuotas() {
  const users = await getUsers();

  const usersWithKeysQuotas = await Promise.all(
    users.map(async (user) => {
      // 获取密钥限额数据
      const keysWithQuotas = await Promise.all(
        user.keys.map(async (key) => {
          const result = await getKeyLimitUsage(key.id);
          return {
            id: key.id,
            name: key.name,
            isEnabled: key.status === "enabled", // 转换 status 为 isEnabled
            expiresAt: key.expiresAt,
            quota: result.ok ? result.data : null,
          };
        })
      );

      // 获取用户限额数据
      const userQuotaResult = await getUserLimitUsage(user.id);
      const userQuota = userQuotaResult.ok ? userQuotaResult.data : null;

      return {
        id: user.id,
        name: user.name,
        role: user.role,
        userQuota, // 新增：用户限额数据
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
  const t = await getTranslations("quota.keys");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">{t("title")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("totalCount", { users: users.length, keys: totalKeys })}
          </p>
        </div>
      </div>

      <KeysQuotaManager users={users} currencyCode={systemSettings.currencyDisplay} />
    </div>
  );
}
