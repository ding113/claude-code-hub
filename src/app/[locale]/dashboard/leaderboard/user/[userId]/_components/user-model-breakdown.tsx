"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, BarChart3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { getUserInsightsModelBreakdown } from "@/actions/admin-user-insights";
import {
  ModelBreakdownColumn,
  type ModelBreakdownItem,
  type ModelBreakdownLabels,
} from "@/components/analytics/model-breakdown-column";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { CurrencyCode } from "@/lib/utils/currency";

interface UserModelBreakdownProps {
  userId: number;
  startDate?: string;
  endDate?: string;
  keyId?: number;
  providerId?: number;
}

export function UserModelBreakdown({
  userId,
  startDate,
  endDate,
  keyId,
  providerId,
}: UserModelBreakdownProps) {
  const t = useTranslations("dashboard.leaderboard.userInsights");
  const tStats = useTranslations("myUsage.stats");

  const filters = keyId || providerId ? { keyId, providerId } : undefined;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["user-insights-model-breakdown", userId, startDate, endDate, keyId, providerId],
    queryFn: async () => {
      const result = await getUserInsightsModelBreakdown(userId, startDate, endDate, filters);
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
  });

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
      <CardHeader className="flex flex-row items-center gap-2">
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
        <CardTitle className="text-base font-semibold">{t("modelBreakdown")}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center h-[120px] text-destructive">
            <AlertCircle className="h-4 w-4 mr-2" />
            {t("loadError")}
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
