"use client";

import { AlertTriangle, ChevronDown, PieChart } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { MyUsageQuota } from "@/actions/my-usage";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  const keyDailyPct = calculateUsagePercent(
    quota?.keyCurrentDailyUsd ?? 0,
    quota?.keyLimitDailyUsd ?? null
  );
  const userDailyPct = calculateUsagePercent(
    quota?.userCurrentDailyUsd ?? 0,
    quota?.userLimitDailyUsd ?? null
  );
  const keyMonthlyPct = calculateUsagePercent(
    quota?.keyCurrentMonthlyUsd ?? 0,
    quota?.keyLimitMonthlyUsd ?? null
  );
  const userMonthlyPct = calculateUsagePercent(
    quota?.userCurrentMonthlyUsd ?? 0,
    quota?.userLimitMonthlyUsd ?? null
  );
  const keyTotalPct = calculateUsagePercent(
    quota?.keyCurrentTotalUsd ?? 0,
    quota?.keyLimitTotalUsd ?? null
  );
  const userTotalPct = calculateUsagePercent(
    quota?.userCurrentTotalUsd ?? 0,
    quota?.userLimitTotalUsd ?? null
  );

  // Use user-level percentages for summary display
  const dailyPct = userDailyPct ?? 0;
  const monthlyPct = userMonthlyPct ?? 0;
  const totalPct = userTotalPct ?? 0;

  const hasWarning = dailyPct >= 80 || monthlyPct >= 80 || totalPct >= 80;
  const hasDanger = dailyPct >= 95 || monthlyPct >= 95 || totalPct >= 95;

  const formatPercent = (pct: number) => `${Math.round(pct)}%`;

  const getPercentColor = (pct: number) => {
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
                  <span className={cn("font-semibold", getPercentColor(dailyPct))}>
                    {formatPercent(dailyPct)}
                  </span>
                  {dailyPct >= 80 && (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  )}
                </div>
                <span className="text-muted-foreground/50">|</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">{t("monthly")}:</span>
                  <span className={cn("font-semibold", getPercentColor(monthlyPct))}>
                    {formatPercent(monthlyPct)}
                  </span>
                  {monthlyPct >= 80 && (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  )}
                </div>
                <span className="text-muted-foreground/50">|</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">{t("total")}:</span>
                  <span className={cn("font-semibold", getPercentColor(totalPct))}>
                    {formatPercent(totalPct)}
                  </span>
                  {totalPct >= 80 && (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  )}
                </div>
              </div>

              {/* Mobile compact view */}
              <div className="flex items-center gap-2 text-xs sm:hidden">
                <span className={cn("font-semibold", getPercentColor(dailyPct))}>
                  D:{formatPercent(dailyPct)}
                </span>
                <span className={cn("font-semibold", getPercentColor(monthlyPct))}>
                  M:{formatPercent(monthlyPct)}
                </span>
                <span className={cn("font-semibold", getPercentColor(totalPct))}>
                  T:{formatPercent(totalPct)}
                </span>
                {hasWarning && (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                )}
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
