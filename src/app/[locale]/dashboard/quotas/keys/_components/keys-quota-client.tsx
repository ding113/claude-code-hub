"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import type { CurrencyCode } from "@/lib/utils/currency";
import { formatCurrency } from "@/lib/utils/currency";
import { UserQuotaHeader } from "@/components/quota/user-quota-header";
import { QuotaProgress } from "@/components/quota/quota-progress";
import { QuotaWindowType } from "@/components/quota/quota-window-type";
import { QuotaCountdownCompact } from "@/components/quota/quota-countdown";
import { hasKeyQuotaSet, isUserExceeded, getUsageRate } from "@/lib/utils/quota-helpers";
import { EditKeyQuotaDialog } from "./edit-key-quota-dialog";
import { useTranslations } from "next-intl";

interface KeyQuota {
  cost5h: { current: number; limit: number | null; resetAt?: Date };
  costDaily: { current: number; limit: number | null; resetAt?: Date };
  costWeekly: { current: number; limit: number | null; resetAt?: Date };
  costMonthly: { current: number; limit: number | null; resetAt?: Date };
  concurrentSessions: { current: number; limit: number };
}

interface UserQuota {
  rpm: { current: number; limit: number; window: "per_minute" };
  dailyCost: { current: number; limit: number; resetAt: Date };
}

interface KeyWithQuota {
  id: number;
  name: string;
  isEnabled: boolean;
  expiresAt: string | null;
  quota: KeyQuota | null;
  limitDailyUsd: number | null;
  dailyResetTime: string;
  dailyResetMode: "fixed" | "rolling";
}

interface UserWithKeys {
  id: number;
  name: string;
  role: string;
  userQuota: UserQuota | null;
  keys: KeyWithQuota[];
}

interface KeysQuotaClientProps {
  users: UserWithKeys[];
  currencyCode?: CurrencyCode;
}

export function KeysQuotaClient({ users, currencyCode = "USD" }: KeysQuotaClientProps) {
  const t = useTranslations("quota.keys");
  // 默认展开所有用户组
  const [openUsers, setOpenUsers] = useState<Set<number>>(new Set(users.map((user) => user.id)));

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
          <p className="text-muted-foreground">{t("noMatches")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {users.map((user) => {
        // 判断用户是否超限
        const userExceeded = isUserExceeded(user.userQuota);

        return (
          <Collapsible
            key={user.id}
            open={openUsers.has(user.id)}
            onOpenChange={() => toggleUser(user.id)}
          >
            {/* 用户头部 */}
            <UserQuotaHeader
              userId={user.id}
              userName={user.name}
              userRole={user.role}
              keyCount={user.keys.length}
              rpmCurrent={user.userQuota?.rpm.current || 0}
              rpmLimit={user.userQuota?.rpm.limit || 60}
              dailyCostCurrent={user.userQuota?.dailyCost.current || 0}
              dailyCostLimit={user.userQuota?.dailyCost.limit || 100}
              isOpen={openUsers.has(user.id)}
              onToggle={() => toggleUser(user.id)}
              currencyCode={currencyCode}
            />

            {/* 密钥表格 */}
            <CollapsibleContent>
              <Card className="mt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[200px]">{t("table.keyName")}</TableHead>
                      <TableHead className="w-[120px]">{t("table.quotaType")}</TableHead>
                      <TableHead className="w-[150px]">{t("table.cost5h")}</TableHead>
                      <TableHead className="w-[150px]">{t("table.costDaily")}</TableHead>
                      <TableHead className="w-[150px]">{t("table.costWeekly")}</TableHead>
                      <TableHead className="w-[150px]">{t("table.costMonthly")}</TableHead>
                      <TableHead className="w-[120px]">{t("table.concurrentSessions")}</TableHead>
                      <TableHead className="w-[100px]">{t("table.status")}</TableHead>
                      <TableHead className="w-[100px] text-right">{t("table.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {user.keys.map((key) => {
                      // 判断密钥是否设置了限额
                      const hasKeyQuota = hasKeyQuotaSet(key.quota);

                      return (
                        <TableRow key={key.id}>
                          {/* 密钥名称 */}
                          <TableCell className="font-medium">{key.name}</TableCell>

                          {/* 限额类型 */}
                          <TableCell>
                            {hasKeyQuota ? (
                              <Badge variant="default">{t("quotaType.independent")}</Badge>
                            ) : (
                              <Badge variant="outline">{t("quotaType.inherited")}</Badge>
                            )}
                          </TableCell>

                          {/* 5小时限额 */}
                          <TableCell>
                            {hasKeyQuota && key.quota && key.quota.cost5h.limit !== null ? (
                              <div className="space-y-1">
                                {/* 窗口类型标签 */}
                                <div className="flex items-center justify-between mb-1">
                                  <QuotaWindowType type="5h" size="sm" />
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-mono">
                                    {formatCurrency(key.quota.cost5h.current, currencyCode)}/
                                    {formatCurrency(key.quota.cost5h.limit, currencyCode)}
                                  </span>
                                </div>
                                <QuotaProgress
                                  current={key.quota.cost5h.current}
                                  limit={key.quota.cost5h.limit}
                                  className="h-1"
                                />
                                <div className="text-xs text-muted-foreground text-right">
                                  {getUsageRate(
                                    key.quota.cost5h.current,
                                    key.quota.cost5h.limit
                                  ).toFixed(1)}
                                  %
                                </div>
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">-</span>
                            )}
                          </TableCell>

                          {/* 每日限额 */}
                          <TableCell>
                            {hasKeyQuota && key.quota && key.quota.costDaily.limit !== null ? (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between mb-1">
                                  <QuotaWindowType type="daily" size="sm" />
                                  {key.quota.costDaily.resetAt && (
                                    <QuotaCountdownCompact resetAt={key.quota.costDaily.resetAt} />
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-mono">
                                    {formatCurrency(key.quota.costDaily.current, currencyCode)}/
                                    {formatCurrency(key.quota.costDaily.limit, currencyCode)}
                                  </span>
                                </div>
                                <QuotaProgress
                                  current={key.quota.costDaily.current}
                                  limit={key.quota.costDaily.limit}
                                  className="h-1"
                                />
                                <div className="text-xs text-muted-foreground text-right">
                                  {getUsageRate(
                                    key.quota.costDaily.current,
                                    key.quota.costDaily.limit
                                  ).toFixed(1)}
                                  %
                                </div>
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">-</span>
                            )}
                          </TableCell>

                          {/* 周限额 */}
                          <TableCell>
                            {hasKeyQuota && key.quota && key.quota.costWeekly.limit !== null ? (
                              <div className="space-y-1">
                                {/* 窗口类型 + 倒计时 */}
                                <div className="flex items-center justify-between mb-1">
                                  <QuotaWindowType type="weekly" size="sm" />
                                  {key.quota.costWeekly.resetAt && (
                                    <QuotaCountdownCompact resetAt={key.quota.costWeekly.resetAt} />
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-mono">
                                    {formatCurrency(key.quota.costWeekly.current, currencyCode)}/
                                    {formatCurrency(key.quota.costWeekly.limit, currencyCode)}
                                  </span>
                                </div>
                                <QuotaProgress
                                  current={key.quota.costWeekly.current}
                                  limit={key.quota.costWeekly.limit}
                                  className="h-1"
                                />
                                <div className="text-xs text-muted-foreground text-right">
                                  {getUsageRate(
                                    key.quota.costWeekly.current,
                                    key.quota.costWeekly.limit
                                  ).toFixed(1)}
                                  %
                                </div>
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">-</span>
                            )}
                          </TableCell>

                          {/* 月限额 */}
                          <TableCell>
                            {hasKeyQuota && key.quota && key.quota.costMonthly.limit !== null ? (
                              <div className="space-y-1">
                                {/* 窗口类型 + 倒计时 */}
                                <div className="flex items-center justify-between mb-1">
                                  <QuotaWindowType type="monthly" size="sm" />
                                  {key.quota.costMonthly.resetAt && (
                                    <QuotaCountdownCompact
                                      resetAt={key.quota.costMonthly.resetAt}
                                    />
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-mono">
                                    {formatCurrency(key.quota.costMonthly.current, currencyCode)}/
                                    {formatCurrency(key.quota.costMonthly.limit, currencyCode)}
                                  </span>
                                </div>
                                <QuotaProgress
                                  current={key.quota.costMonthly.current}
                                  limit={key.quota.costMonthly.limit}
                                  className="h-1"
                                />
                                <div className="text-xs text-muted-foreground text-right">
                                  {getUsageRate(
                                    key.quota.costMonthly.current,
                                    key.quota.costMonthly.limit
                                  ).toFixed(1)}
                                  %
                                </div>
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">-</span>
                            )}
                          </TableCell>

                          {/* 并发限制 */}
                          <TableCell>
                            {hasKeyQuota && key.quota && key.quota.concurrentSessions.limit > 0 ? (
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-mono">
                                    {key.quota.concurrentSessions.current}/
                                    {key.quota.concurrentSessions.limit}
                                  </span>
                                </div>
                                <QuotaProgress
                                  current={key.quota.concurrentSessions.current}
                                  limit={key.quota.concurrentSessions.limit}
                                  className="h-1"
                                />
                                <div className="text-xs text-muted-foreground text-right">
                                  {getUsageRate(
                                    key.quota.concurrentSessions.current,
                                    key.quota.concurrentSessions.limit
                                  ).toFixed(1)}
                                  %
                                </div>
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">-</span>
                            )}
                          </TableCell>

                          {/* 状态 */}
                          <TableCell>
                            <Badge
                              variant={key.isEnabled && !userExceeded ? "default" : "secondary"}
                              className="text-xs"
                            >
                              {!key.isEnabled
                                ? t("status.disabled")
                                : userExceeded && !hasKeyQuota
                                  ? t("status.restricted")
                                  : t("status.normal")}
                            </Badge>
                          </TableCell>

                          {/* 操作 */}
                          <TableCell className="text-right">
                            <EditKeyQuotaDialog
                              keyId={key.id}
                              keyName={key.name}
                              userName={user.name}
                              currentQuota={key.quota}
                              currencyCode={currencyCode}
                              dailyResetTime={key.dailyResetTime}
                              dailyResetMode={key.dailyResetMode}
                              trigger={
                                <Button variant="ghost" size="sm">
                                  <Settings className="h-4 w-4" />
                                </Button>
                              }
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
