import { getUsers } from "@/actions/users";
import { getUserLimitUsage } from "@/actions/users";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";

async function getUsersWithQuotas() {
  const users = await getUsers();

  const usersWithQuotas = await Promise.all(
    users.map(async (user) => {
      const result = await getUserLimitUsage(user.id);
      return {
        ...user,
        quota: result.ok ? result.data : null,
      };
    })
  );

  return usersWithQuotas;
}

export default async function UsersQuotaPage() {
  const users = await getUsersWithQuotas();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">用户限额统计</h3>
          <p className="text-sm text-muted-foreground">共 {users.length} 个用户</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {users.map((user) => (
          <Card key={user.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{user.name}</CardTitle>
                <Badge variant={user.role === "admin" ? "default" : "secondary"}>{user.role}</Badge>
              </div>
              <CardDescription>{user.note || "无备注"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {user.quota ? (
                <>
                  {/* RPM 限额 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">RPM 限额</span>
                      <span className="font-medium">
                        {user.quota.rpm.current} / {user.quota.rpm.limit}
                      </span>
                    </div>
                    <Progress
                      value={
                        user.quota.rpm.limit > 0
                          ? (user.quota.rpm.current / user.quota.rpm.limit) * 100
                          : 0
                      }
                      className="h-2"
                    />
                    <p className="text-xs text-muted-foreground">每分钟请求数</p>
                  </div>

                  {/* 每日消费限额 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">每日消费</span>
                      <span className="font-medium">
                        {formatCurrency(user.quota.dailyCost.current)} /{" "}
                        {formatCurrency(user.quota.dailyCost.limit)}
                      </span>
                    </div>
                    <Progress
                      value={
                        user.quota.dailyCost.limit > 0
                          ? (user.quota.dailyCost.current / user.quota.dailyCost.limit) * 100
                          : 0
                      }
                      className="h-2"
                    />
                    <p className="text-xs text-muted-foreground">
                      重置于{" "}
                      {formatDistanceToNow(new Date(user.quota.dailyCost.resetAt), {
                        addSuffix: true,
                        locale: zhCN,
                      })}
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">无法获取限额信息</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {users.length === 0 && (
        <Card>
          <CardContent className="flex items-center justify-center py-10">
            <p className="text-muted-foreground">暂无用户数据</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
