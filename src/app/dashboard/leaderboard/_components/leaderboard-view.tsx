"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { LeaderboardTable, type ColumnDef } from "./leaderboard-table";
import type { LeaderboardEntry, ProviderLeaderboardEntry } from "@/repository/leaderboard";
import { formatTokenAmount } from "@/lib/utils";

interface LeaderboardViewProps {
  isAdmin: boolean;
}

type UserEntry = LeaderboardEntry & { totalCostFormatted?: string };
type ProviderEntry = ProviderLeaderboardEntry & { totalCostFormatted?: string };

export function LeaderboardView({ isAdmin }: LeaderboardViewProps) {
  const [scope, setScope] = useState<"user" | "provider">("user");
  const [period, setPeriod] = useState<"daily" | "monthly">("daily");
  const [dailyData, setDailyData] = useState<Array<UserEntry | ProviderEntry>>([]);
  const [monthlyData, setMonthlyData] = useState<Array<UserEntry | ProviderEntry>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          throw new Error("获取排行榜数据失败");
        }

        const [daily, monthly] = await Promise.all([dailyRes.json(), monthlyRes.json()]);

        if (!cancelled) {
          setDailyData(daily);
          setMonthlyData(monthly);
          setError(null);
        }
      } catch (err) {
        console.error("获取排行榜数据失败:", err);
        if (!cancelled) setError(err instanceof Error ? err.message : "获取排行榜数据失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">加载中...</div>
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
      header: "用户",
      cell: (row, index) => (
        <span className={index < 3 ? "font-semibold" : ""}>{(row as UserEntry).userName}</span>
      ),
    },
    {
      header: "请求数",
      className: "text-right",
      cell: (row) => (row as UserEntry).totalRequests.toLocaleString(),
    },
    {
      header: "Token 数",
      className: "text-right",
      cell: (row) => formatTokenAmount((row as UserEntry).totalTokens),
    },
    {
      header: "消耗金额",
      className: "text-right font-mono font-semibold",
      cell: (row) => {
        const r = row as UserEntry & { totalCostFormatted?: string };
        return r.totalCostFormatted ?? r.totalCost;
      },
    },
  ];

  const providerColumns: ColumnDef<ProviderEntry>[] = [
    {
      header: "供应商",
      cell: (row, index) => (
        <span className={index < 3 ? "font-semibold" : ""}>{(row as ProviderEntry).providerName}</span>
      ),
    },
    {
      header: "请求数",
      className: "text-right",
      cell: (row) => (row as ProviderEntry).totalRequests.toLocaleString(),
    },
    {
      header: "成本",
      className: "text-right font-mono font-semibold",
      cell: (row) => {
        const r = row as ProviderEntry & { totalCostFormatted?: string };
        return r.totalCostFormatted ?? r.totalCost;
      },
    },
    {
      header: "Token 数",
      className: "text-right",
      cell: (row) => formatTokenAmount((row as ProviderEntry).totalTokens),
    },
    {
      header: "成功率",
      className: "text-right",
      cell: (row) => `${(((row as ProviderEntry).successRate || 0) * 100).toFixed(1)}%`,
    },
    {
      header: "平均响应时间",
      className: "text-right",
      cell: (row) => `${Math.round((row as ProviderEntry).avgResponseTime || 0).toLocaleString()} ms`,
    },
  ];

  const columns = (scope === "user"
    ? (userColumns as ColumnDef<UserEntry>[])
    : (providerColumns as ColumnDef<ProviderEntry>[])) as ColumnDef<UserEntry | ProviderEntry>[];
  const rowKey = (row: UserEntry | ProviderEntry) =>
    scope === "user" ? (row as UserEntry).userId : (row as ProviderEntry).providerId;

  const displayData = period === "daily" ? dailyData : monthlyData;

  return (
    <div className="w-full">
      {/* 单行双 toggle：scope + period */}
      <div className="flex flex-wrap gap-4 items-center">
        <Tabs value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
          <TabsList className={isAdmin ? "grid grid-cols-2" : ""}>
            <TabsTrigger value="user">用户排行</TabsTrigger>
            {isAdmin && <TabsTrigger value="provider">供应商排行</TabsTrigger>}
          </TabsList>
        </Tabs>

        <Tabs value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
          <TabsList className="grid grid-cols-2">
            <TabsTrigger value="daily">今日排行</TabsTrigger>
            <TabsTrigger value="monthly">本月排行</TabsTrigger>
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
