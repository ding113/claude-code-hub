"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, AlertCircle, Clock, DollarSign, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getUserInsightsOverview } from "@/lib/api-client/v1/actions/admin-user-insights";
import { type CurrencyCode, formatCurrency } from "@/lib/utils";

interface UserOverviewCardsProps {
  userId: number;
  startDate?: string;
  endDate?: string;
}

function formatResponseTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function UserOverviewCards({ userId, startDate, endDate }: UserOverviewCardsProps) {
  const t = useTranslations("dashboard.leaderboard.userInsights");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["user-insights-overview", userId, startDate, endDate],
    queryFn: async () => {
      const result = await getUserInsightsOverview(userId, startDate, endDate);
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="h-4 w-24 mb-3" />
              <Skeleton className="h-8 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center text-destructive">
            <AlertCircle className="h-4 w-4 mr-2" />
            {t("loadError")}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { overview, currencyCode } = data;
  const cc = currencyCode as CurrencyCode;

  const metrics = [
    {
      key: "requestCount",
      label: t("requests"),
      value: overview.requestCount.toLocaleString(),
      icon: TrendingUp,
    },
    {
      key: "cost",
      label: t("cost"),
      value: formatCurrency(overview.totalCost, cc),
      icon: DollarSign,
    },
    {
      key: "avgResponseTime",
      label: t("avgResponseTime"),
      value: formatResponseTime(overview.avgResponseTime),
      icon: Clock,
    },
    {
      key: "errorRate",
      label: t("errorRate"),
      value: `${overview.errorRate.toFixed(1)}%`,
      icon: Activity,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {metrics.map((metric) => (
        <Card key={metric.key} data-testid={`user-insights-metric-${metric.key}`}>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <metric.icon className="h-4 w-4" />
              {metric.label}
            </div>
            <div className="text-2xl font-bold">{metric.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
