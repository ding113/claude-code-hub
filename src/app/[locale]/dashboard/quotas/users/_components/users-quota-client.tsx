"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { QuotaProgress } from "@/components/quota/quota-progress";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { type CurrencyCode, formatCurrency } from "@/lib/utils/currency";
import { formatDateDistance } from "@/lib/utils/date-format";

interface UserQuota {
  rpm: { current: number; limit: number; window: "per_minute" };
  dailyCost: { current: number; limit: number; resetAt: Date };
}

interface UserWithQuota {
  id: number;
  name: string;
  note?: string;
  role: string;
  quota: UserQuota | null;
}

interface UsersQuotaClientProps {
  users: UserWithQuota[];
  currencyCode?: CurrencyCode;
  searchQuery?: string;
  sortBy?: "name" | "usage";
  filter?: "all" | "warning" | "exceeded";
}

export function UsersQuotaClient({
  users,
  currencyCode = "USD",
  searchQuery = "",
  sortBy = "name",
  filter = "all",
}: UsersQuotaClientProps) {
  const locale = useLocale();
  const t = useTranslations("quota.users");

  // 计算使用率（用于排序和筛选）
  const usersWithUsage = useMemo(() => {
    return users.map((user) => {
      const dailyUsage = user.quota?.dailyCost.limit
        ? (user.quota.dailyCost.current / user.quota.dailyCost.limit) * 100
        : 0;
      return { ...user, usagePercentage: dailyUsage };
    });
  }, [users]);

  // 筛选
  const filteredUsers = useMemo(() => {
    let result = usersWithUsage;

    // 搜索
    if (searchQuery) {
      result = result.filter((user) => user.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }

    // 状态筛选
    if (filter === "warning") {
      result = result.filter((user) => user.usagePercentage >= 60 && user.usagePercentage < 100);
    } else if (filter === "exceeded") {
      result = result.filter((user) => user.usagePercentage >= 100);
    }

    return result;
  }, [usersWithUsage, searchQuery, filter]);

  // 排序
  const sortedUsers = useMemo(() => {
    const sorted = [...filteredUsers];
    if (sortBy === "name") {
      sorted.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    } else if (sortBy === "usage") {
      sorted.sort((a, b) => b.usagePercentage - a.usagePercentage);
    }
    return sorted;
  }, [filteredUsers, sortBy]);

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sortedUsers.map((user) => (
          <Card key={user.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{user.name}</CardTitle>
                <Badge variant={user.role === "admin" ? "default" : "secondary"}>{user.role}</Badge>
              </div>
              <CardDescription>{user.note || t("noNote")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {user.quota ? (
                <>
                  {/* RPM 限额 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{t("rpm.label")}</span>
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
                    <p className="text-xs text-muted-foreground">{t("rpm.description")}</p>
                  </div>

                  {/* 每日消费限额 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{t("dailyCost.label")}</span>
                      <span className="font-medium">
                        {formatCurrency(user.quota.dailyCost.current, currencyCode)} /{" "}
                        {formatCurrency(user.quota.dailyCost.limit, currencyCode)}
                      </span>
                    </div>
                    <QuotaProgress
                      current={user.quota.dailyCost.current}
                      limit={user.quota.dailyCost.limit}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("dailyCost.resetAt")}{" "}
                      {formatDateDistance(
                        new Date(user.quota.dailyCost.resetAt),
                        new Date(),
                        locale
                      )}
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t("noQuotaData")}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {sortedUsers.length === 0 && (
        <Card>
          <CardContent className="flex items-center justify-center py-10">
            <p className="text-muted-foreground">{searchQuery ? t("noMatches") : t("noData")}</p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
