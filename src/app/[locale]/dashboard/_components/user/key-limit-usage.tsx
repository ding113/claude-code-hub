"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Progress } from "@/components/ui/progress";
import { useKeyLimitUsage } from "@/lib/api-client/v1/keys/hooks";
import { cn } from "@/lib/utils";
import { type CurrencyCode, formatCurrency } from "@/lib/utils/currency";

interface KeyLimitUsageProps {
  keyId: number;
  currencyCode?: CurrencyCode;
}

export function KeyLimitUsage({ keyId, currencyCode = "USD" }: KeyLimitUsageProps) {
  const t = useTranslations("dashboard.keyLimitUsage");
  const { data, isLoading, error } = useKeyLimitUsage(keyId);
  const loading = isLoading;
  const errorMessage = error ? (error.message ?? t("error")) : null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>{t("loading")}</span>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive">
        <AlertCircle className="h-3 w-3" />
        <span>{errorMessage}</span>
      </div>
    );
  }

  if (!data) return null;

  const items = [
    {
      label: t("cost5h"),
      current: data.cost5h.current,
      limit: data.cost5h.limit,
      isCost: true,
    },
    {
      label: t("costDaily"),
      current: data.costDaily.current,
      limit: data.costDaily.limit,
      isCost: true,
    },
    {
      label: t("costWeekly"),
      current: data.costWeekly.current,
      limit: data.costWeekly.limit,
      isCost: true,
    },
    {
      label: t("costMonthly"),
      current: data.costMonthly.current,
      limit: data.costMonthly.limit,
      isCost: true,
    },
    {
      label: t("costTotal"),
      current: data.costTotal.current,
      limit: data.costTotal.limit,
      isCost: true,
    },
    {
      label: t("concurrentSessions"),
      current: data.concurrentSessions.current,
      limit: data.concurrentSessions.limit || null,
      isCost: false,
    },
  ].filter((item) => item.limit !== null && item.limit > 0); // 只显示有限额的项目

  if (items.length === 0) {
    return <div className="text-xs text-muted-foreground">{t("noLimit")}</div>;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const percentage = item.limit ? Math.min((item.current / item.limit) * 100, 100) : 0;
        const isNearLimit = percentage >= 80;
        const isAtLimit = percentage >= 100;

        return (
          <div key={item.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{item.label}</span>
              <span
                className={cn(
                  "font-mono font-medium",
                  isAtLimit && "text-destructive",
                  isNearLimit && !isAtLimit && "text-orange-600"
                )}
              >
                {item.isCost ? (
                  <>
                    {formatCurrency(item.current, currencyCode)} /{" "}
                    {formatCurrency(item.limit!, currencyCode)}
                  </>
                ) : (
                  <>
                    {item.current} / {item.limit}
                  </>
                )}
              </span>
            </div>
            <Progress
              value={percentage}
              className={cn(
                "h-1.5",
                isAtLimit && "[&>div]:bg-destructive",
                isNearLimit && !isAtLimit && "[&>div]:bg-orange-500"
              )}
            />
          </div>
        );
      })}
    </div>
  );
}
