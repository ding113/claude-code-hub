"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { MyUsageQuota } from "@/actions/my-usage";
import { QuotaCountdownCompact } from "@/components/quota/quota-countdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useCountdown } from "@/hooks/useCountdown";
import type { CurrencyCode } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { calculateUsagePercent, isUnlimited } from "@/lib/utils/limit-helpers";

interface QuotaCardsProps {
  quota: MyUsageQuota | null;
  loading?: boolean;
  currencyCode?: CurrencyCode;
  keyExpiresAt?: Date | null;
  userExpiresAt?: Date | null;
}

export function QuotaCards({
  quota,
  loading = false,
  currencyCode = "USD",
  keyExpiresAt,
  userExpiresAt,
}: QuotaCardsProps) {
  const t = useTranslations("myUsage.quota");
  const tExpiration = useTranslations("myUsage.expiration");
  const tCommon = useTranslations("common");

  const resolvedKeyExpires = keyExpiresAt ?? quota?.expiresAt ?? null;
  const resolvedUserExpires = userExpiresAt ?? quota?.userExpiresAt ?? null;

  const shouldEnableCountdown = !(loading && !quota);

  const keyCountdown = useCountdown(
    resolvedKeyExpires,
    shouldEnableCountdown && Boolean(resolvedKeyExpires)
  );
  const userCountdown = useCountdown(
    resolvedUserExpires,
    shouldEnableCountdown && Boolean(resolvedUserExpires)
  );

  const isExpiring = (countdown: ReturnType<typeof useCountdown>) =>
    countdown.totalSeconds > 0 && countdown.totalSeconds <= 7 * 24 * 60 * 60;

  const showKeyBadge = resolvedKeyExpires && !keyCountdown.isExpired && isExpiring(keyCountdown);
  const showUserBadge =
    resolvedUserExpires && !userCountdown.isExpired && isExpiring(userCountdown);

  const renderExpireBadge = (
    label: string,
    resetAt: Date | null,
    countdown: ReturnType<typeof useCountdown>
  ) => {
    if (!resetAt) return null;
    const tone = countdown.totalSeconds <= 24 * 60 * 60 ? "danger" : "warning";
    const toneClass =
      tone === "danger"
        ? "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200"
        : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-100";

    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium",
          toneClass
        )}
      >
        <span>{label}</span>
        <QuotaCountdownCompact resetAt={resetAt} />
      </span>
    );
  };

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
    <div className="space-y-3">
      {showKeyBadge || showUserBadge ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed bg-muted/40 p-3">
          <span className="text-xs font-medium text-muted-foreground">
            {tExpiration("expiringWarning")}
          </span>
          {showKeyBadge
            ? renderExpireBadge(tExpiration("keyExpires"), resolvedKeyExpires, keyCountdown)
            : null}
          {showUserBadge
            ? renderExpireBadge(tExpiration("userExpires"), resolvedUserExpires, userCountdown)
            : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const keyPct = calculateUsagePercent(item.keyCurrent, item.keyLimit);
          const userPct = calculateUsagePercent(item.userCurrent ?? 0, item.userLimit);

          const keyTone = getTone(keyPct);
          const userTone = getTone(userPct);
          const hasUserData = item.userLimit !== null || item.userCurrent !== null;

          return (
            <Card key={item.key} className="border-border/70">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-muted-foreground">
                  {item.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <QuotaColumn
                    label={t("keyLevel")}
                    current={item.keyCurrent}
                    limit={item.keyLimit}
                    percent={keyPct}
                    tone={keyTone}
                    currency={item.key === "concurrent" ? undefined : currencyCode}
                  />
                  <QuotaColumn
                    label={t("userLevel")}
                    current={item.userCurrent ?? 0}
                    limit={item.userLimit}
                    percent={userPct}
                    tone={userTone}
                    currency={item.key === "concurrent" ? undefined : currencyCode}
                    muted={!hasUserData}
                  />
                </div>
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
    </div>
  );
}

function QuotaCardsSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Card key={index} className="border-border/70">
            <CardHeader className="pb-3">
              <Skeleton className="h-4 w-20" />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Skeleton className="h-3 w-3 rounded-full" />
        <span>{label}</span>
      </div>
    </div>
  );
}

function QuotaColumn({
  label,
  current,
  limit,
  percent,
  tone,
  currency,
  muted = false,
}: {
  label: string;
  current: number;
  limit: number | null;
  percent: number | null;
  tone: "default" | "warn" | "danger";
  currency?: string;
  muted?: boolean;
}) {
  const t = useTranslations("myUsage.quota");

  const formatValue = (value: number) => {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return currency ? `${currency} 0.00` : "0";
    }
    return currency ? `${currency} ${num.toFixed(2)}` : String(num);
  };

  const unlimited = isUnlimited(limit);

  const progressClass = cn("h-2", {
    "bg-destructive/10 [&>div]:bg-destructive": tone === "danger",
    "bg-amber-500/10 [&>div]:bg-amber-500": tone === "warn",
  });

  const limitDisplay = unlimited ? t("unlimited") : formatValue(limit as number);
  const ariaLabel = `${label}: ${formatValue(current)}${!unlimited ? ` / ${limitDisplay}` : ""}`;

  return (
    <div className={cn("space-y-2 rounded-md border bg-card/50 p-3", muted && "opacity-70")}>
      {/* Label */}
      <div className="text-xs font-medium text-muted-foreground">{label}</div>

      {/* Values - split into two lines to avoid overlap */}
      <div className="space-y-0.5">
        <div className="text-sm font-mono font-medium text-foreground">{formatValue(current)}</div>
        <div className="text-xs text-muted-foreground">/ {limitDisplay}</div>
      </div>

      {/* Progress bar or placeholder */}
      {!unlimited ? (
        <Progress value={percent ?? 0} className={progressClass} aria-label={ariaLabel} />
      ) : (
        <div
          className="h-2 rounded-full bg-muted/50"
          role="progressbar"
          aria-label={`${label}: ${t("unlimited")}`}
          aria-valuetext={t("unlimited")}
        />
      )}
    </div>
  );
}

function getTone(percent: number | null): "default" | "warn" | "danger" {
  if (percent === null) return "default";
  if (percent >= 95) return "danger";
  if (percent >= 80) return "warn";
  return "default";
}
