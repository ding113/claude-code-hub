"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { LeaderboardTable, type ColumnDef } from "./leaderboard-table";
import type { LeaderboardEntry, ProviderLeaderboardEntry } from "@/repository/leaderboard";
import { formatTokenAmount } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";

interface LeaderboardViewProps {
  isAdmin: boolean;
}

type UserEntry = LeaderboardEntry & { totalCostFormatted?: string };
type ProviderEntry = ProviderLeaderboardEntry & { totalCostFormatted?: string };

export function LeaderboardView({ isAdmin }: LeaderboardViewProps) {
  const t = useTranslations("dashboard.leaderboard");
  const searchParams = useSearchParams();

  const initialScope = searchParams.get("scope") === "provider" && isAdmin ? "provider" : "user";
  const initialPeriod = searchParams.get("period") === "monthly" ? "monthly" : "daily";

  const [scope, setScope] = useState<"user" | "provider">(initialScope);
  const [period, setPeriod] = useState<"daily" | "monthly">(initialPeriod);
  const [dailyData, setDailyData] = useState<Array<UserEntry | ProviderEntry>>([]);
  const [monthlyData, setMonthlyData] = useState<Array<UserEntry | ProviderEntry>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 与 URL 查询参数保持同步，支持外部携带 scope/period 直达特定榜单
  useEffect(() => {
    const urlScope = searchParams.get("scope");
    const normalizedScope = urlScope === "provider" && isAdmin ? "provider" : "user";

    if (normalizedScope !== scope) {
      setScope(normalizedScope);
    }

    const urlPeriod = searchParams.get("period");
    const normalizedPeriod = urlPeriod === "monthly" ? "monthly" : "daily";

    if (normalizedPeriod !== period) {
      setPeriod(normalizedPeriod);
    }
    // 移除 scope 和 period 从依赖数组，避免无限循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, searchParams]);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        setLoading(true);
        const [dailyRes, monthlyRes] = await Promise.all([
          fetch(`/api/leaderboard?period=daily&scope=${scope}`),
          fetch(`/api/leaderboard?period=monthly&scope=${scope}`),
        ]);

        if (!dailyRes.ok || !monthlyRes.ok) {
          throw new Error(t("states.fetchFailed"));
        }

        const [daily, monthly] = await Promise.all([dailyRes.json(), monthlyRes.json()]);

        if (!cancelled) {
          setDailyData(daily);
          setMonthlyData(monthly);
          setError(null);
        }
      } catch (err) {
        console.error(t("states.fetchFailed"), err);
        if (!cancelled) setError(err instanceof Error ? err.message : t("states.fetchFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [scope, t]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">{t("states.loading")}</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-destructive">{error}</div>
        </CardContent>
      </Card>
    );
  }

  // 列定义（根据 scope 动态切换）
  const userColumns: ColumnDef<UserEntry>[] = [
    {
      header: t("columns.user"),
      cell: (row, index) => (
        <span className={index < 3 ? "font-semibold" : ""}>{(row as UserEntry).userName}</span>
      ),
    },
    {
      header: t("columns.requests"),
      className: "text-right",
      cell: (row) => (row as UserEntry).totalRequests.toLocaleString(),
    },
    {
      header: t("columns.tokens"),
      className: "text-right",
      cell: (row) => formatTokenAmount((row as UserEntry).totalTokens),
    },
    {
      header: t("columns.consumedAmount"),
      className: "text-right font-mono font-semibold",
      cell: (row) => {
        const r = row as UserEntry & { totalCostFormatted?: string };
        return r.totalCostFormatted ?? r.totalCost;
      },
    },
  ];

  const providerColumns: ColumnDef<ProviderEntry>[] = [
    {
      header: t("columns.provider"),
      cell: (row, index) => (
        <span className={index < 3 ? "font-semibold" : ""}>
          {(row as ProviderEntry).providerName}
        </span>
      ),
    },
    {
      header: t("columns.requests"),
      className: "text-right",
      cell: (row) => (row as ProviderEntry).totalRequests.toLocaleString(),
    },
    {
      header: t("columns.cost"),
      className: "text-right font-mono font-semibold",
      cell: (row) => {
        const r = row as ProviderEntry & { totalCostFormatted?: string };
        return r.totalCostFormatted ?? r.totalCost;
      },
    },
    {
      header: t("columns.tokens"),
      className: "text-right",
      cell: (row) => formatTokenAmount((row as ProviderEntry).totalTokens),
    },
    {
      header: t("columns.successRate"),
      className: "text-right",
      cell: (row) => `${(((row as ProviderEntry).successRate || 0) * 100).toFixed(1)}%`,
    },
    {
      header: t("columns.avgResponseTime"),
      className: "text-right",
      cell: (row) =>
        `${Math.round((row as ProviderEntry).avgResponseTime || 0).toLocaleString()} ms`,
    },
  ];

  const columns = (
    scope === "user"
      ? (userColumns as ColumnDef<UserEntry>[])
      : (providerColumns as ColumnDef<ProviderEntry>[])
  ) as ColumnDef<UserEntry | ProviderEntry>[];
  const rowKey = (row: UserEntry | ProviderEntry) =>
    scope === "user" ? (row as UserEntry).userId : (row as ProviderEntry).providerId;

  const displayData = period === "daily" ? dailyData : monthlyData;

  return (
    <div className="w-full">
      {/* 单行双 toggle：scope + period */}
      <div className="flex flex-wrap gap-4 items-center">
        <Tabs value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
          <TabsList className={isAdmin ? "grid grid-cols-2" : ""}>
            <TabsTrigger value="user">{t("tabs.userRanking")}</TabsTrigger>
            {isAdmin && <TabsTrigger value="provider">{t("tabs.providerRanking")}</TabsTrigger>}
          </TabsList>
        </Tabs>

        <Tabs value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
          <TabsList className="grid grid-cols-2">
            <TabsTrigger value="daily">{t("tabs.dailyRanking")}</TabsTrigger>
            <TabsTrigger value="monthly">{t("tabs.monthlyRanking")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* 数据表格 */}
      <div className="mt-6">
        <LeaderboardTable data={displayData} period={period} columns={columns} getRowKey={rowKey} />
      </div>
    </div>
  );
}
