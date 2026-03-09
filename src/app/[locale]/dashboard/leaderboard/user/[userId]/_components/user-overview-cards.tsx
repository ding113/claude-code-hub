"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Clock, DollarSign, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { getUserInsightsOverview } from "@/actions/admin-user-insights";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { type CurrencyCode, formatCurrency } from "@/lib/utils";

interface UserOverviewCardsProps {
  userId: number;
}

function formatResponseTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function UserOverviewCards({ userId }: UserOverviewCardsProps) {
  const t = useTranslations("dashboard.leaderboard.userInsights");

  const { data, isLoading } = useQuery({
    queryKey: ["user-insights-overview", userId],
    queryFn: async () => {
      const result = await getUserInsightsOverview(userId);
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

  if (!data) return null;

  const { overview, currencyCode } = data;
  const cc = currencyCode as CurrencyCode;

  const metrics = [
    {
      key: "todayRequests",
      label: t("todayRequests"),
      value: overview.todayRequests.toLocaleString(),
      icon: TrendingUp,
    },
    {
      key: "todayCost",
      label: t("todayCost"),
      value: formatCurrency(overview.todayCost, cc),
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
      value: `${overview.todayErrorRate.toFixed(1)}%`,
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
