"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Coins,
  Database,
  Hash,
  Percent,
  Target,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { formatTokenAmount } from "@/lib/utils";
import { type CurrencyCode, formatCurrency } from "@/lib/utils/currency";

export interface ModelBreakdownItem {
  model: string | null;
  requests: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface ModelBreakdownLabels {
  unknownModel: string;
  modal: {
    requests: string;
    cost: string;
    inputTokens: string;
    outputTokens: string;
    cacheCreationTokens: string;
    cacheReadTokens: string;
    totalTokens: string;
    costPercentage: string;
    cacheHitRate: string;
    cacheTokens: string;
    performanceHigh: string;
    performanceMedium: string;
    performanceLow: string;
  };
}

interface ModelBreakdownColumnProps {
  pageItems: ModelBreakdownItem[];
  currencyCode: CurrencyCode;
  totalCost: number;
  keyPrefix: string;
  pageOffset: number;
  labels?: ModelBreakdownLabels;
}

export function ModelBreakdownColumn({
  pageItems,
  currencyCode,
  totalCost,
  keyPrefix,
  pageOffset,
  labels,
}: ModelBreakdownColumnProps) {
  return (
    <div className="space-y-2">
      {pageItems.map((item, index) => (
        <ModelBreakdownRow
          key={`${keyPrefix}-${item.model ?? "unknown"}-${pageOffset + index}`}
          model={item.model}
          requests={item.requests}
          cost={item.cost}
          inputTokens={item.inputTokens}
          outputTokens={item.outputTokens}
          cacheCreationTokens={item.cacheCreationTokens}
          cacheReadTokens={item.cacheReadTokens}
          currencyCode={currencyCode}
          totalCost={totalCost}
          labels={labels}
        />
      ))}
    </div>
  );
}

interface ModelBreakdownRowProps {
  model: string | null;
  requests: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  currencyCode: CurrencyCode;
  totalCost: number;
  labels?: ModelBreakdownLabels;
}

function useLabels(labels?: ModelBreakdownLabels) {
  const t = useTranslations("myUsage.stats");

  if (labels) {
    return {
      unknownModel: labels.unknownModel,
      modalRequests: labels.modal.requests,
      modalCost: labels.modal.cost,
      modalInputTokens: labels.modal.inputTokens,
      modalOutputTokens: labels.modal.outputTokens,
      modalCacheCreationTokens: labels.modal.cacheCreationTokens,
      modalCacheReadTokens: labels.modal.cacheReadTokens,
      modalTotalTokens: labels.modal.totalTokens,
      modalCacheHitRate: labels.modal.cacheHitRate,
      modalCacheTokens: labels.modal.cacheTokens,
      modalPerformanceHigh: labels.modal.performanceHigh,
      modalPerformanceMedium: labels.modal.performanceMedium,
      modalPerformanceLow: labels.modal.performanceLow,
    };
  }

  return {
    unknownModel: t("unknownModel"),
    modalRequests: t("modal.requests"),
    modalCost: t("modal.cost"),
    modalInputTokens: t("modal.inputTokens"),
    modalOutputTokens: t("modal.outputTokens"),
    modalCacheCreationTokens: t("modal.cacheWrite"),
    modalCacheReadTokens: t("modal.cacheRead"),
    modalTotalTokens: t("modal.totalTokens"),
    modalCacheHitRate: t("modal.cacheHitRate"),
    modalCacheTokens: t("modal.cacheTokens"),
    modalPerformanceHigh: t("modal.performanceHigh"),
    modalPerformanceMedium: t("modal.performanceMedium"),
    modalPerformanceLow: t("modal.performanceLow"),
  };
}

export function ModelBreakdownRow({
  model,
  requests,
  cost,
  inputTokens,
  outputTokens,
  cacheCreationTokens,
  cacheReadTokens,
  currencyCode,
  totalCost,
  labels,
}: ModelBreakdownRowProps) {
  const [open, setOpen] = useState(false);
  const l = useLabels(labels);

  const totalAllTokens = inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
  const totalInputTokens = inputTokens + cacheCreationTokens + cacheReadTokens;
  const cacheHitRate =
    totalInputTokens > 0 ? ((cacheReadTokens / totalInputTokens) * 100).toFixed(1) : "0.0";
  const costPercentage = totalCost > 0 ? ((cost / totalCost) * 100).toFixed(1) : "0.0";

  const cacheHitRateNum = Number.parseFloat(cacheHitRate);
  const cacheHitColor =
    cacheHitRateNum >= 85
      ? "text-green-600 dark:text-green-400"
      : cacheHitRateNum >= 60
        ? "text-yellow-600 dark:text-yellow-400"
        : "text-orange-600 dark:text-orange-400";

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        className="flex items-center justify-between rounded-md border px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors group"
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <div className="flex flex-col text-sm min-w-0 gap-1">
          <span className="font-medium text-foreground truncate">{model || l.unknownModel}</span>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Activity className="h-3 w-3" />
              {requests.toLocaleString()}
            </span>
            <span className="flex items-center gap-1">
              <Hash className="h-3 w-3" />
              {formatTokenAmount(totalAllTokens)}
            </span>
            <span className={`flex items-center gap-1 ${cacheHitColor}`}>
              <Target className="h-3 w-3" />
              {cacheHitRate}%
            </span>
          </div>
        </div>
        <div className="text-right text-sm font-semibold text-foreground whitespace-nowrap ml-2">
          <div>{formatCurrency(cost, currencyCode)}</div>
          <div className="text-xs text-muted-foreground font-normal">({costPercentage}%)</div>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Database className="h-5 w-5 text-primary" />
              {model || l.unknownModel}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border bg-muted/50 p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Activity className="h-3.5 w-3.5" />
                  {l.modalRequests}
                </div>
                <div className="text-lg font-semibold font-mono">{requests.toLocaleString()}</div>
              </div>

              <div className="rounded-lg border bg-muted/50 p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Hash className="h-3.5 w-3.5" />
                  {l.modalTotalTokens}
                </div>
                <div className="text-lg font-semibold font-mono">
                  {formatTokenAmount(totalAllTokens)}
                </div>
              </div>

              <div className="rounded-lg border bg-muted/50 p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Coins className="h-3.5 w-3.5" />
                  {l.modalCost}
                </div>
                <div className="text-lg font-semibold font-mono">
                  {formatCurrency(cost, currencyCode)}
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-1.5">
                <Hash className="h-4 w-4 text-muted-foreground" />
                {l.modalTotalTokens}
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ArrowUpRight className="h-3.5 w-3.5 text-blue-500" />
                    {l.modalInputTokens}
                  </div>
                  <div className="text-base font-semibold font-mono">
                    {formatTokenAmount(inputTokens)}
                  </div>
                </div>

                <div className="rounded-lg border p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ArrowDownRight className="h-3.5 w-3.5 text-purple-500" />
                    {l.modalOutputTokens}
                  </div>
                  <div className="text-base font-semibold font-mono">
                    {formatTokenAmount(outputTokens)}
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-1.5">
                <Database className="h-4 w-4 text-muted-foreground" />
                {l.modalCacheTokens}
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Database className="h-3.5 w-3.5 text-orange-500" />
                    {l.modalCacheCreationTokens}
                  </div>
                  <div className="text-base font-semibold font-mono">
                    {formatTokenAmount(cacheCreationTokens)}
                  </div>
                </div>

                <div className="rounded-lg border p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Database className="h-3.5 w-3.5 text-green-500" />
                    {l.modalCacheReadTokens}
                  </div>
                  <div className="text-base font-semibold font-mono">
                    {formatTokenAmount(cacheReadTokens)}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border bg-gradient-to-r from-muted/50 to-muted/30 p-3 mt-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Target className="h-4 w-4" />
                    {l.modalCacheHitRate}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-lg font-bold font-mono ${cacheHitColor}`}>
                      {cacheHitRate}%
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        cacheHitRateNum >= 85
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : cacheHitRateNum >= 60
                            ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                            : "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                      }`}
                    >
                      <Percent className="h-3 w-3" />
                      {cacheHitRateNum >= 85
                        ? l.modalPerformanceHigh
                        : cacheHitRateNum >= 60
                          ? l.modalPerformanceMedium
                          : l.modalPerformanceLow}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
