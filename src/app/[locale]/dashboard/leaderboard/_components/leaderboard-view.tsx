"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatTokenAmount } from "@/lib/utils";
import type {
  LeaderboardEntry,
  LeaderboardPeriod,
  ModelLeaderboardEntry,
  ProviderLeaderboardEntry,
} from "@/repository/leaderboard";
import { type ColumnDef, LeaderboardTable } from "./leaderboard-table";

interface LeaderboardViewProps {
  isAdmin: boolean;
}

type LeaderboardScope = "user" | "provider" | "model";
type UserEntry = LeaderboardEntry & { totalCostFormatted?: string };
type ProviderEntry = ProviderLeaderboardEntry & { totalCostFormatted?: string };
type ModelEntry = ModelLeaderboardEntry & { totalCostFormatted?: string };
type AnyEntry = UserEntry | ProviderEntry | ModelEntry;
type PeriodData = Record<LeaderboardPeriod, AnyEntry[]>;

const VALID_PERIODS: LeaderboardPeriod[] = ["daily", "weekly", "monthly", "allTime"];

export function LeaderboardView({ isAdmin }: LeaderboardViewProps) {
  const t = useTranslations("dashboard.leaderboard");
  const searchParams = useSearchParams();

  const urlScope = searchParams.get("scope") as LeaderboardScope | null;
  const initialScope: LeaderboardScope =
    (urlScope === "provider" || urlScope === "model") && isAdmin ? urlScope : "user";
  const urlPeriod = searchParams.get("period") as LeaderboardPeriod | null;
  const initialPeriod: LeaderboardPeriod =
    urlPeriod && VALID_PERIODS.includes(urlPeriod) ? urlPeriod : "daily";

  const [scope, setScope] = useState<LeaderboardScope>(initialScope);
  const [period, setPeriod] = useState<LeaderboardPeriod>(initialPeriod);
  const [periodData, setPeriodData] = useState<PeriodData>({
    daily: [],
    weekly: [],
    monthly: [],
    allTime: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 与 URL 查询参数保持同步，支持外部携带 scope/period 直达特定榜单
  useEffect(() => {
    const urlScopeParam = searchParams.get("scope") as LeaderboardScope | null;
    const normalizedScope: LeaderboardScope =
      (urlScopeParam === "provider" || urlScopeParam === "model") && isAdmin ? urlScopeParam : "user";

    if (normalizedScope !== scope) {
      setScope(normalizedScope);
    }

    const urlP = searchParams.get("period") as LeaderboardPeriod | null;
    const normalizedPeriod: LeaderboardPeriod =
      urlP && VALID_PERIODS.includes(urlP) ? urlP : "daily";

    if (normalizedPeriod !== period) {
      setPeriod(normalizedPeriod);
    }
    // 移除 scope 和 period 从依赖数组，避免无限循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, searchParams, period, scope]);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        setLoading(true);
        const [dailyRes, weeklyRes, monthlyRes, allTimeRes] = await Promise.all([
          fetch(`/api/leaderboard?period=daily&scope=${scope}`),
          fetch(`/api/leaderboard?period=weekly&scope=${scope}`),
          fetch(`/api/leaderboard?period=monthly&scope=${scope}`),
          fetch(`/api/leaderboard?period=allTime&scope=${scope}`),
        ]);

        if (!dailyRes.ok || !weeklyRes.ok || !monthlyRes.ok || !allTimeRes.ok) {
          throw new Error(t("states.fetchFailed"));
        }

        const [daily, weekly, monthly, allTime] = await Promise.all([
          dailyRes.json(),
          weeklyRes.json(),
          monthlyRes.json(),
          allTimeRes.json(),
        ]);

        if (!cancelled) {
          setPeriodData({ daily, weekly, monthly, allTime });
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

  const modelColumns: ColumnDef<ModelEntry>[] = [
    {
      header: t("columns.model"),
      cell: (row, index) => (
        <span className={index < 3 ? "font-semibold font-mono text-sm" : "font-mono text-sm"}>
          {(row as ModelEntry).model}
        </span>
      ),
    },
    {
      header: t("columns.requests"),
      className: "text-right",
      cell: (row) => (row as ModelEntry).totalRequests.toLocaleString(),
    },
    {
      header: t("columns.tokens"),
      className: "text-right",
      cell: (row) => formatTokenAmount((row as ModelEntry).totalTokens),
    },
    {
      header: t("columns.cost"),
      className: "text-right font-mono font-semibold",
      cell: (row) => {
        const r = row as ModelEntry & { totalCostFormatted?: string };
        return r.totalCostFormatted ?? r.totalCost;
      },
    },
    {
      header: t("columns.successRate"),
      className: "text-right",
      cell: (row) => `${(((row as ModelEntry).successRate || 0) * 100).toFixed(1)}%`,
    },
  ];

  const columns = (() => {
    switch (scope) {
      case "user":
        return userColumns as ColumnDef<AnyEntry>[];
      case "provider":
        return providerColumns as ColumnDef<AnyEntry>[];
      case "model":
        return modelColumns as ColumnDef<AnyEntry>[];
    }
  })();

  const rowKey = (row: AnyEntry) => {
    switch (scope) {
      case "user":
        return (row as UserEntry).userId;
      case "provider":
        return (row as ProviderEntry).providerId;
      case "model":
        return (row as ModelEntry).model;
    }
  };

  const displayData = periodData[period];

  return (
    <div className="w-full">
      {/* 单行双 toggle：scope + period */}
      <div className="flex flex-wrap gap-4 items-center">
        <Tabs value={scope} onValueChange={(v) => setScope(v as LeaderboardScope)}>
          <TabsList className={isAdmin ? "grid grid-cols-3" : ""}>
            <TabsTrigger value="user">{t("tabs.userRanking")}</TabsTrigger>
            {isAdmin && <TabsTrigger value="provider">{t("tabs.providerRanking")}</TabsTrigger>}
            {isAdmin && <TabsTrigger value="model">{t("tabs.modelRanking")}</TabsTrigger>}
          </TabsList>
        </Tabs>

        <Tabs value={period} onValueChange={(v) => setPeriod(v as LeaderboardPeriod)}>
          <TabsList className="grid grid-cols-4">
            <TabsTrigger value="daily">{t("tabs.dailyRanking")}</TabsTrigger>
            <TabsTrigger value="weekly">{t("tabs.weeklyRanking")}</TabsTrigger>
            <TabsTrigger value="monthly">{t("tabs.monthlyRanking")}</TabsTrigger>
            <TabsTrigger value="allTime">{t("tabs.allTimeRanking")}</TabsTrigger>
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
