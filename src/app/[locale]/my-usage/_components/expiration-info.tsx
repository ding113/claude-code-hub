"use client";

import { Clock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCountdown } from "@/hooks/useCountdown";
import { cn } from "@/lib/utils";
import { formatDate, getLocaleDateFormat } from "@/lib/utils/date-format";

interface ExpirationInfoProps {
  keyExpiresAt: Date | null;
  userExpiresAt: Date | null;
  userRpmLimit?: number | null;
  className?: string;
}

const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;
const ONE_DAY_IN_SECONDS = 24 * 60 * 60;

type ExpireStatus = "none" | "normal" | "warning" | "danger" | "expired";

export function ExpirationInfo({
  keyExpiresAt,
  userExpiresAt,
  userRpmLimit,
  className,
}: ExpirationInfoProps) {
  const t = useTranslations("myUsage.expiration");
  const locale = useLocale();

  const keyCountdown = useCountdown(keyExpiresAt ?? null, Boolean(keyExpiresAt));
  const userCountdown = useCountdown(userExpiresAt ?? null, Boolean(userExpiresAt));

  const formatExpiry = (value: Date | null) => {
    if (!value) return t("neverExpires");
    const formatted = formatDate(value, getLocaleDateFormat(locale, "long"), locale);
    return formatted;
  };

  const getStatus = (
    value: Date | null,
    countdownTotalSeconds: number,
    isExpired: boolean
  ): ExpireStatus => {
    if (!value) return "none";
    if (isExpired) return "expired";
    if (countdownTotalSeconds <= ONE_DAY_IN_SECONDS) return "danger";
    if (countdownTotalSeconds <= SEVEN_DAYS_IN_SECONDS) return "warning";
    return "normal";
  };

  const statusStyles: Record<ExpireStatus, string> = {
    none: "text-muted-foreground",
    normal: "text-foreground",
    warning: "text-amber-600 dark:text-amber-400",
    danger: "text-red-600 dark:text-red-400",
    expired: "text-destructive",
  };

  const countdownStyles: Record<ExpireStatus, string> = {
    none: "text-muted-foreground",
    normal: "text-emerald-600 dark:text-emerald-400",
    warning: "text-amber-600 dark:text-amber-400",
    danger: "text-red-600 dark:text-red-400",
    expired: "text-destructive",
  };

  const renderItem = (
    label: string,
    value: Date | null,
    countdown: ReturnType<typeof useCountdown>
  ) => {
    const status = getStatus(value, countdown.totalSeconds, countdown.isExpired);
    const showCountdown =
      value !== null &&
      !countdown.isExpired &&
      countdown.totalSeconds > 0 &&
      countdown.totalSeconds <= SEVEN_DAYS_IN_SECONDS;

    return (
      <div className="space-y-2 rounded-md border border-border/60 bg-card/50 p-3">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <div className="flex items-center gap-2">
          <span className={cn("text-sm font-semibold", statusStyles[status])}>
            {status === "expired"
              ? `${t("expired")} (${formatExpiry(value)})`
              : formatExpiry(value)}
          </span>
        </div>
        {showCountdown ? (
          <div className={cn("flex items-center gap-1.5 pt-1", countdownStyles[status])}>
            <Clock className="h-3.5 w-3.5" />
            <span className="text-sm font-semibold font-mono tabular-nums">
              {countdown.shortFormatted}
            </span>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={cn("grid gap-3 sm:grid-cols-3", className)}>
      {renderItem(t("keyExpires"), keyExpiresAt, keyCountdown)}
      {renderItem(t("userExpires"), userExpiresAt, userCountdown)}
      <div className="space-y-2 rounded-md border border-border/60 bg-card/50 p-3">
        <p className="text-xs font-medium text-muted-foreground">{t("rpmLimit")}</p>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            {userRpmLimit != null ? userRpmLimit.toLocaleString() : "∞"}
          </span>
        </div>
      </div>
    </div>
  );
}
