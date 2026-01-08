"use client";

import { AlertTriangle, ChevronDown, Infinity, PieChart } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { MyUsageQuota } from "@/actions/my-usage";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { CurrencyCode } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { calculateUsagePercent } from "@/lib/utils/limit-helpers";
import { QuotaCards } from "./quota-cards";

interface CollapsibleQuotaCardProps {
  quota: MyUsageQuota | null;
  loading?: boolean;
  currencyCode?: CurrencyCode;
  keyExpiresAt?: Date | null;
  userExpiresAt?: Date | null;
  defaultOpen?: boolean;
}

export function CollapsibleQuotaCard({
  quota,
  loading = false,
  currencyCode = "USD",
  keyExpiresAt,
  userExpiresAt,
  defaultOpen = false,
}: CollapsibleQuotaCardProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const t = useTranslations("myUsage.quotaCollapsible");

  // Calculate summary metrics
  const userDailyPct = calculateUsagePercent(
    quota?.userCurrentDailyUsd ?? 0,
    quota?.userLimitDailyUsd ?? null
  );
  const userMonthlyPct = calculateUsagePercent(
    quota?.userCurrentMonthlyUsd ?? 0,
    quota?.userLimitMonthlyUsd ?? null
  );
  const userTotalPct = calculateUsagePercent(
    quota?.userCurrentTotalUsd ?? 0,
    quota?.userLimitTotalUsd ?? null
  );

  // Use user-level percentages for summary display (null = unlimited)
  const dailyPct = userDailyPct;
  const monthlyPct = userMonthlyPct;
  const totalPct = userTotalPct;

  const hasWarning =
    (dailyPct !== null && dailyPct >= 80) ||
    (monthlyPct !== null && monthlyPct >= 80) ||
    (totalPct !== null && totalPct >= 80);
  const hasDanger =
    (dailyPct !== null && dailyPct >= 95) ||
    (monthlyPct !== null && monthlyPct >= 95) ||
    (totalPct !== null && totalPct >= 95);

  const getPercentColor = (pct: number | null) => {
    if (pct === null) return "text-muted-foreground";
    if (pct >= 95) return "text-destructive";
    if (pct >= 80) return "text-amber-600 dark:text-amber-400";
    return "text-foreground";
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-lg border bg-card">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-muted/50",
              isOpen && "border-b"
            )}
          >
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full",
                  hasDanger
                    ? "bg-destructive/10 text-destructive"
                    : hasWarning
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      : "bg-primary/10 text-primary"
                )}
              >
                <PieChart className="h-4 w-4" />
              </div>
              <span className="text-sm font-semibold">{t("title")}</span>
            </div>

            <div className="flex items-center gap-4">
              {/* Compact metrics */}
              <div className="hidden items-center gap-4 text-sm sm:flex">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">{t("daily")}:</span>
                  {dailyPct === null ? (
                    <Infinity className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <>
                      <span className={cn("font-semibold", getPercentColor(dailyPct))}>
                        {Math.round(dailyPct)}%
                      </span>
                      {dailyPct >= 80 && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                    </>
                  )}
                </div>
                <span className="text-muted-foreground/50">|</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">{t("monthly")}:</span>
                  {monthlyPct === null ? (
                    <Infinity className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <>
                      <span className={cn("font-semibold", getPercentColor(monthlyPct))}>
                        {Math.round(monthlyPct)}%
                      </span>
                      {monthlyPct >= 80 && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                    </>
                  )}
                </div>
                <span className="text-muted-foreground/50">|</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">{t("total")}:</span>
                  {totalPct === null ? (
                    <Infinity className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <>
                      <span className={cn("font-semibold", getPercentColor(totalPct))}>
                        {Math.round(totalPct)}%
                      </span>
                      {totalPct >= 80 && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                    </>
                  )}
                </div>
              </div>

              {/* Mobile compact view */}
              <div className="flex items-center gap-2 text-xs sm:hidden">
                <span className={cn("font-semibold", getPercentColor(dailyPct))}>
                  D:{dailyPct === null ? "∞" : `${Math.round(dailyPct)}%`}
                </span>
                <span className={cn("font-semibold", getPercentColor(monthlyPct))}>
                  M:{monthlyPct === null ? "∞" : `${Math.round(monthlyPct)}%`}
                </span>
                <span className={cn("font-semibold", getPercentColor(totalPct))}>
                  T:{totalPct === null ? "∞" : `${Math.round(totalPct)}%`}
                </span>
                {hasWarning && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
              </div>

              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform duration-200",
                  isOpen && "rotate-180"
                )}
              />
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="p-4">
            <QuotaCards
              quota={quota}
              loading={loading}
              currencyCode={currencyCode}
              keyExpiresAt={keyExpiresAt}
              userExpiresAt={userExpiresAt}
            />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
