"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Activity, Clock, DollarSign, TrendingUp } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { getActiveSessions } from "@/actions/active-sessions";
import type { OverviewData } from "@/actions/overview";
import { getOverviewData } from "@/actions/overview";
import { getUserStatistics } from "@/actions/statistics";
import type { CurrencyCode } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/currency";
import type {
  LeaderboardEntry,
  ModelLeaderboardEntry,
  ProviderLeaderboardEntry,
} from "@/repository/leaderboard";
import type { ActiveSessionInfo } from "@/types/session";
import type { TimeRange, UserStatisticsData } from "@/types/statistics";
import { DEFAULT_TIME_RANGE } from "@/types/statistics";
import { BentoGrid } from "./bento-grid";
import { LeaderboardCard } from "./leaderboard-card";
import { LiveSessionsPanel } from "./live-sessions-panel";
import { BentoMetricCard } from "./metric-card";

const StatisticsChartCard = dynamic(
  () => import("./statistics-chart-card").then((mod) => ({ default: mod.StatisticsChartCard })),
  { ssr: false }
);

const REFRESH_INTERVAL = 5000;

interface DashboardBentoProps {
  isAdmin: boolean;
  currencyCode: CurrencyCode;
  allowGlobalUsageView: boolean;
  initialStatistics?: UserStatisticsData;
  initialOverview?: OverviewData;
}

interface LeaderboardData {
  id: string | number;
  name: string;
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
}

async function fetchOverviewData(): Promise<OverviewData> {
  const result = await getOverviewData();
  if (!result.ok) throw new Error(result.error || "Failed to fetch overview");
  return result.data;
}

async function fetchActiveSessions(): Promise<ActiveSessionInfo[]> {
  const result = await getActiveSessions();
  if (!result.ok) throw new Error(result.error || "Failed to fetch sessions");
  return result.data;
}

async function fetchStatistics(timeRange: TimeRange): Promise<UserStatisticsData> {
  const result = await getUserStatistics(timeRange);
  if (!result.ok) throw new Error(result.error || "Failed to fetch statistics");
  return result.data;
}

async function fetchLeaderboard(scope: "user" | "provider" | "model"): Promise<LeaderboardData[]> {
  const res = await fetch(`/api/leaderboard?period=daily&scope=${scope}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch leaderboard");
  const data = await res.json();

  if (scope === "user") {
    return (data as LeaderboardEntry[]).map((item) => ({
      id: `user-${item.userId}`,
      name: item.userName ?? "",
      totalRequests: item.totalRequests ?? 0,
      totalTokens: item.totalTokens ?? 0,
      totalCost: item.totalCost ?? 0,
    }));
  }
  if (scope === "provider") {
    return (data as ProviderLeaderboardEntry[]).map((item) => ({
      id: `provider-${item.providerId}`,
      name: item.providerName ?? "",
      totalRequests: item.totalRequests ?? 0,
      totalTokens: item.totalTokens ?? 0,
      totalCost: item.totalCost ?? 0,
    }));
  }
  return (data as ModelLeaderboardEntry[]).map((item) => ({
    id: `model-${item.model}`,
    name: item.model ?? "",
    totalRequests: item.totalRequests ?? 0,
    totalTokens: item.totalTokens ?? 0,
    totalCost: item.totalCost ?? 0,
  }));
}

/**
 * Calculate percentage change between current and previous values
 */
function formatResponseTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function calcPercentageChange(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return Math.round(((current - previous) / previous) * 100);
}

export function DashboardBento({
  isAdmin,
  currencyCode,
  allowGlobalUsageView,
  initialStatistics,
  initialOverview,
}: DashboardBentoProps) {
  const t = useTranslations("customs");
  const tl = useTranslations("dashboard.leaderboard");

  const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);

  // Overview metrics (available to all users, but shows different data based on permissions)
  const { data: overview } = useQuery<OverviewData>({
    queryKey: ["overview-data"],
    queryFn: fetchOverviewData,
    refetchInterval: 15_000,
    staleTime: 10_000,
    initialData: initialOverview,
  });

  // Active sessions
  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<ActiveSessionInfo[]>({
    queryKey: ["active-sessions"],
    queryFn: fetchActiveSessions,
    refetchInterval: REFRESH_INTERVAL,
    enabled: isAdmin,
  });

  // Statistics
  const { data: statistics } = useQuery<UserStatisticsData>({
    queryKey: ["statistics", timeRange],
    queryFn: () => fetchStatistics(timeRange),
    initialData: timeRange === DEFAULT_TIME_RANGE ? initialStatistics : undefined,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: 3,
  });

  // Leaderboards
  const { data: userLeaderboard = [], isLoading: userLeaderboardLoading } = useQuery<
    LeaderboardData[]
  >({
    queryKey: ["leaderboard", "user"],
    queryFn: () => fetchLeaderboard("user"),
    enabled: isAdmin || allowGlobalUsageView,
    staleTime: 60_000,
  });

  const { data: providerLeaderboard = [], isLoading: providerLeaderboardLoading } = useQuery<
    LeaderboardData[]
  >({
    queryKey: ["leaderboard", "provider"],
    queryFn: () => fetchLeaderboard("provider"),
    enabled: isAdmin || allowGlobalUsageView,
    staleTime: 60_000,
  });

  const { data: modelLeaderboard = [], isLoading: modelLeaderboardLoading } = useQuery<
    LeaderboardData[]
  >({
    queryKey: ["leaderboard", "model"],
    queryFn: () => fetchLeaderboard("model"),
    enabled: isAdmin || allowGlobalUsageView,
    staleTime: 60_000,
  });

  const metrics = overview || {
    concurrentSessions: 0,
    todayRequests: 0,
    todayCost: 0,
    avgResponseTime: 0,
    todayErrorRate: 0,
    yesterdaySamePeriodRequests: 0,
    yesterdaySamePeriodCost: 0,
    yesterdaySamePeriodAvgResponseTime: 0,
    recentMinuteRequests: 0,
  };

  // Calculate comparisons
  const requestsChange = calcPercentageChange(
    metrics.todayRequests,
    metrics.yesterdaySamePeriodRequests
  );
  const costChange = calcPercentageChange(metrics.todayCost, metrics.yesterdaySamePeriodCost);
  const responseTimeChange = calcPercentageChange(
    metrics.avgResponseTime,
    metrics.yesterdaySamePeriodAvgResponseTime
  );

  // Sessions with lastActivityAt for LiveSessionsPanel
  const sessionsWithActivity = useMemo(() => {
    return sessions.map((s) => ({
      ...s,
      lastActivityAt: s.startTime,
    }));
  }, [sessions]);

  const canViewLeaderboard = isAdmin || allowGlobalUsageView;

  return (
    <div className="space-y-6">
      {/* Section 1: Metrics (Admin only) */}
      {isAdmin && (
        <BentoGrid>
          <BentoMetricCard
            title={t("metrics.concurrent")}
            value={metrics.concurrentSessions}
            icon={Activity}
            accentColor="emerald"
            className="min-h-[120px]"
            comparisons={[
              {
                value: metrics.recentMinuteRequests,
                label: t("metrics.rpm"),
                isPercentage: false,
              },
            ]}
          />
          <BentoMetricCard
            title={t("metrics.todayRequests")}
            value={metrics.todayRequests}
            icon={TrendingUp}
            accentColor="blue"
            className="min-h-[120px]"
            comparisons={[{ value: requestsChange, label: t("metrics.vsYesterday") }]}
          />
          <BentoMetricCard
            title={t("metrics.todayCost")}
            value={formatCurrency(metrics.todayCost, currencyCode)}
            icon={DollarSign}
            accentColor="amber"
            className="min-h-[120px]"
            comparisons={[{ value: costChange, label: t("metrics.vsYesterday") }]}
          />
          <BentoMetricCard
            title={t("metrics.avgResponse")}
            value={metrics.avgResponseTime}
            icon={Clock}
            formatter={formatResponseTime}
            accentColor="purple"
            className="min-h-[120px]"
            comparisons={[{ value: -responseTimeChange, label: t("metrics.vsYesterday") }]}
          />
        </BentoGrid>
      )}

      {/* Section 2: Statistics Chart - Full width */}
      {statistics && (
        <StatisticsChartCard
          data={statistics}
          onTimeRangeChange={setTimeRange}
          currencyCode={currencyCode}
        />
      )}

      {/* Section 3: Leaderboards + Live Sessions */}
      {canViewLeaderboard && (
        <div
          data-testid={isAdmin ? "dashboard-home-layout" : undefined}
          className={cn(
            "grid gap-6",
            isAdmin
              ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_280px]"
              : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
          )}
        >
          <LeaderboardCard
            title={tl("userRankings")}
            entries={userLeaderboard}
            currencyCode={currencyCode}
            isLoading={userLeaderboardLoading}
            emptyText={tl("noData")}
            viewAllHref="/dashboard/leaderboard"
            maxItems={3}
            accentColor="primary"
          />
          <LeaderboardCard
            title={tl("providerRankings")}
            entries={providerLeaderboard}
            currencyCode={currencyCode}
            isLoading={providerLeaderboardLoading}
            emptyText={tl("noData")}
            viewAllHref="/dashboard/leaderboard"
            maxItems={3}
            accentColor="purple"
          />
          <LeaderboardCard
            title={tl("modelRankings")}
            entries={modelLeaderboard}
            currencyCode={currencyCode}
            isLoading={modelLeaderboardLoading}
            emptyText={tl("noData")}
            viewAllHref="/dashboard/leaderboard"
            maxItems={3}
            accentColor="blue"
          />

          {isAdmin && (
            <LiveSessionsPanel
              data-testid="dashboard-home-sidebar"
              sessions={sessionsWithActivity}
              isLoading={sessionsLoading}
            />
          )}
        </div>
      )}
    </div>
  );
}
