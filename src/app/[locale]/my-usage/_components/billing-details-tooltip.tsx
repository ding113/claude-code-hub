"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  computeDisplayUnitPricePer1M,
  resolveCostBreakdownForDisplay,
} from "@/lib/utils/cost-breakdown-display";
import {
  type CurrencyCode,
  Decimal,
  formatCostMultiplier,
  formatCurrency,
  formatUnitPrice,
  toDecimal,
} from "@/lib/utils/currency";
import type { StoredCostBreakdown } from "@/types/cost-breakdown";

export interface BillingDetailLog {
  cost: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  cacheCreation5mInputTokens?: number | null;
  cacheCreation1hInputTokens?: number | null;
  cacheTtlApplied?: string | null;
  costBreakdown?: StoredCostBreakdown | null;
  costMultiplier?: string | number | null;
  groupCostMultiplier?: string | number | null;
  context1mApplied?: boolean | null;
}

/**
 * Compact billing detail tooltip content (admin logs style).
 * Safe for self-service: only uses persisted billing fields, never provider chain data.
 */
export function BillingDetailsTooltipContent({
  log,
  currencyCode = "USD",
}: {
  log: BillingDetailLog;
  currencyCode?: CurrencyCode;
}) {
  const t = useTranslations("dashboard.logs");
  const title = t("details.billingDetails.title");
  const totalCostLabel = t("details.billingDetails.totalCost");
  const amountClassName = "font-mono tabular-nums text-right";

  const costBreakdown = resolveCostBreakdownForDisplay({
    costBreakdown: log.costBreakdown,
    costUsd: log.cost,
    providerMultiplier: log.costMultiplier,
    groupMultiplier: log.groupCostMultiplier,
    tokens: {
      inputTokens: log.inputTokens,
      outputTokens: log.outputTokens,
      cacheCreationInputTokens: log.cacheCreationInputTokens,
      cacheReadInputTokens: log.cacheReadInputTokens,
      cacheCreation5mInputTokens: log.cacheCreation5mInputTokens,
      cacheCreation1hInputTokens: log.cacheCreation1hInputTokens,
      cacheTtlApplied: log.cacheTtlApplied,
    },
  });

  const headerChip = log.context1mApplied ? (
    <Badge
      variant="outline"
      className="shrink-0 text-[10px] leading-tight px-1 bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-800"
    >
      {t("details.billingDetails.context1m")}
    </Badge>
  ) : null;

  const resolveCacheCreationRows = (breakdown: StoredCostBreakdown) => {
    const tokens5m = log.cacheCreation5mInputTokens ?? 0;
    const tokens1h = log.cacheCreation1hInputTokens ?? 0;
    const totalCacheTokens = log.cacheCreationInputTokens;
    const has5m = breakdown.cache_creation_5m !== undefined;
    const has1h = breakdown.cache_creation_1h !== undefined;
    if (has5m || has1h) {
      return [
        {
          amount: breakdown.cache_creation_5m ?? "0",
          tokens: tokens5m > 0 ? tokens5m : log.cacheTtlApplied !== "1h" ? totalCacheTokens : 0,
          ttl: "5m" as const,
        },
        {
          amount: breakdown.cache_creation_1h ?? "0",
          tokens: tokens1h > 0 ? tokens1h : log.cacheTtlApplied === "1h" ? totalCacheTokens : 0,
          ttl: "1h" as const,
        },
      ];
    }

    const aggregate = toDecimal(breakdown.cache_creation);
    if (!aggregate || aggregate.lte(0)) return [];

    if (log.cacheTtlApplied === "mixed" && tokens5m + tokens1h > 0) {
      const totalTokens = new Decimal(tokens5m + tokens1h);
      const fiveMShare = aggregate.mul(tokens5m).div(totalTokens);
      return [
        { amount: fiveMShare.toString(), tokens: tokens5m, ttl: "5m" as const },
        {
          amount: aggregate.minus(fiveMShare).toString(),
          tokens: tokens1h,
          ttl: "1h" as const,
        },
      ];
    }

    if (log.cacheTtlApplied === "1h") {
      return [
        {
          amount: aggregate.toString(),
          tokens: tokens1h > 0 ? tokens1h : totalCacheTokens,
          ttl: "1h" as const,
        },
      ];
    }

    if (log.cacheTtlApplied === "5m") {
      return [
        {
          amount: aggregate.toString(),
          tokens: tokens5m > 0 ? tokens5m : totalCacheTokens,
          ttl: "5m" as const,
        },
      ];
    }

    return [
      {
        amount: aggregate.toString(),
        tokens: totalCacheTokens,
        ttl: undefined as "5m" | "1h" | undefined,
      },
    ];
  };

  const createCostRow = (
    label: string,
    amount: string | null | undefined,
    tokens: number | null | undefined,
    ttl?: "5m" | "1h"
  ) => {
    const parsedAmount = toDecimal(amount);
    if (!parsedAmount || parsedAmount.lte(0)) return null;
    const tokenCount = tokens ?? 0;
    const pm = costBreakdown?.provider_multiplier ?? 1;
    const gm = costBreakdown?.group_multiplier ?? 1;
    const mult = new Decimal(pm).mul(gm);
    const displayAmount = parsedAmount.mul(mult);
    const unitPrice = computeDisplayUnitPricePer1M({
      lineAmount: amount,
      tokens: tokenCount,
      amountIsBase: true,
      providerMultiplier: pm,
      groupMultiplier: gm,
    });
    return {
      key: `${label}-${ttl ?? "default"}`,
      label,
      ttl,
      unitPrice: unitPrice
        ? t("details.billingDetails.unitPricePer1M", {
            price: formatUnitPrice(unitPrice, currencyCode),
          })
        : null,
      amount: formatCurrency(displayAmount, currencyCode, 6),
    };
  };

  const renderTtlChip = (ttl: "5m" | "1h") => (
    <Badge
      variant="outline"
      className="px-1 text-[10px] leading-tight text-background/80 border-background/30"
    >
      {ttl}
    </Badge>
  );

  const renderValueBlock = ({
    primary,
    secondary,
    emphasize = false,
    secondaryClassName,
  }: {
    primary: string;
    secondary?: ReactNode;
    emphasize?: boolean;
    secondaryClassName?: string;
  }) => (
    <div className={cn("flex flex-col items-end", amountClassName)}>
      {secondary ? (
        <span className={cn("text-[11px] text-background/70", secondaryClassName)}>
          {secondary}
        </span>
      ) : null}
      <span className={cn(emphasize ? "text-sm font-semibold text-emerald-300" : "")}>
        {primary}
      </span>
    </div>
  );

  const renderSummaryRow = ({
    label,
    primary,
    secondary,
    emphasize = false,
    className,
    secondaryClassName,
  }: {
    label: string;
    primary: string;
    secondary?: ReactNode;
    emphasize?: boolean;
    className?: string;
    secondaryClassName?: string;
  }) => (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <span className="text-[11px] font-medium text-background/70">{label}</span>
      {renderValueBlock({ primary, secondary, emphasize, secondaryClassName })}
    </div>
  );

  const isActiveMultiplier = (value: number) => Number.isFinite(value) && value > 0 && value !== 1;

  if (!costBreakdown) {
    return (
      <TooltipContent align="end" className="max-w-[320px] p-3">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-background">{title}</span>
            {headerChip}
          </div>
          <div className="border-t border-background/20 pt-2">
            {renderSummaryRow({
              label: totalCostLabel,
              primary: formatCurrency(log.cost, currencyCode, 6),
              emphasize: true,
            })}
          </div>
        </div>
      </TooltipContent>
    );
  }

  const cacheCreationRows = resolveCacheCreationRows(costBreakdown);
  const costRows = [
    createCostRow(t("details.billingDetails.input"), costBreakdown.input, log.inputTokens),
    createCostRow(t("details.billingDetails.output"), costBreakdown.output, log.outputTokens),
    ...cacheCreationRows.map((row) =>
      createCostRow(t("columns.cacheWrite"), row.amount, row.tokens, row.ttl)
    ),
    createCostRow(
      t("details.billingDetails.cacheRead"),
      costBreakdown.cache_read,
      log.cacheReadInputTokens
    ),
  ].filter((row): row is NonNullable<typeof row> => row !== null);

  const providerMult =
    costBreakdown.provider_multiplier ??
    (log.costMultiplier != null ? Number(log.costMultiplier) : 1);
  const groupMult =
    costBreakdown.group_multiplier ??
    (log.groupCostMultiplier != null ? Number(log.groupCostMultiplier) : 1);

  const activeMultiplierRows = [
    isActiveMultiplier(providerMult)
      ? {
          key: "provider",
          label: t("details.billingDetails.providerMultiplier"),
          value: `${formatCostMultiplier(providerMult)}x`,
        }
      : null,
    isActiveMultiplier(groupMult)
      ? {
          key: "group",
          label: t("details.billingDetails.groupMultiplier"),
          value: `${formatCostMultiplier(groupMult)}x`,
        }
      : null,
  ].filter((row): row is NonNullable<typeof row> => row !== null);

  const hasActiveMultipliers = activeMultiplierRows.length > 0;
  const baseTotal = formatCurrency(costBreakdown.base_total, currencyCode, 6);
  const finalTotal = formatCurrency(costBreakdown.total ?? log.cost, currencyCode, 6);

  return (
    <TooltipContent align="end" className="max-w-[320px] p-3">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-background">{title}</span>
          {headerChip}
        </div>

        {costRows.length > 0 ? (
          <div className="space-y-2">
            {costRows.map((row) => (
              <div key={row.key} className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-background/70">
                  <span>{row.label}</span>
                  {row.ttl ? renderTtlChip(row.ttl) : null}
                </div>
                {renderValueBlock({ primary: row.amount, secondary: row.unitPrice })}
              </div>
            ))}
          </div>
        ) : null}

        {hasActiveMultipliers ? (
          <>
            {renderSummaryRow({
              label: t("details.billingDetails.baseTotal"),
              primary: baseTotal,
              className: costRows.length > 0 ? "border-t border-background/20 pt-2" : undefined,
            })}
            <div className="space-y-2 rounded-md border border-background/20 bg-background/10 p-2">
              {activeMultiplierRows.map((row) => (
                <div key={row.key} className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-background/70">{row.label}</span>
                  <span className={cn(amountClassName, "text-[11px]")}>{row.value}</span>
                </div>
              ))}
            </div>
            {renderSummaryRow({
              label: totalCostLabel,
              primary: finalTotal,
              secondary: baseTotal,
              secondaryClassName: "line-through",
              emphasize: true,
              className: "border-t border-background/20 pt-2",
            })}
          </>
        ) : (
          <div className={cn(costRows.length > 0 ? "border-t border-background/20 pt-2" : "")}>
            {renderSummaryRow({
              label: totalCostLabel,
              primary: finalTotal,
              emphasize: true,
            })}
          </div>
        )}
      </div>
    </TooltipContent>
  );
}
