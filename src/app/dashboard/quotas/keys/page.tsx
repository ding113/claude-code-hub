import { getUsers } from "@/actions/users";
import { getKeyLimitUsage } from "@/actions/keys";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { getResetInfo } from "@/lib/rate-limit/time-utils";

async function getKeysWithQuotas() {
  const users = await getUsers();
  const allKeys = users.flatMap((user) =>
    user.keys.map((key) => ({ ...key, userName: user.name }))
  );

  const keysWithQuotas = await Promise.all(
    allKeys.map(async (key) => {
      const result = await getKeyLimitUsage(key.id);
      return {
        ...key,
        quota: result.ok ? result.data : null,
      };
    })
  );

  return keysWithQuotas;
}

export default async function KeysQuotaPage() {
  const keys = await getKeysWithQuotas();
  const weeklyReset = getResetInfo("weekly");
  const monthlyReset = getResetInfo("monthly");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">密钥限额统计</h3>
          <p className="text-sm text-muted-foreground">共 {keys.length} 个密钥</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {keys.map((key) => (
          <Card key={key.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{key.name}</CardTitle>
                <Badge variant={key.status === "enabled" ? "default" : "secondary"}>
                  {key.status === "enabled" ? "启用" : "禁用"}
                </Badge>
              </div>
              <CardDescription>
                {key.userName} · {key.expiresAt}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {key.quota ? (
                <>
                  {/* 5小时消费 */}
                  {key.quota.cost5h.limit && key.quota.cost5h.limit > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">5小时消费</span>
                        <span className="font-medium">
                          {formatCurrency(key.quota.cost5h.current)} /{" "}
                          {formatCurrency(key.quota.cost5h.limit)}
                        </span>
                      </div>
                      <Progress
                        value={(key.quota.cost5h.current / (key.quota.cost5h.limit || 1)) * 100}
                        className="h-2"
                      />
                      <p className="text-xs text-muted-foreground">滚动窗口（过去5小时）</p>
                    </div>
                  )}

                  {/* 周消费 */}
                  {key.quota.costWeekly.limit && key.quota.costWeekly.limit > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">周消费</span>
                        <span className="font-medium">
                          {formatCurrency(key.quota.costWeekly.current)} /{" "}
                          {formatCurrency(key.quota.costWeekly.limit)}
                        </span>
                      </div>
                      <Progress
                        value={
                          (key.quota.costWeekly.current / (key.quota.costWeekly.limit || 1)) * 100
                        }
                        className="h-2"
                      />
                      <p className="text-xs text-muted-foreground">
                        重置于{" "}
                        {formatDistanceToNow(weeklyReset.resetAt!, {
                          addSuffix: true,
                          locale: zhCN,
                        })}
                      </p>
                    </div>
                  )}

                  {/* 月消费 */}
                  {key.quota.costMonthly.limit && key.quota.costMonthly.limit > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">月消费</span>
                        <span className="font-medium">
                          {formatCurrency(key.quota.costMonthly.current)} /{" "}
                          {formatCurrency(key.quota.costMonthly.limit)}
                        </span>
                      </div>
                      <Progress
                        value={
                          (key.quota.costMonthly.current / (key.quota.costMonthly.limit || 1)) * 100
                        }
                        className="h-2"
                      />
                      <p className="text-xs text-muted-foreground">
                        重置于{" "}
                        {formatDistanceToNow(monthlyReset.resetAt!, {
                          addSuffix: true,
                          locale: zhCN,
                        })}
                      </p>
                    </div>
                  )}

                  {/* 并发 Session */}
                  {key.quota.concurrentSessions.limit > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">并发 Session</span>
                        <span className="font-medium">
                          {key.quota.concurrentSessions.current} /{" "}
                          {key.quota.concurrentSessions.limit}
                        </span>
                      </div>
                      <Progress
                        value={
                          (key.quota.concurrentSessions.current /
                            key.quota.concurrentSessions.limit) *
                          100
                        }
                        className="h-2"
                      />
                    </div>
                  )}

                  {!key.quota.cost5h.limit &&
                    !key.quota.costWeekly.limit &&
                    !key.quota.costMonthly.limit &&
                    key.quota.concurrentSessions.limit === 0 && (
                      <p className="text-sm text-muted-foreground">未设置限额</p>
                    )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">无法获取限额信息</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {keys.length === 0 && (
        <Card>
          <CardContent className="flex items-center justify-center py-10">
            <p className="text-muted-foreground">暂无密钥数据</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
