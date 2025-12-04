"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { MyUsageQuota } from "@/actions/my-usage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { CurrencyCode } from "@/lib/utils";

interface QuotaCardsProps {
  quota: MyUsageQuota | null;
  loading?: boolean;
  currencyCode?: CurrencyCode;
}

export function QuotaCards({ quota, loading = false, currencyCode = "USD" }: QuotaCardsProps) {
  const t = useTranslations("myUsage.quota");

  const items = useMemo(() => {
    if (!quota) return [];
    return [
      {
        key: "5h",
        title: t("5h"),
        keyCurrent: quota.keyCurrent5hUsd,
        keyLimit: quota.keyLimit5hUsd,
        userCurrent: quota.userCurrent5hUsd,
        userLimit: quota.userLimit5hUsd,
      },
      {
        key: "daily",
        title: t("daily"),
        keyCurrent: quota.keyCurrentDailyUsd,
        keyLimit: quota.keyLimitDailyUsd,
        userCurrent: null,
        userLimit: null,
      },
      {
        key: "weekly",
        title: t("weekly"),
        keyCurrent: quota.keyCurrentWeeklyUsd,
        keyLimit: quota.keyLimitWeeklyUsd,
        userCurrent: quota.userCurrentWeeklyUsd,
        userLimit: quota.userLimitWeeklyUsd,
      },
      {
        key: "monthly",
        title: t("monthly"),
        keyCurrent: quota.keyCurrentMonthlyUsd,
        keyLimit: quota.keyLimitMonthlyUsd,
        userCurrent: quota.userCurrentMonthlyUsd,
        userLimit: quota.userLimitMonthlyUsd,
      },
      {
        key: "total",
        title: t("total"),
        keyCurrent: quota.keyCurrentTotalUsd,
        keyLimit: quota.keyLimitTotalUsd,
        userCurrent: quota.userCurrentTotalUsd,
        userLimit: quota.userLimitTotalUsd,
      },
      {
        key: "concurrent",
        title: t("concurrent"),
        keyCurrent: quota.keyCurrentConcurrentSessions,
        keyLimit: quota.keyLimitConcurrentSessions,
        userCurrent: quota.userCurrentConcurrentSessions,
        userLimit: quota.userLimitConcurrentSessions ?? null,
      },
    ];
  }, [quota, t]);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const keyPct = item.keyLimit
          ? Math.min((item.keyCurrent / item.keyLimit) * 100, 999)
          : null;
        const userPct = item.userLimit
          ? Math.min(((item.userCurrent ?? 0) / item.userLimit) * 100, 999)
          : null;

        const keyTone = getTone(keyPct);
        const userTone = getTone(userPct);

        return (
          <Card key={item.key} className="border-border/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground">
                {item.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <QuotaRow
                label={t("keyLevel")}
                current={item.keyCurrent}
                limit={item.keyLimit}
                percent={keyPct}
                tone={keyTone}
                currency={item.key === "concurrent" ? undefined : currencyCode}
              />
              {item.userLimit !== null || item.userCurrent !== null ? (
                <QuotaRow
                  label={t("userLevel")}
                  current={item.userCurrent ?? 0}
                  limit={item.userLimit}
                  percent={userPct}
                  tone={userTone}
                  currency={item.key === "concurrent" ? undefined : currencyCode}
                />
              ) : null}
            </CardContent>
          </Card>
        );
      })}
      {items.length === 0 && !loading ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            {t("empty")}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function QuotaRow({
  label,
  current,
  limit,
  percent,
  tone,
  currency,
}: {
  label: string;
  current: number;
  limit: number | null;
  percent: number | null;
  tone: "default" | "warn" | "danger";
  currency?: string;
}) {
  const t = useTranslations("myUsage.quota");
  const formatValue = (value: number) =>
    currency ? `${currency} ${value.toFixed(2)}` : value.toString();

  const progressClass = `h-2 ${
    tone === "danger"
      ? "bg-destructive/10 [&>div]:bg-destructive"
      : tone === "warn"
        ? "bg-amber-500/10 [&>div]:bg-amber-500"
        : ""
  }`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono text-foreground">
          {formatValue(current)}
          {limit !== null ? ` / ${formatValue(limit)}` : ` / ${t("unlimited")}`}
        </span>
      </div>
      <Progress value={percent ?? 0} className={progressClass.trim()} />
    </div>
  );
}

function getTone(percent: number | null): "default" | "warn" | "danger" {
  if (percent === null) return "default";
  if (percent >= 95) return "danger";
  if (percent >= 80) return "warn";
  return "default";
}
