"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { getResetInfo } from "@/lib/rate-limit/time-utils";
import { EditKeyQuotaDialog } from "./edit-key-quota-dialog";

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

// 判断密钥是否已设置限额
function hasQuotaSet(key: KeyWithQuota): boolean {
  if (!key.quota) return false;
  return !!(
    key.quota.cost5h.limit ||
    key.quota.costWeekly.limit ||
    key.quota.costMonthly.limit ||
    key.quota.concurrentSessions.limit > 0
  );
}

export function KeysQuotaClient({ users }: KeysQuotaClientProps) {
  // 默认展开所有用户组
  const [openUsers, setOpenUsers] = useState<Set<number>>(new Set(users.map((user) => user.id)));
  // 默认折叠未设置限额区域
  const [showUnsetQuota, setShowUnsetQuota] = useState(false);

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

  // 将用户的密钥分为已设置限额和未设置限额两类
  const { usersWithSetQuota, usersWithUnsetQuota } = useMemo(() => {
    const withSet: UserWithKeys[] = [];
    const withUnset: UserWithKeys[] = [];

    users.forEach((user) => {
      const keysWithQuota = user.keys.filter(hasQuotaSet);
      const keysWithoutQuota = user.keys.filter((key) => !hasQuotaSet(key));

      if (keysWithQuota.length > 0) {
        withSet.push({ ...user, keys: keysWithQuota });
      }
      if (keysWithoutQuota.length > 0) {
        withUnset.push({ ...user, keys: keysWithoutQuota });
      }
    });

    return { usersWithSetQuota: withSet, usersWithUnsetQuota: withUnset };
  }, [users]);

  const totalUnsetKeys = usersWithUnsetQuota.reduce((sum, user) => sum + user.keys.length, 0);

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
      {/* 已设置限额的密钥 */}
      {usersWithSetQuota.length > 0 && (
        <div className="space-y-4">
          {usersWithSetQuota.map((user) => (
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
                              {key.expiresAt ? `过期: ${key.expiresAt}` : "永久有效"}
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
                                        (key.quota.cost5h.current / (key.quota.cost5h.limit || 1)) *
                                        100
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

                                {/* 设置限额按钮 */}
                                <EditKeyQuotaDialog
                                  keyId={key.id}
                                  keyName={key.name}
                                  userName={user.name}
                                  currentQuota={key.quota}
                                />
                              </>
                            ) : (
                              <p className="text-sm text-muted-foreground">无法获取限额信息</p>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          ))}
        </div>
      )}

      {/* 未设置限额的密钥（折叠收纳到底部） */}
      {totalUnsetKeys > 0 && (
        <Card>
          <Collapsible open={showUnsetQuota} onOpenChange={setShowUnsetQuota}>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="flex flex-row items-center justify-between py-4">
                <div className="flex items-center gap-3">
                  {showUnsetQuota ? (
                    <ChevronDown className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  )}
                  <span className="font-semibold">未设置限额的密钥</span>
                </div>
                <div className="text-sm text-muted-foreground">{totalUnsetKeys} 个密钥</div>
              </CardHeader>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {usersWithUnsetQuota.map((user) =>
                    user.keys.map((key) => (
                      <div
                        key={key.id}
                        className="flex items-center justify-between border-b py-3 last:border-0"
                      >
                        <div className="flex items-center gap-4 flex-1">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">{key.name}</span>
                              <Badge
                                variant={key.status === "enabled" ? "default" : "secondary"}
                                className="shrink-0"
                              >
                                {key.status === "enabled" ? "启用" : "禁用"}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {user.name} · {key.expiresAt || "永久有效"}
                            </p>
                          </div>
                        </div>
                        <EditKeyQuotaDialog
                          keyId={key.id}
                          keyName={key.name}
                          userName={user.name}
                          currentQuota={key.quota}
                          trigger={
                            <Button variant="outline" size="sm">
                              设置限额
                            </Button>
                          }
                        />
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      )}

      {usersWithSetQuota.length === 0 && totalUnsetKeys === 0 && (
        <Card>
          <CardContent className="flex items-center justify-center py-10">
            <p className="text-muted-foreground">没有匹配的密钥</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
