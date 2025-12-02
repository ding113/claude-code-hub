"use client";

import { ChevronDown, ChevronRight, Settings, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { EditUserQuotaDialog } from "@/app/[locale]/dashboard/quotas/keys/_components/edit-user-quota-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/utils/currency";
import { getQuotaColorClass, getUsageRate } from "@/lib/utils/quota-helpers";
import { QuotaProgress } from "./quota-progress";

interface UserQuotaHeaderProps {
  userId: number;
  userName: string;
  userRole: string;
  keyCount: number;
  rpmCurrent: number;
  rpmLimit: number;
  dailyCostCurrent: number;
  dailyCostLimit: number;
  isOpen: boolean;
  onToggle: () => void;
  currencyCode?: CurrencyCode;
  className?: string;
}

export function UserQuotaHeader({
  userId,
  userName,
  userRole,
  keyCount,
  rpmCurrent,
  rpmLimit,
  dailyCostCurrent,
  dailyCostLimit,
  isOpen,
  onToggle,
  currencyCode = "USD",
  className,
}: UserQuotaHeaderProps) {
  const t = useTranslations("quota");
  // 计算使用率
  const rpmRate = getUsageRate(rpmCurrent, rpmLimit);
  const dailyRate = getUsageRate(dailyCostCurrent, dailyCostLimit);
  const maxRate = Math.max(rpmRate, dailyRate);

  // 获取状态
  const colorClass = getQuotaColorClass(maxRate);

  // 背景颜色
  const bgColorClass = cn({
    "bg-card": colorClass === "normal",
    "bg-yellow-50 dark:bg-yellow-950/20": colorClass === "warning",
    "bg-orange-50 dark:bg-orange-950/20": colorClass === "danger",
    "bg-red-50 dark:bg-red-950/20": colorClass === "exceeded",
  });

  // 边框颜色
  const borderColorClass = cn({
    "border-border": colorClass === "normal",
    "border-yellow-500": colorClass === "warning",
    "border-orange-500": colorClass === "danger",
    "border-red-500 border-2": colorClass === "exceeded",
  });

  return (
    <Card
      className={cn(
        "cursor-pointer hover:shadow-md transition-all",
        bgColorClass,
        borderColorClass,
        className
      )}
    >
      <CardHeader className="p-4" onClick={onToggle}>
        <div className="flex items-start justify-between gap-4">
          {/* 左侧：用户信息 */}
          <div className="flex items-center gap-3 min-w-0">
            {isOpen ? (
              <ChevronDown className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            )}
            <User className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            <h3 className="font-semibold text-lg truncate">{userName}</h3>
            <Badge
              variant={userRole === "admin" ? "default" : "secondary"}
              className="flex-shrink-0"
            >
              {userRole === "admin" ? t("header.role.admin") : t("header.role.user")}
            </Badge>
            <Badge variant="outline" className="flex-shrink-0">
              {keyCount} {t("header.keysCountSuffix")}
            </Badge>
          </div>

          {/* 右侧：限额使用情况和编辑按钮 */}
          <div className="flex items-center gap-4">
            <div className="flex flex-col gap-2 min-w-[300px] max-w-[400px]">
              {/* RPM 进度条 */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground w-20 text-right flex-shrink-0">
                  {t("header.rpm")}:
                </span>
                <QuotaProgress current={rpmCurrent} limit={rpmLimit} className="flex-1" />
                <span className="text-sm font-mono w-24 text-right flex-shrink-0">
                  {rpmCurrent}/{rpmLimit}
                </span>
                <span className="text-xs text-muted-foreground w-12 text-right flex-shrink-0">
                  {rpmRate.toFixed(1)}%
                </span>
              </div>

              {/* 今日消费进度条 */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground w-20 text-right flex-shrink-0">
                  {t("header.todayCost")}:
                </span>
                <QuotaProgress
                  current={dailyCostCurrent}
                  limit={dailyCostLimit}
                  className="flex-1"
                />
                <span className="text-sm font-mono w-24 text-right flex-shrink-0">
                  ${dailyCostCurrent.toFixed(2)}/${dailyCostLimit}
                </span>
                <span className="text-xs text-muted-foreground w-12 text-right flex-shrink-0">
                  {dailyRate.toFixed(1)}%
                </span>
              </div>
            </div>

            {/* 编辑按钮 */}
            <div onClick={(e) => e.stopPropagation()}>
              <EditUserQuotaDialog
                userId={userId}
                userName={userName}
                currentQuota={{
                  rpm: { current: rpmCurrent, limit: rpmLimit, window: "per_minute" },
                  dailyCost: {
                    current: dailyCostCurrent,
                    limit: dailyCostLimit,
                    resetAt: new Date(),
                  },
                }}
                currencyCode={currencyCode}
                trigger={
                  <Button variant="outline" size="sm">
                    <Settings className="h-4 w-4" />
                  </Button>
                }
              />
            </div>
          </div>
        </div>

        {/* 超限提示 */}
        {colorClass === "exceeded" && (
          <div className="mt-2 text-sm text-red-600 dark:text-red-400 font-medium">
            ⚠️ {t("header.exceededNotice")}
          </div>
        )}
      </CardHeader>
    </Card>
  );
}
