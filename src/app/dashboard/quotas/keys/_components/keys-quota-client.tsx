"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { getResetInfo } from "@/lib/rate-limit/time-utils";

interface KeyQuota {
  cost5h: { current: number; limit: number | null };
  costWeekly: { current: number; limit: number | null };
  costMonthly: { current: number; limit: number | null };
  concurrentSessions: { current: number; limit: number };
}

interface KeyWithQuota {
  id: number;
  name: string;
  status: string;
  expiresAt: string | null;
  quota: KeyQuota | null;
}

interface UserWithKeys {
  id: number;
  name: string;
  role: string;
  keys: KeyWithQuota[];
}

interface KeysQuotaClientProps {
  users: UserWithKeys[];
}

export function KeysQuotaClient({ users }: KeysQuotaClientProps) {
  // 默认展开所有用户组
  const [openUsers, setOpenUsers] = useState<Set<number>>(new Set(users.map((user) => user.id)));

  const weeklyReset = getResetInfo("weekly");
  const monthlyReset = getResetInfo("monthly");

  const toggleUser = (userId: number) => {
    setOpenUsers((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        newSet.add(userId);
      }
      return newSet;
    });
  };

  if (users.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <p className="text-muted-foreground">没有匹配的用户或密钥</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {users.map((user) => (
        <Card key={user.id}>
          <Collapsible open={openUsers.has(user.id)} onOpenChange={() => toggleUser(user.id)}>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="flex flex-row items-center justify-between py-4">
                <div className="flex items-center gap-3">
                  {openUsers.has(user.id) ? (
                    <ChevronDown className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  )}
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{user.name}</span>
                    <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                      {user.role}
                    </Badge>
                  </div>
                </div>
                <div className="text-sm text-muted-foreground">{user.keys.length} 个密钥</div>
              </CardHeader>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <CardContent className="pt-0">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {user.keys.map((key) => (
                    <Card key={key.id}>
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base">{key.name}</CardTitle>
                          <Badge variant={key.status === "enabled" ? "default" : "secondary"}>
                            {key.status === "enabled" ? "启用" : "禁用"}
                          </Badge>
                        </div>
                        <CardDescription>
                          {key.expiresAt ? `过期时间: ${key.expiresAt}` : "永久有效"}
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
                                  value={
                                    (key.quota.cost5h.current / (key.quota.cost5h.limit || 1)) * 100
                                  }
                                  className="h-2"
                                />
                                <p className="text-xs text-muted-foreground">
                                  滚动窗口（过去5小时）
                                </p>
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
                                    (key.quota.costWeekly.current /
                                      (key.quota.costWeekly.limit || 1)) *
                                    100
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
                                    (key.quota.costMonthly.current /
                                      (key.quota.costMonthly.limit || 1)) *
                                    100
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

                {user.keys.length === 0 && (
                  <p className="py-4 text-center text-sm text-muted-foreground">该用户没有密钥</p>
                )}
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      ))}
    </div>
  );
}
