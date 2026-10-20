"use client";

import { DatabaseZap } from "lucide-react";
import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { RequestCacheMetricAvailability } from "@/lib/cache-effectiveness/request-metrics";
import { cn, formatTokenAmount } from "@/lib/utils";

interface CachePerformanceProps {
  actualCacheRate: number | null | undefined;
  theoreticalCacheRate: number | null | undefined;
  requestCacheCoefficientBp: number | null | undefined;
  requestCacheMetricAvailability: RequestCacheMetricAvailability | undefined;
  cacheInputTotal?: number | null;
  cacheReadInputTokens?: number | null;
  theoreticalCacheTokens?: number | null;
  compact?: boolean;
}

function formatRate(rate: number | null | undefined): string {
  return typeof rate === "number" ? `${(rate * 100).toFixed(1)}%` : "–";
}

function formatCoefficient(bp: number | null | undefined): string {
  return typeof bp === "number" ? (bp / 10000).toFixed(2) : "–";
}

export function CachePerformance({
  actualCacheRate,
  theoreticalCacheRate,
  requestCacheCoefficientBp,
  requestCacheMetricAvailability,
  cacheInputTotal,
  cacheReadInputTokens,
  theoreticalCacheTokens,
  compact = false,
}: CachePerformanceProps) {
  const t = useTranslations("dashboard.logs.details.cachePerformance");
  const availability = requestCacheMetricAvailability ?? "not_recorded";
  const availabilityLabel = t(`availability.${availability}`);
  const values = [
    {
      label: t("actualRate"),
      value: formatRate(actualCacheRate),
      tokenValue:
        cacheInputTotal != null && cacheReadInputTokens != null
          ? `${formatTokenAmount(cacheReadInputTokens)} / ${formatTokenAmount(cacheInputTotal)}`
          : null,
    },
    {
      label: t("theoreticalRate"),
      value: formatRate(theoreticalCacheRate),
      tokenValue:
        cacheInputTotal != null && theoreticalCacheTokens != null
          ? `${formatTokenAmount(theoreticalCacheTokens)} / ${formatTokenAmount(cacheInputTotal)}`
          : null,
    },
    {
      label: t("coefficient"),
      value: formatCoefficient(requestCacheCoefficientBp),
      tokenValue: requestCacheCoefficientBp == null ? availabilityLabel : t("rawCoefficient"),
    },
  ];

  return (
    <section className={cn("space-y-2", compact && "space-y-1")}>
      <div className="flex items-center gap-2">
        <DatabaseZap className="h-4 w-4 text-cyan-600" />
        <h4 className={cn("text-sm font-semibold", compact && "text-xs")}>{t("title")}</h4>
      </div>
      <div className={cn("grid gap-3", compact ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-3")}>
        {values.map((item) => (
          <TooltipProvider key={item.label}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="rounded-lg border bg-card p-3 cursor-help">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className={cn("font-mono font-semibold", compact ? "text-sm" : "text-base")}>
                    {item.value}
                  </p>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                <p>{item.tokenValue ?? availabilityLabel}</p>
                {!compact && <p className="mt-1 text-muted-foreground">{t("estimateNote")}</p>}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ))}
      </div>
      {!compact && <p className="text-[11px] text-muted-foreground">{availabilityLabel}</p>}
    </section>
  );
}
