"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Coins,
  Database,
  Hash,
  Target,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { CURRENCY_CONFIG, type CurrencyCode, formatCurrency } from "@/lib/utils/currency";

export interface ModelStat {
  model: string;
  callCount: number;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

function formatTokenAmount(tokens: number): string {
  if (tokens >= 1_000_000_000) {
    return `${(tokens / 1_000_000_000).toFixed(1)}B`;
  }
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toLocaleString();
}

export interface KeyStatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keyName: string;
  modelStats: ModelStat[];
  currencyCode?: string;
}

export function KeyStatsDialog({
  open,
  onOpenChange,
  keyName,
  modelStats,
  currencyCode,
}: KeyStatsDialogProps) {
  const t = useTranslations("dashboard.userManagement.keyStatsDialog");
  const tCommon = useTranslations("common");

  const resolvedCurrencyCode: CurrencyCode =
    currencyCode && currencyCode in CURRENCY_CONFIG ? (currencyCode as CurrencyCode) : "USD";

  const totalCalls = modelStats.reduce((sum, stat) => sum + stat.callCount, 0);
  const totalCost = modelStats.reduce((sum, stat) => sum + stat.totalCost, 0);
  const totalInput = modelStats.reduce((sum, stat) => sum + stat.inputTokens, 0);
  const totalOutput = modelStats.reduce((sum, stat) => sum + stat.outputTokens, 0);
  const totalCacheCreation = modelStats.reduce((sum, stat) => sum + stat.cacheCreationTokens, 0);
  const totalCacheRead = modelStats.reduce((sum, stat) => sum + stat.cacheReadTokens, 0);
  const totalTokens = totalInput + totalOutput + totalCacheCreation + totalCacheRead;

  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{keyName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {modelStats.length > 0 ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border bg-muted/50 p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Activity className="h-3.5 w-3.5" />
                    {t("modal.requests")}
                  </div>
                  <div className="text-lg font-semibold font-mono">
                    {totalCalls.toLocaleString()}
                  </div>
                </div>

                <div className="rounded-lg border bg-muted/50 p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Hash className="h-3.5 w-3.5" />
                    {t("modal.totalTokens")}
                  </div>
                  <div className="text-lg font-semibold font-mono">
                    {formatTokenAmount(totalTokens)}
                  </div>
                </div>

                <div className="rounded-lg border bg-muted/50 p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Coins className="h-3.5 w-3.5" />
                    {t("modal.cost")}
                  </div>
                  <div className="text-lg font-semibold font-mono">
                    {formatCurrency(totalCost, resolvedCurrencyCode)}
                  </div>
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border bg-muted/50 p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ArrowUpRight className="h-3.5 w-3.5 text-blue-500" />
                    {t("modal.inputTokens")}
                  </div>
                  <div className="text-base font-semibold font-mono">
                    {formatTokenAmount(totalInput)}
                  </div>
                </div>

                <div className="rounded-lg border bg-muted/50 p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ArrowDownRight className="h-3.5 w-3.5 text-purple-500" />
                    {t("modal.outputTokens")}
                  </div>
                  <div className="text-base font-semibold font-mono">
                    {formatTokenAmount(totalOutput)}
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-1.5">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  {t("modal.cacheTokens")}
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border bg-muted/50 p-3 space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Database className="h-3.5 w-3.5 text-orange-500" />
                      {t("modal.cacheWrite")}
                    </div>
                    <div className="text-base font-semibold font-mono">
                      {formatTokenAmount(totalCacheCreation)}
                    </div>
                  </div>

                  <div className="rounded-lg border bg-muted/50 p-3 space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Database className="h-3.5 w-3.5 text-green-500" />
                      {t("modal.cacheRead")}
                    </div>
                    <div className="text-base font-semibold font-mono">
                      {formatTokenAmount(totalCacheRead)}
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                {modelStats.map((stat) => {
                  const statTotalTokens =
                    stat.inputTokens +
                    stat.outputTokens +
                    stat.cacheCreationTokens +
                    stat.cacheReadTokens;
                  const statTotalInput =
                    stat.inputTokens + stat.cacheCreationTokens + stat.cacheReadTokens;
                  const statCacheHitRate =
                    statTotalInput > 0 ? (stat.cacheReadTokens / statTotalInput) * 100 : 0;
                  const statCacheHitColor =
                    statCacheHitRate >= 85
                      ? "text-green-600 dark:text-green-400"
                      : statCacheHitRate >= 60
                        ? "text-yellow-600 dark:text-yellow-400"
                        : "text-orange-600 dark:text-orange-400";
                  const costPercentage =
                    totalCost > 0 ? ((stat.totalCost / totalCost) * 100).toFixed(1) : "0.0";

                  return (
                    <div
                      key={stat.model}
                      className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex flex-col text-sm min-w-0 gap-1">
                        <span className="font-medium text-foreground truncate font-mono text-xs">
                          {stat.model}
                        </span>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Activity className="h-3 w-3" />
                            {stat.callCount.toLocaleString()}
                          </span>
                          <span className="flex items-center gap-1">
                            <Hash className="h-3 w-3" />
                            {formatTokenAmount(statTotalTokens)}
                          </span>
                          <span className={`flex items-center gap-1 ${statCacheHitColor}`}>
                            <Target className="h-3 w-3" />
                            {statCacheHitRate.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div className="text-right text-sm font-semibold text-foreground whitespace-nowrap ml-2">
                        <div>{formatCurrency(stat.totalCost, resolvedCurrencyCode)}</div>
                        <div className="text-xs text-muted-foreground font-normal">
                          ({costPercentage}%)
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">{t("noData")}</div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>
            {tCommon("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
