"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import type { MyTodayStats } from "@/actions/my-usage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

interface TodayUsageCardProps {
  stats: MyTodayStats | null;
  loading?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  autoRefreshSeconds?: number;
}

export function TodayUsageCard({
  stats,
  loading = false,
  refreshing = false,
  onRefresh,
  autoRefreshSeconds = 30,
}: TodayUsageCardProps) {
  const t = useTranslations("myUsage.today");
  const tCommon = useTranslations("common");
  const isInitialLoading = loading && !stats;
  const isButtonLoading = loading || refreshing;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base font-semibold">{t("title")}</CardTitle>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t("autoRefresh", { seconds: autoRefreshSeconds })}</span>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-2"
            onClick={onRefresh}
            disabled={isButtonLoading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isButtonLoading ? "animate-spin" : ""}`} />
            {t("refresh")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isInitialLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="rounded-lg border bg-card/50 px-3 py-2 space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-5 w-20" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label={t("calls")} value={stats?.calls ?? 0} />
            <Metric label={t("tokensIn")} value={stats?.inputTokens ?? 0} />
            <Metric label={t("tokensOut")} value={stats?.outputTokens ?? 0} />
            <Metric
              label={t("cost", { currency: stats?.currencyCode ?? "USD" })}
              value={Number(stats?.costUsd ?? 0).toFixed(4)}
            />
          </div>
        )}

        <Separator />

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">{t("modelBreakdown")}</p>
          {isInitialLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="rounded-md border px-3 py-2 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
              ))}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>{tCommon("loading")}</span>
              </div>
            </div>
          ) : stats && stats.modelBreakdown.length > 0 ? (
            <div className="space-y-2">
              {stats.modelBreakdown.map((item) => (
                <div
                  key={`${item.model ?? "unknown"}-${item.billingModel ?? "billing"}`}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div className="flex flex-col text-sm">
                    <span className="font-medium text-foreground">
                      {item.model || t("unknownModel")}
                    </span>
                    {item.billingModel && item.billingModel !== item.model ? (
                      <span className="text-xs text-muted-foreground">
                        {t("billingModel", { model: item.billingModel })}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-right text-xs text-muted-foreground space-y-0.5">
                    <div>{t("callsShort", { count: item.calls })}</div>
                    <div>{t("tokensShort", { in: item.inputTokens, out: item.outputTokens })}</div>
                    <div className="font-semibold text-foreground">
                      {`${stats.currencyCode || "USD"} ${Number(item.costUsd ?? 0).toFixed(4)}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("noData")}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border bg-card/50 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold leading-tight">{value}</p>
    </div>
  );
}
