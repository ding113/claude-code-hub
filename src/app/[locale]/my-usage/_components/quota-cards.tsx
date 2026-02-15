"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { MyUsageQuota } from "@/actions/my-usage";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import type { CurrencyCode } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/currency";
import { calculateUsagePercent, isUnlimited } from "@/lib/utils/limit-helpers";

interface QuotaCardsProps {
  quota: MyUsageQuota | null;
  loading?: boolean;
  currencyCode?: CurrencyCode;
}

export function QuotaCards({ quota, loading = false, currencyCode = "USD" }: QuotaCardsProps) {
  const t = useTranslations("myUsage.quota");
  const tCommon = useTranslations("common");

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
        userCurrent: quota.userCurrentDailyUsd,
        userLimit: quota.userLimitDailyUsd,
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
        userLimit: quota.userLimitConcurrentSessions,
      },
    ];
  }, [quota, t]);

  if (loading && !quota) {
    return <QuotaCardsSkeleton label={tCommon("loading")} />;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {items.map((item) => {
        const isCurrency = item.key !== "concurrent";
        const currency = isCurrency ? currencyCode : undefined;

        return (
          <QuotaBlock
            key={item.key}
            title={item.title}
            keyCurrent={item.keyCurrent}
            keyLimit={item.keyLimit}
            userCurrent={item.userCurrent ?? 0}
            userLimit={item.userLimit}
            currency={currency}
          />
        );
      })}
      {items.length === 0 && !loading ? (
        <div className="col-span-full py-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </div>
      ) : null}
    </div>
  );
}

function QuotaBlock({
  title,
  keyCurrent,
  keyLimit,
  userCurrent,
  userLimit,
  currency,
}: {
  title: string;
  keyCurrent: number;
  keyLimit: number | null;
  userCurrent: number;
  userLimit: number | null;
  currency?: CurrencyCode;
}) {
  const t = useTranslations("myUsage.quota");

  const keyPct = calculateUsagePercent(keyCurrent, keyLimit);
  const userPct = calculateUsagePercent(userCurrent, userLimit);

  return (
    <div className="space-y-2 rounded-md border bg-card/50 p-3">
      <div className="text-xs font-semibold text-muted-foreground">{title}</div>
      <QuotaRow
        label={t("keyLevel")}
        current={keyCurrent}
        limit={keyLimit}
        percent={keyPct}
        currency={currency}
      />
      <QuotaRow
        label={t("userLevel")}
        current={userCurrent}
        limit={userLimit}
        percent={userPct}
        currency={currency}
      />
    </div>
  );
}

function QuotaRow({
  label,
  current,
  limit,
  percent,
  currency,
}: {
  label: string;
  current: number;
  limit: number | null;
  percent: number | null;
  currency?: CurrencyCode;
}) {
  const t = useTranslations("myUsage.quota");
  const unlimited = isUnlimited(limit);
  const tone = getTone(percent);

  const formatValue = (value: number) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return currency ? formatCurrency(0, currency) : "0";
    return currency ? formatCurrency(num, currency) : String(num);
  };

  const limitDisplay = unlimited ? t("unlimited") : formatValue(limit as number);
  const ariaLabel = `${label}: ${formatValue(current)}${!unlimited ? ` / ${limitDisplay}` : ""}`;

  const progressClass = cn("h-1.5 flex-1", {
    "bg-destructive/10 [&>div]:bg-destructive": tone === "danger",
    "bg-amber-500/10 [&>div]:bg-amber-500": tone === "warn",
  });

  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      {!unlimited ? (
        <Progress value={percent ?? 0} className={progressClass} aria-label={ariaLabel} />
      ) : (
        <div
          className="h-1.5 flex-1 rounded-full bg-muted/50"
          role="progressbar"
          aria-label={`${label}: ${t("unlimited")}`}
          aria-valuetext={t("unlimited")}
        />
      )}
      <span className="shrink-0 text-right font-mono text-xs text-foreground">
        {formatValue(current)}
        <span className="text-muted-foreground"> / {limitDisplay}</span>
      </span>
    </div>
  );
}

function QuotaCardsSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="space-y-2 rounded-md border bg-card/50 p-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Skeleton className="h-3 w-3 rounded-full" />
        <span>{label}</span>
      </div>
    </div>
  );
}

function getTone(percent: number | null): "default" | "warn" | "danger" {
  if (percent === null) return "default";
  if (percent >= 95) return "danger";
  if (percent >= 80) return "warn";
  return "default";
}
