"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { getAllUserKeyGroups, getAllUserTags } from "@/actions/users";
import { ProviderTypeFilter } from "@/app/[locale]/settings/providers/_components/provider-type-filter";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TagInput } from "@/components/ui/tag-input";
import { formatTokenAmount } from "@/lib/utils";
import type {
  DateRangeParams,
  LeaderboardEntry,
  LeaderboardPeriod,
  ModelLeaderboardEntry,
  ProviderCacheHitRateLeaderboardEntry,
  ProviderLeaderboardEntry,
} from "@/repository/leaderboard";
import type { ProviderType } from "@/types/provider";
import { DateRangePicker } from "./date-range-picker";
import { type ColumnDef, LeaderboardTable } from "./leaderboard-table";

interface LeaderboardViewProps {
  isAdmin: boolean;
}

type LeaderboardScope = "user" | "provider" | "providerCacheHitRate" | "model";
type UserEntry = LeaderboardEntry & { totalCostFormatted?: string };
type ProviderEntry = ProviderLeaderboardEntry & { totalCostFormatted?: string };
type ProviderCacheHitRateEntry = ProviderCacheHitRateLeaderboardEntry;
type ModelEntry = ModelLeaderboardEntry & { totalCostFormatted?: string };
type AnyEntry = UserEntry | ProviderEntry | ProviderCacheHitRateEntry | ModelEntry;

const VALID_PERIODS: LeaderboardPeriod[] = ["daily", "weekly", "monthly", "allTime", "custom"];

export function LeaderboardView({ isAdmin }: LeaderboardViewProps) {
  const t = useTranslations("dashboard.leaderboard");
  const searchParams = useSearchParams();

  const urlScope = searchParams.get("scope") as LeaderboardScope | null;
  const initialScope: LeaderboardScope =
    (urlScope === "provider" || urlScope === "providerCacheHitRate" || urlScope === "model") &&
    isAdmin
      ? urlScope
      : "user";
  const urlPeriod = searchParams.get("period") as LeaderboardPeriod | null;
  const initialPeriod: LeaderboardPeriod =
    urlPeriod && VALID_PERIODS.includes(urlPeriod) ? urlPeriod : "daily";

  const [scope, setScope] = useState<LeaderboardScope>(initialScope);
  const [period, setPeriod] = useState<LeaderboardPeriod>(initialPeriod);
  const [dateRange, setDateRange] = useState<DateRangeParams | undefined>(undefined);
  const [providerTypeFilter, setProviderTypeFilter] = useState<ProviderType | "all">("all");
  const [userTagFilters, setUserTagFilters] = useState<string[]>([]);
  const [userGroupFilters, setUserGroupFilters] = useState<string[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [groupSuggestions, setGroupSuggestions] = useState<string[]>([]);
  const [data, setData] = useState<AnyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;

    const fetchSuggestions = async () => {
      const [tagsResult, groupsResult] = await Promise.all([
        getAllUserTags(),
        getAllUserKeyGroups(),
      ]);
      if (tagsResult.ok) setTagSuggestions(tagsResult.data);
      if (groupsResult.ok) setGroupSuggestions(groupsResult.data);
    };

    fetchSuggestions();
  }, [isAdmin]);

  // 与 URL 查询参数保持同步，支持外部携带 scope/period 直达特定榜单
  // biome-ignore lint/correctness/useExhaustiveDependencies: period 和 scope 仅用于比较，不应触发 effect 重新执行
  useEffect(() => {
    const urlScopeParam = searchParams.get("scope") as LeaderboardScope | null;
    const normalizedScope: LeaderboardScope =
      (urlScopeParam === "provider" ||
        urlScopeParam === "providerCacheHitRate" ||
        urlScopeParam === "model") &&
      isAdmin
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
        if (
          (scope === "providerCacheHitRate" || scope === "provider") &&
          providerTypeFilter !== "all"
        ) {
          url += `&providerType=${encodeURIComponent(providerTypeFilter)}`;
        }
        if (scope === "user") {
          if (userTagFilters.length > 0) {
            url += `&userTags=${encodeURIComponent(userTagFilters.join(","))}`;
          }
          if (userGroupFilters.length > 0) {
            url += `&userGroups=${encodeURIComponent(userGroupFilters.join(","))}`;
          }
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
  }, [scope, period, dateRange, providerTypeFilter, userTagFilters, userGroupFilters, t]);

  const handlePeriodChange = useCallback(
    (newPeriod: LeaderboardPeriod, newDateRange?: DateRangeParams) => {
      setPeriod(newPeriod);
      setDateRange(newDateRange);
    },
    []
  );

  const skeletonColumns =
    scope === "user"
      ? 5
      : scope === "provider"
        ? 8
        : scope === "providerCacheHitRate"
          ? 8
          : scope === "model"
            ? 6
            : 5;
  const skeletonGridStyle = { gridTemplateColumns: `repeat(${skeletonColumns}, minmax(0, 1fr))` };

  // 列定义（根据 scope 动态切换）
  const userColumns: ColumnDef<UserEntry>[] = [
    {
      header: t("columns.user"),
      cell: (row) => (row as UserEntry).userName,
      sortKey: "userName",
      getValue: (row) => (row as UserEntry).userName,
    },
    {
      header: t("columns.requests"),
      className: "text-right",
      cell: (row) => (row as UserEntry).totalRequests.toLocaleString(),
      sortKey: "totalRequests",
      getValue: (row) => (row as UserEntry).totalRequests,
    },
    {
      header: t("columns.tokens"),
      className: "text-right",
      cell: (row) => formatTokenAmount((row as UserEntry).totalTokens),
      sortKey: "totalTokens",
      getValue: (row) => (row as UserEntry).totalTokens,
    },
    {
      header: t("columns.consumedAmount"),
      className: "text-right font-mono",
      cell: (row) => {
        const r = row as UserEntry & { totalCostFormatted?: string };
        return r.totalCostFormatted ?? r.totalCost;
      },
      sortKey: "totalCost",
      getValue: (row) => (row as UserEntry).totalCost,
      defaultBold: true,
    },
  ];

  const providerColumns: ColumnDef<ProviderEntry>[] = [
    {
      header: t("columns.provider"),
      cell: (row) => (row as ProviderEntry).providerName,
      sortKey: "providerName",
      getValue: (row) => (row as ProviderEntry).providerName,
    },
    {
      header: t("columns.requests"),
      className: "text-right",
      cell: (row) => (row as ProviderEntry).totalRequests.toLocaleString(),
      sortKey: "totalRequests",
      getValue: (row) => (row as ProviderEntry).totalRequests,
    },
    {
      header: t("columns.cost"),
      className: "text-right font-mono",
      cell: (row) => {
        const r = row as ProviderEntry & { totalCostFormatted?: string };
        return r.totalCostFormatted ?? r.totalCost;
      },
      sortKey: "totalCost",
      getValue: (row) => (row as ProviderEntry).totalCost,
      defaultBold: true,
    },
    {
      header: t("columns.tokens"),
      className: "text-right",
      cell: (row) => formatTokenAmount((row as ProviderEntry).totalTokens),
      sortKey: "totalTokens",
      getValue: (row) => (row as ProviderEntry).totalTokens,
    },
    {
      header: t("columns.successRate"),
      className: "text-right",
      cell: (row) => `${(Number((row as ProviderEntry).successRate || 0) * 100).toFixed(1)}%`,
      sortKey: "successRate",
      getValue: (row) => (row as ProviderEntry).successRate,
    },
    {
      header: t("columns.avgTtfbMs"),
      className: "text-right",
      cell: (row) => {
        const val = (row as ProviderEntry).avgTtfbMs;
        return val && val > 0 ? `${Math.round(val).toLocaleString()} ms` : "-";
      },
      sortKey: "avgTtfbMs",
      getValue: (row) => (row as ProviderEntry).avgTtfbMs ?? 0,
    },
    {
      header: t("columns.avgTokensPerSecond"),
      className: "text-right",
      cell: (row) => {
        const val = (row as ProviderEntry).avgTokensPerSecond;
        return val && val > 0 ? `${val.toFixed(1)} tok/s` : "-";
      },
      sortKey: "avgTokensPerSecond",
      getValue: (row) => (row as ProviderEntry).avgTokensPerSecond ?? 0,
    },
  ];

  const providerCacheHitRateColumns: ColumnDef<ProviderCacheHitRateEntry>[] = [
    {
      header: t("columns.provider"),
      cell: (row) => (row as ProviderCacheHitRateEntry).providerName,
      sortKey: "providerName",
      getValue: (row) => (row as ProviderCacheHitRateEntry).providerName,
    },
    {
      header: t("columns.cacheHitRequests"),
      className: "text-right",
      cell: (row) => (row as ProviderCacheHitRateEntry).totalRequests.toLocaleString(),
      sortKey: "totalRequests",
      getValue: (row) => (row as ProviderCacheHitRateEntry).totalRequests,
    },
    {
      header: t("columns.cacheHitRate"),
      className: "text-right",
      cell: (row) => {
        const rate = Number((row as ProviderCacheHitRateEntry).cacheHitRate || 0) * 100;
        const colorClass =
          rate >= 85
            ? "text-green-600 dark:text-green-400"
            : rate >= 60
              ? "text-yellow-600 dark:text-yellow-400"
              : "text-orange-600 dark:text-orange-400";
        return <span className={colorClass}>{rate.toFixed(1)}%</span>;
      },
      sortKey: "cacheHitRate",
      getValue: (row) => (row as ProviderCacheHitRateEntry).cacheHitRate,
    },
    {
      header: t("columns.cacheReadTokens"),
      className: "text-right",
      cell: (row) => formatTokenAmount((row as ProviderCacheHitRateEntry).cacheReadTokens),
      sortKey: "cacheReadTokens",
      getValue: (row) => (row as ProviderCacheHitRateEntry).cacheReadTokens,
    },
    {
      header: t("columns.totalTokens"),
      className: "text-right",
      cell: (row) => formatTokenAmount((row as ProviderCacheHitRateEntry).totalInputTokens),
      sortKey: "totalInputTokens",
      getValue: (row) => (row as ProviderCacheHitRateEntry).totalInputTokens,
    },
  ];

  const modelColumns: ColumnDef<ModelEntry>[] = [
    {
      header: t("columns.model"),
      cell: (row) => <span className="font-mono text-sm">{(row as ModelEntry).model}</span>,
      sortKey: "model",
      getValue: (row) => (row as ModelEntry).model,
    },
    {
      header: t("columns.requests"),
      className: "text-right",
      cell: (row) => (row as ModelEntry).totalRequests.toLocaleString(),
      sortKey: "totalRequests",
      getValue: (row) => (row as ModelEntry).totalRequests,
    },
    {
      header: t("columns.tokens"),
      className: "text-right",
      cell: (row) => formatTokenAmount((row as ModelEntry).totalTokens),
      sortKey: "totalTokens",
      getValue: (row) => (row as ModelEntry).totalTokens,
    },
    {
      header: t("columns.cost"),
      className: "text-right font-mono",
      cell: (row) => {
        const r = row as ModelEntry & { totalCostFormatted?: string };
        return r.totalCostFormatted ?? r.totalCost;
      },
      sortKey: "totalCost",
      getValue: (row) => (row as ModelEntry).totalCost,
      defaultBold: true,
    },
    {
      header: t("columns.successRate"),
      className: "text-right",
      cell: (row) => `${(Number((row as ModelEntry).successRate || 0) * 100).toFixed(1)}%`,
      sortKey: "successRate",
      getValue: (row) => (row as ModelEntry).successRate,
    },
  ];

  const columns = (() => {
    switch (scope) {
      case "user":
        return userColumns as ColumnDef<AnyEntry>[];
      case "provider":
        return providerColumns as ColumnDef<AnyEntry>[];
      case "providerCacheHitRate":
        return providerCacheHitRateColumns as ColumnDef<AnyEntry>[];
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
      case "providerCacheHitRate":
        return (row as ProviderCacheHitRateEntry).providerId;
      case "model":
        return (row as ModelEntry).model;
    }
  };

  return (
    <div className="w-full">
      {/* Scope toggle */}
      <div className="flex flex-wrap gap-4 items-center mb-4">
        <Tabs value={scope} onValueChange={(v) => setScope(v as LeaderboardScope)}>
          <TabsList className={isAdmin ? "grid grid-cols-4" : ""}>
            <TabsTrigger value="user">{t("tabs.userRanking")}</TabsTrigger>
            {isAdmin && <TabsTrigger value="provider">{t("tabs.providerRanking")}</TabsTrigger>}
            {isAdmin && (
              <TabsTrigger value="providerCacheHitRate">
                {t("tabs.providerCacheHitRateRanking")}
              </TabsTrigger>
            )}
            {isAdmin && <TabsTrigger value="model">{t("tabs.modelRanking")}</TabsTrigger>}
          </TabsList>
        </Tabs>

        {scope === "provider" || scope === "providerCacheHitRate" ? (
          <ProviderTypeFilter
            value={providerTypeFilter}
            onChange={setProviderTypeFilter}
            disabled={loading}
          />
        ) : null}
      </div>

      {scope === "user" && isAdmin && (
        <div className="flex flex-wrap gap-4 mb-4">
          <div className="flex-1 min-w-[200px] max-w-[300px]">
            <TagInput
              value={userTagFilters}
              onChange={setUserTagFilters}
              placeholder={t("filters.userTagsPlaceholder")}
              disabled={loading}
              maxTags={20}
              clearable
              suggestions={tagSuggestions}
              allowDuplicates={false}
              validateTag={(tag) => tagSuggestions.length === 0 || tagSuggestions.includes(tag)}
            />
          </div>
          <div className="flex-1 min-w-[200px] max-w-[300px]">
            <TagInput
              value={userGroupFilters}
              onChange={setUserGroupFilters}
              placeholder={t("filters.userGroupsPlaceholder")}
              disabled={loading}
              maxTags={20}
              clearable
              suggestions={groupSuggestions}
              allowDuplicates={false}
              validateTag={(tag) => groupSuggestions.length === 0 || groupSuggestions.includes(tag)}
            />
          </div>
        </div>
      )}

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
        {loading ? (
          <Card>
            <CardContent className="py-6 space-y-4">
              <div className="space-y-3">
                <div className="grid gap-4" style={skeletonGridStyle}>
                  {Array.from({ length: skeletonColumns }).map((_, index) => (
                    <Skeleton key={`leaderboard-head-${index}`} className="h-4 w-full" />
                  ))}
                </div>
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, rowIndex) => (
                    <div
                      key={`leaderboard-row-${rowIndex}`}
                      className="grid gap-4"
                      style={skeletonGridStyle}
                    >
                      {Array.from({ length: skeletonColumns }).map((_, colIndex) => (
                        <Skeleton
                          key={`leaderboard-cell-${rowIndex}-${colIndex}`}
                          className="h-4 w-full"
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div className="text-center text-xs text-muted-foreground">{t("states.loading")}</div>
            </CardContent>
          </Card>
        ) : error ? (
          <Card>
            <CardContent className="py-8">
              <div className="text-center text-destructive">{error}</div>
            </CardContent>
          </Card>
        ) : (
          <LeaderboardTable data={data} period={period} columns={columns} getRowKey={rowKey} />
        )}
      </div>
    </div>
  );
}
