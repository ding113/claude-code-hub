"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatTokenAmount } from "@/lib/utils";
import type {
  DateRangeParams,
  LeaderboardEntry,
  LeaderboardPeriod,
  ModelLeaderboardEntry,
  ProviderLeaderboardEntry,
} from "@/repository/leaderboard";
import { DateRangePicker } from "./date-range-picker";
import { type ColumnDef, LeaderboardTable } from "./leaderboard-table";

interface LeaderboardViewProps {
  isAdmin: boolean;
}

type LeaderboardScope = "user" | "provider" | "model";
type UserEntry = LeaderboardEntry & { totalCostFormatted?: string };
type ProviderEntry = ProviderLeaderboardEntry & { totalCostFormatted?: string };
type ModelEntry = ModelLeaderboardEntry & { totalCostFormatted?: string };
type AnyEntry = UserEntry | ProviderEntry | ModelEntry;

const VALID_PERIODS: LeaderboardPeriod[] = ["daily", "weekly", "monthly", "allTime", "custom"];

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
  const [dateRange, setDateRange] = useState<DateRangeParams | undefined>(undefined);
  const [data, setData] = useState<AnyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 与 URL 查询参数保持同步，支持外部携带 scope/period 直达特定榜单
  // biome-ignore lint/correctness/useExhaustiveDependencies: period 和 scope 仅用于比较，不应触发 effect 重新执行
  useEffect(() => {
    const urlScopeParam = searchParams.get("scope") as LeaderboardScope | null;
    const normalizedScope: LeaderboardScope =
      (urlScopeParam === "provider" || urlScopeParam === "model") && isAdmin
        ? urlScopeParam
        : "user";

    if (normalizedScope !== scope) {
      setScope(normalizedScope);
    }

    const urlP = searchParams.get("period") as LeaderboardPeriod | null;
    const normalizedPeriod: LeaderboardPeriod =
      urlP && VALID_PERIODS.includes(urlP) ? urlP : "daily";

    if (normalizedPeriod !== period) {
      setPeriod(normalizedPeriod);
    }
  }, [isAdmin, searchParams]);

  // Fetch data when period, scope, or dateRange changes
  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        setLoading(true);
        let url = `/api/leaderboard?period=${period}&scope=${scope}`;
        if (period === "custom" && dateRange) {
          url += `&startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`;
        }
        const res = await fetch(url);

        if (!res.ok) {
          throw new Error(t("states.fetchFailed"));
        }

        const result = await res.json();

        if (!cancelled) {
          setData(result);
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
  }, [scope, period, dateRange, t]);

  const handlePeriodChange = useCallback(
    (newPeriod: LeaderboardPeriod, newDateRange?: DateRangeParams) => {
      setPeriod(newPeriod);
      setDateRange(newDateRange);
    },
    []
  );

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

  return (
    <div className="w-full">
      {/* Scope toggle */}
      <div className="flex flex-wrap gap-4 items-center mb-4">
        <Tabs value={scope} onValueChange={(v) => setScope(v as LeaderboardScope)}>
          <TabsList className={isAdmin ? "grid grid-cols-3" : ""}>
            <TabsTrigger value="user">{t("tabs.userRanking")}</TabsTrigger>
            {isAdmin && <TabsTrigger value="provider">{t("tabs.providerRanking")}</TabsTrigger>}
            {isAdmin && <TabsTrigger value="model">{t("tabs.modelRanking")}</TabsTrigger>}
          </TabsList>
        </Tabs>
      </div>

      {/* Date range picker with quick period buttons */}
      <div className="mb-6">
        <DateRangePicker
          period={period}
          dateRange={dateRange}
          onPeriodChange={handlePeriodChange}
        />
      </div>

      {/* 数据表格 */}
      <div>
        <LeaderboardTable data={data} period={period} columns={columns} getRowKey={rowKey} />
      </div>
    </div>
  );
}
