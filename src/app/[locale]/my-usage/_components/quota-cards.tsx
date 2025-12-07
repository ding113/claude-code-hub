"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { MyUsageQuota } from "@/actions/my-usage";
import { QuotaCountdownCompact } from "@/components/quota/quota-countdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useCountdown } from "@/hooks/useCountdown";
import type { CurrencyCode } from "@/lib/utils";
import { cn } from "@/lib/utils";

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

  const resolvedKeyExpires = keyExpiresAt ?? quota?.expiresAt ?? null;
  const resolvedUserExpires = userExpiresAt ?? quota?.userExpiresAt ?? null;

  const keyCountdown = useCountdown(resolvedKeyExpires, Boolean(resolvedKeyExpires));
  const userCountdown = useCountdown(resolvedUserExpires, Boolean(resolvedUserExpires));

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
        userCurrent: null,
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
        userLimit: quota.userLimitConcurrentSessions ?? null,
      },
    ];
  }, [quota, t]);

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
          const keyPct = item.keyLimit
            ? Math.min((item.keyCurrent / item.keyLimit) * 100, 999)
            : null;
          const userPct = item.userLimit
            ? Math.min(((item.userCurrent ?? 0) / item.userLimit) * 100, 999)
            : null;

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
  const formatValue = (value: number) =>
    currency ? `${currency} ${value.toFixed(2)}` : value.toString();

  const progressClass = `h-2 ${
    tone === "danger"
      ? "bg-destructive/10 [&>div]:bg-destructive"
      : tone === "warn"
        ? "bg-amber-500/10 [&>div]:bg-amber-500"
        : ""
  }`;

  const ariaLabel = `${label}: ${formatValue(current)}${limit !== null ? ` / ${formatValue(limit)}` : ""}`;

  return (
    <div className={cn("space-y-1.5 rounded-md border bg-card/50 p-3", muted && "opacity-60")}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono text-foreground">
          {formatValue(current)}
          {limit !== null ? ` / ${formatValue(limit)}` : ` / ${t("unlimited")}`}
        </span>
      </div>
      <Progress value={percent ?? 0} className={progressClass.trim()} aria-label={ariaLabel} />
    </div>
  );
}

function getTone(percent: number | null): "default" | "warn" | "danger" {
  if (percent === null) return "default";
  if (percent >= 95) return "danger";
  if (percent >= 80) return "warn";
  return "default";
}
