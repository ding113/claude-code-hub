"use client";

import { Infinity as InfinityIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import type { MyUsageQuota } from "@/lib/api-client/v1/actions/my-usage";
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
        keyModelGroupOnly: quota.keyCurrent5hModelGroupOnlyUsd,
        userCurrent: quota.userCurrent5hUsd,
        userLimit: quota.userLimit5hUsd,
        userModelGroupOnly: quota.userCurrent5hModelGroupOnlyUsd,
      },
      {
        key: "daily",
        title: t("daily"),
        keyCurrent: quota.keyCurrentDailyUsd,
        keyLimit: quota.keyLimitDailyUsd,
        keyModelGroupOnly: quota.keyCurrentDailyModelGroupOnlyUsd,
        userCurrent: quota.userCurrentDailyUsd,
        userLimit: quota.userLimitDailyUsd,
        userModelGroupOnly: quota.userCurrentDailyModelGroupOnlyUsd,
      },
      {
        key: "weekly",
        title: t("weekly"),
        keyCurrent: quota.keyCurrentWeeklyUsd,
        keyLimit: quota.keyLimitWeeklyUsd,
        keyModelGroupOnly: quota.keyCurrentWeeklyModelGroupOnlyUsd,
        userCurrent: quota.userCurrentWeeklyUsd,
        userLimit: quota.userLimitWeeklyUsd,
        userModelGroupOnly: quota.userCurrentWeeklyModelGroupOnlyUsd,
      },
      {
        key: "monthly",
        title: t("monthly"),
        keyCurrent: quota.keyCurrentMonthlyUsd,
        keyLimit: quota.keyLimitMonthlyUsd,
        keyModelGroupOnly: quota.keyCurrentMonthlyModelGroupOnlyUsd,
        userCurrent: quota.userCurrentMonthlyUsd,
        userLimit: quota.userLimitMonthlyUsd,
        userModelGroupOnly: quota.userCurrentMonthlyModelGroupOnlyUsd,
      },
      {
        key: "total",
        title: t("total"),
        keyCurrent: quota.keyCurrentTotalUsd,
        keyLimit: quota.keyLimitTotalUsd,
        keyModelGroupOnly: quota.keyCurrentTotalModelGroupOnlyUsd,
        userCurrent: quota.userCurrentTotalUsd,
        userLimit: quota.userLimitTotalUsd,
        userModelGroupOnly: quota.userCurrentTotalModelGroupOnlyUsd,
      },
      {
        key: "concurrent",
        title: t("concurrent"),
        keyCurrent: quota.keyCurrentConcurrentSessions,
        keyLimit: quota.keyLimitConcurrentSessions,
        keyModelGroupOnly: 0,
        userCurrent: quota.userCurrentConcurrentSessions,
        userLimit: quota.userLimitConcurrentSessions,
        userModelGroupOnly: 0,
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
            keyModelGroupOnly={item.keyModelGroupOnly ?? 0}
            userCurrent={item.userCurrent ?? 0}
            userLimit={item.userLimit}
            userModelGroupOnly={item.userModelGroupOnly ?? 0}
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
  keyModelGroupOnly,
  userCurrent,
  userLimit,
  userModelGroupOnly,
  currency,
}: {
  title: string;
  keyCurrent: number;
  keyLimit: number | null;
  keyModelGroupOnly: number;
  userCurrent: number;
  userLimit: number | null;
  userModelGroupOnly: number;
  currency?: CurrencyCode;
}) {
  const t = useTranslations("myUsage.quota");

  // group-rate-limit (§5.3/§10): gauge uses countedInGlobal portion (total minus model-group-only)
  const keyGaugeCurrent = keyCurrent - keyModelGroupOnly;
  const userGaugeCurrent = userCurrent - userModelGroupOnly;

  const keyPct = calculateUsagePercent(keyGaugeCurrent, keyLimit);
  const userPct = calculateUsagePercent(userGaugeCurrent, userLimit);

  return (
    <div className="space-y-2 rounded-md border bg-card/50 p-3">
      <div className="text-xs font-semibold text-muted-foreground">{title}</div>
      <QuotaRow
        label={t("keyLevel")}
        current={keyGaugeCurrent}
        limit={keyLimit}
        percent={keyPct}
        modelGroupOnly={keyModelGroupOnly}
        currency={currency}
      />
      <QuotaRow
        label={t("userLevel")}
        current={userGaugeCurrent}
        limit={userLimit}
        percent={userPct}
        modelGroupOnly={userModelGroupOnly}
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
  modelGroupOnly = 0,
  currency,
}: {
  label: string;
  current: number;
  limit: number | null;
  percent: number | null;
  modelGroupOnly?: number;
  currency?: CurrencyCode;
}) {
  const t = useTranslations("myUsage.quota");
  const unlimited = isUnlimited(limit);
  const tone = getTone(percent);
  const hasSplit = modelGroupOnly > 0;

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
    <div className="space-y-0.5">
      <div className="flex items-center gap-2">
        <span className="w-auto shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
          {label}
        </span>
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
          <span className="text-muted-foreground">
            {" / "}
            {unlimited ? <InfinityIcon className="inline h-3.5 w-3.5" /> : limitDisplay}
          </span>
        </span>
      </div>
      {hasSplit ? (
        <div className="flex items-center gap-1 pl-0 text-[10px] text-muted-foreground">
          <span title={t("splitNote")} className="cursor-help">
            {t("modelGroupOnlyLabel")}:
          </span>
          <span className="font-mono">{formatValue(modelGroupOnly)}</span>
        </div>
      ) : null}
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
