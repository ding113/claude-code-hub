"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { getUserInsightsModelBreakdown } from "@/actions/admin-user-insights";
import {
  ModelBreakdownColumn,
  type ModelBreakdownItem,
  type ModelBreakdownLabels,
} from "@/components/analytics/model-breakdown-column";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { CurrencyCode } from "@/lib/utils/currency";

interface UserModelBreakdownProps {
  userId: number;
}

export function UserModelBreakdown({ userId }: UserModelBreakdownProps) {
  const t = useTranslations("dashboard.leaderboard.userInsights");
  const tCommon = useTranslations("common");
  const tStats = useTranslations("myUsage.stats");

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [appliedRange, setAppliedRange] = useState<{
    start?: string;
    end?: string;
  }>({});

  const { data, isLoading } = useQuery({
    queryKey: ["user-insights-model-breakdown", userId, appliedRange.start, appliedRange.end],
    queryFn: async () => {
      const result = await getUserInsightsModelBreakdown(
        userId,
        appliedRange.start || undefined,
        appliedRange.end || undefined
      );
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
  });

  const handleApplyRange = () => {
    setAppliedRange({ start: startDate || undefined, end: endDate || undefined });
  };

  const handleClearRange = () => {
    setStartDate("");
    setEndDate("");
    setAppliedRange({});
  };

  const labels: ModelBreakdownLabels = {
    unknownModel: t("unknownModel"),
    modal: {
      requests: tStats("modal.requests"),
      cost: tStats("modal.cost"),
      inputTokens: tStats("modal.inputTokens"),
      outputTokens: tStats("modal.outputTokens"),
      cacheCreationTokens: tStats("modal.cacheWrite"),
      cacheReadTokens: tStats("modal.cacheRead"),
      totalTokens: tStats("modal.totalTokens"),
      costPercentage: tStats("modal.cost"),
      cacheHitRate: tStats("modal.cacheHitRate"),
      cacheTokens: tStats("modal.cacheTokens"),
      performanceHigh: tStats("modal.performanceHigh"),
      performanceMedium: tStats("modal.performanceMedium"),
      performanceLow: tStats("modal.performanceLow"),
    },
  };

  const items: ModelBreakdownItem[] = data
    ? data.breakdown.map((item) => ({
        model: item.model,
        requests: item.requests,
        cost: item.cost,
        inputTokens: item.inputTokens,
        outputTokens: item.outputTokens,
        cacheCreationTokens: item.cacheCreationTokens,
        cacheReadTokens: item.cacheReadTokens,
      }))
    : [];

  const totalCost = items.reduce((sum, item) => sum + item.cost, 0);
  const currencyCode = (data?.currencyCode ?? "USD") as CurrencyCode;

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          {t("modelBreakdown")}
        </CardTitle>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">{t("dateRange")}:</span>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-7 w-[130px] text-xs"
          />
          <span className="text-xs text-muted-foreground">-</span>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-7 w-[130px] text-xs"
          />
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleApplyRange}>
            {tCommon("ok")}
          </Button>
          {(appliedRange.start || appliedRange.end) && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleClearRange}>
              {t("allTime")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center h-[120px] text-muted-foreground">
            {t("noData")}
          </div>
        ) : (
          <div data-testid="user-insights-model-breakdown-list">
            <ModelBreakdownColumn
              pageItems={items}
              currencyCode={currencyCode}
              totalCost={totalCost}
              keyPrefix="user-insights"
              pageOffset={0}
              labels={labels}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
