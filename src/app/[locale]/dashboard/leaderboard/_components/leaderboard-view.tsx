"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { LeaderboardPrimaryTabs } from "@/app/[locale]/dashboard/leaderboard/_components/leaderboard-primary-tabs";
import { LeaderboardSecondaryTabs } from "@/app/[locale]/dashboard/leaderboard/_components/leaderboard-secondary-tabs";
import {
  getPrimaryTabFromScope,
  getScopeForPrimaryTab,
  getScopeForSecondaryTab,
  getSecondaryTabFromScope,
  isProviderFamilyScope,
  isUserFamilyScope,
  type LeaderboardPrimaryTab,
  type LeaderboardLeafScope as LeaderboardScope,
  type LeaderboardSecondaryTab,
  normalizeScopeFromUrl,
} from "@/app/[locale]/dashboard/leaderboard/_components/leaderboard-tab-groups";
import { ProviderTypeFilter } from "@/app/[locale]/settings/providers/_components/provider-type-filter";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TagInput } from "@/components/ui/tag-input";
import { Link } from "@/i18n/routing";
import { getAllUserKeyGroups, getAllUserTags } from "@/lib/api-client/v1/actions/users";
import { formatTokenAmount } from "@/lib/utils";
import type {
  DateRangeParams,
  LeaderboardEntry,
  LeaderboardPeriod,
  ModelCacheHitStat,
  ModelLeaderboardEntry,
  ModelProviderStat,
  ProviderCacheHitRateLeaderboardEntry,
  ProviderLeaderboardEntry,
  UserCacheHitModelStat,
  UserCacheHitRateLeaderboardEntry,
  UserModelStat,
} from "@/repository/leaderboard";
import type { ProviderType } from "@/types/provider";
import { DateRangePicker } from "./date-range-picker";
import { type ColumnDef, LeaderboardTable } from "./leaderboard-table";
import { getSuccessRateCellDisplay } from "./success-rate-display";

interface LeaderboardViewProps {
  isAdmin: boolean;
}
type TotalCostFormattedFields = { totalCostFormatted?: string };
type ProviderCostFormattedFields = {
  // API 额外返回的展示用字段（格式化后的字符串）
  totalCostFormatted?: string;
  avgCostPerRequestFormatted?: string | null;
  avgCostPerMillionTokensFormatted?: string | null;
};
type UserEntry = LeaderboardEntry &
  TotalCostFormattedFields & {
    modelStats?: UserModelStatClient[];
  };
type UserModelStatClient = UserModelStat & TotalCostFormattedFields;
type UserTableRow = UserEntry | UserModelStatClient;
type ModelEntry = ModelLeaderboardEntry & TotalCostFormattedFields;
type ModelProviderStatClient = ModelProviderStat & ProviderCostFormattedFields;
type ProviderEntry = Omit<ProviderLeaderboardEntry, "modelStats"> &
  ProviderCostFormattedFields & {
    modelStats?: ModelProviderStatClient[];
  };
type ProviderTableRow = ProviderEntry | ModelProviderStatClient;
type UserCacheHitModelStatClient = UserCacheHitModelStat;
type UserCacheHitRateEntry = Omit<UserCacheHitRateLeaderboardEntry, "modelStats"> &
  TotalCostFormattedFields & {
    modelStats?: UserCacheHitModelStatClient[];
  };
type UserCacheHitRateTableRow = UserCacheHitRateEntry | UserCacheHitModelStatClient;
type ProviderCacheHitRateEntry = ProviderCacheHitRateLeaderboardEntry;
type ProviderCacheHitRateTableRow = ProviderCacheHitRateEntry | ModelCacheHitStat;
type AnyEntry =
  | UserEntry
  | UserCacheHitRateEntry
  | ProviderEntry
  | ProviderCacheHitRateEntry
  | ModelEntry;

function renderSuccessRateCell(
  row: { successRate: number | null; basisDisclosureRequired?: boolean },
  t: ReturnType<typeof useTranslations>
) {
  const display = getSuccessRateCellDisplay(row, t);
  return (
    <span
      className={typeof row.successRate === "number" ? undefined : "text-muted-foreground"}
      title={display.title}
    >
      {display.label}
    </span>
  );
}

const VALID_PERIODS: LeaderboardPeriod[] = ["daily", "weekly", "monthly", "allTime", "custom"];

export function LeaderboardView({ isAdmin }: LeaderboardViewProps) {
  const t = useTranslations("dashboard.leaderboard");
  const searchParams = useSearchParams();

  const urlScope = searchParams.get("scope");
  const initialScope = normalizeScopeFromUrl(urlScope, isAdmin);
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
    const normalizedScope = normalizeScopeFromUrl(searchParams.get("scope"), isAdmin);

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
        if (isProviderFamilyScope(scope) && providerTypeFilter !== "all") {
          url += `&providerType=${encodeURIComponent(providerTypeFilter)}`;
        }
        if (scope === "provider") {
          url += "&includeModelStats=1";
        }
        if (isUserFamilyScope(scope) && isAdmin) {
          url += "&includeUserModelStats=1";
        }
        if (isUserFamilyScope(scope)) {
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
  }, [scope, period, dateRange, providerTypeFilter, userTagFilters, userGroupFilters, isAdmin, t]);

  const handlePeriodChange = useCallback(
    (newPeriod: LeaderboardPeriod, newDateRange?: DateRangeParams) => {
      setPeriod(newPeriod);
      setDateRange(newDateRange);
    },
    []
  );

  // 一级/二级 tab 只是叶子 scope 的 UI 投影，状态真源始终只有 scope。
  const activePrimaryTab = getPrimaryTabFromScope(scope);
  const activeSecondaryTab = getSecondaryTabFromScope(scope);
  const showSecondaryTabs = isAdmin && activePrimaryTab !== "model";
  const isProviderFamily = isProviderFamilyScope(scope);
  const isUserFamily = isUserFamilyScope(scope);

  const handlePrimaryTabChange = (tab: LeaderboardPrimaryTab) => {
    setScope(getScopeForPrimaryTab(tab));
  };

  const handleSecondaryTabChange = (tab: LeaderboardSecondaryTab) => {
    const primaryTab = getPrimaryTabFromScope(scope);
    if (primaryTab === "model") {
      return;
    }

    setScope(getScopeForSecondaryTab(primaryTab, tab));
  };

  const skeletonColumns =
    scope === "user"
      ? 5
      : scope === "userCacheHitRate"
        ? 6
        : scope === "provider"
          ? 10
          : scope === "providerCacheHitRate"
            ? 8
            : scope === "model"
              ? 6
              : 5;
  const skeletonGridStyle = { gridTemplateColumns: `repeat(${skeletonColumns}, minmax(0, 1fr))` };

  // 列定义（根据 scope 动态切换）
  const renderSubModelLabel = (model: string) => (
    <div className="pl-6">
      <span className="font-mono text-sm">{model}</span>
    </div>
  );

  const userColumns: ColumnDef<UserTableRow>[] = [
    {
      header: t("columns.user"),
      cell: (row) => {
        if ("userName" in row) {
          return isAdmin ? (
            <Link
              href={`/dashboard/leaderboard/user/${row.userId}`}
              className="hover:text-muted-foreground transition-colors"
              data-testid={`leaderboard-user-link-${row.userId}`}
            >
              {row.userName}
            </Link>
          ) : (
            row.userName
          );
        }
        return renderSubModelLabel(row.model ?? t("columns.unknownModel"));
      },
      sortKey: "userName",
      getValue: (row) => ("userName" in row ? row.userName : (row.model ?? "")),
    },
    {
      header: t("columns.requests"),
      className: "text-right",
      cell: (row) => row.totalRequests.toLocaleString(),
      sortKey: "totalRequests",
      getValue: (row) => row.totalRequests,
    },
    {
      header: t("columns.tokens"),
      className: "text-right",
      cell: (row) => formatTokenAmount(row.totalTokens),
      sortKey: "totalTokens",
      getValue: (row) => row.totalTokens,
    },
    {
      header: t("columns.consumedAmount"),
      className: "text-right font-mono",
      cell: (row) => row.totalCostFormatted ?? row.totalCost,
      sortKey: "totalCost",
      getValue: (row) => row.totalCost,
      defaultBold: true,
    },
  ];

  const providerColumns: ColumnDef<ProviderTableRow>[] = [
    {
      header: t("columns.provider"),
      cell: (row) => {
        if ("providerName" in row) return row.providerName;
        return renderSubModelLabel(row.model);
      },
      sortKey: "providerName",
      getValue: (row) => ("providerName" in row ? row.providerName : row.model),
    },
    {
      header: t("columns.requests"),
      className: "text-right",
      cell: (row) => row.totalRequests.toLocaleString(),
      sortKey: "totalRequests",
      getValue: (row) => row.totalRequests,
    },
    {
      header: t("columns.cost"),
      className: "text-right font-mono",
      cell: (row) => row.totalCostFormatted ?? row.totalCost,
      sortKey: "totalCost",
      getValue: (row) => row.totalCost,
      defaultBold: true,
    },
    {
      header: t("columns.tokens"),
      className: "text-right",
      cell: (row) => formatTokenAmount(row.totalTokens),
      sortKey: "totalTokens",
      getValue: (row) => row.totalTokens,
    },
    {
      header: t("columns.successRate"),
      className: "text-right",
      cell: (row) => renderSuccessRateCell(row, t),
      sortKey: "successRate",
      getValue: (row) => row.successRate,
    },
    {
      header: t("columns.avgTtfbMs"),
      className: "text-right",
      cell: (row) => {
        const val = row.avgTtfbMs;
        return val && val > 0 ? `${Math.round(val).toLocaleString()} ms` : "-";
      },
      sortKey: "avgTtfbMs",
      getValue: (row) => row.avgTtfbMs ?? 0,
    },
    {
      header: t("columns.avgTokensPerSecond"),
      className: "text-right",
      cell: (row) => {
        const val = row.avgTokensPerSecond;
        return val && val > 0 ? `${val.toFixed(1)} tok/s` : "-";
      },
      sortKey: "avgTokensPerSecond",
      getValue: (row) => row.avgTokensPerSecond ?? 0,
    },
    {
      header: t("columns.avgCostPerRequest"),
      className: "text-right font-mono",
      cell: (row) => {
        if (row.avgCostPerRequest == null) return "-";
        return row.avgCostPerRequestFormatted ?? row.avgCostPerRequest.toFixed(4);
      },
      sortKey: "avgCostPerRequest",
      getValue: (row) => row.avgCostPerRequest ?? 0,
    },
    {
      header: t("columns.avgCostPerMillionTokens"),
      className: "text-right font-mono",
      cell: (row) => {
        if (row.avgCostPerMillionTokens == null) return "-";
        return row.avgCostPerMillionTokensFormatted ?? row.avgCostPerMillionTokens.toFixed(2);
      },
      sortKey: "avgCostPerMillionTokens",
      getValue: (row) => row.avgCostPerMillionTokens ?? 0,
    },
  ];

  const providerCacheHitRateColumns: ColumnDef<ProviderCacheHitRateTableRow>[] = [
    {
      header: t("columns.provider"),
      cell: (row) => {
        if ("providerName" in row) return row.providerName;
        return renderSubModelLabel(row.model);
      },
      sortKey: "providerName",
      getValue: (row) => ("providerName" in row ? row.providerName : row.model),
    },
    {
      header: t("columns.cacheHitRequests"),
      className: "text-right",
      cell: (row) => row.totalRequests.toLocaleString(),
      sortKey: "totalRequests",
      getValue: (row) => row.totalRequests,
    },
    {
      header: t("columns.cacheHitRate"),
      className: "text-right",
      cell: (row) => {
        const rate = Number(row.cacheHitRate || 0) * 100;
        const colorClass =
          rate >= 85
            ? "text-green-600 dark:text-green-400"
            : rate >= 60
              ? "text-yellow-600 dark:text-yellow-400"
              : "text-orange-600 dark:text-orange-400";
        return <span className={colorClass}>{rate.toFixed(1)}%</span>;
      },
      sortKey: "cacheHitRate",
      getValue: (row) => row.cacheHitRate,
    },
    {
      header: t("columns.cacheReadTokens"),
      className: "text-right",
      cell: (row) => formatTokenAmount(row.cacheReadTokens),
      sortKey: "cacheReadTokens",
      getValue: (row) => row.cacheReadTokens,
    },
    {
      header: t("columns.totalTokens"),
      className: "text-right",
      cell: (row) => formatTokenAmount(row.totalInputTokens),
      sortKey: "totalInputTokens",
      getValue: (row) => row.totalInputTokens,
    },
  ];

  const userCacheHitRateColumns: ColumnDef<UserCacheHitRateTableRow>[] = [
    {
      header: t("columns.user"),
      cell: (row) => {
        if ("userName" in row) {
          return isAdmin ? (
            <Link
              href={`/dashboard/leaderboard/user/${row.userId}`}
              className="hover:text-muted-foreground transition-colors"
              data-testid={`leaderboard-user-cache-link-${row.userId}`}
            >
              {row.userName}
            </Link>
          ) : (
            row.userName
          );
        }
        return renderSubModelLabel(row.model ?? t("columns.unknownModel"));
      },
      sortKey: "userName",
      getValue: (row) => ("userName" in row ? row.userName : (row.model ?? "")),
    },
    {
      header: t("columns.cacheHitRequests"),
      className: "text-right",
      cell: (row) => row.totalRequests.toLocaleString(),
      sortKey: "totalRequests",
      getValue: (row) => row.totalRequests,
    },
    {
      header: t("columns.cacheHitRate"),
      className: "text-right",
      cell: (row) => {
        const rate = Number(row.cacheHitRate || 0) * 100;
        const colorClass =
          rate >= 85
            ? "text-green-600 dark:text-green-400"
            : rate >= 60
              ? "text-yellow-600 dark:text-yellow-400"
              : "text-orange-600 dark:text-orange-400";
        return <span className={colorClass}>{rate.toFixed(1)}%</span>;
      },
      sortKey: "cacheHitRate",
      getValue: (row) => row.cacheHitRate,
    },
    {
      header: t("columns.cacheReadTokens"),
      className: "text-right",
      cell: (row) => formatTokenAmount(row.cacheReadTokens),
      sortKey: "cacheReadTokens",
      getValue: (row) => row.cacheReadTokens,
    },
    {
      header: t("columns.totalTokens"),
      className: "text-right",
      cell: (row) => formatTokenAmount(row.totalInputTokens),
      sortKey: "totalInputTokens",
      getValue: (row) => row.totalInputTokens,
    },
    {
      header: t("columns.consumedAmount"),
      className: "text-right font-mono",
      cell: (row) => {
        if ("userName" in row) {
          return row.totalCostFormatted ?? row.totalCost;
        }
        return <span className="text-muted-foreground">-</span>;
      },
      sortKey: "totalCost",
      getValue: (row) => ("userName" in row ? row.totalCost : 0),
      defaultBold: true,
    },
  ];

  const modelColumns: ColumnDef<ModelEntry>[] = [
    {
      header: t("columns.model"),
      cell: (row) => <span className="font-mono text-sm">{row.model}</span>,
      sortKey: "model",
      getValue: (row) => row.model,
    },
    {
      header: t("columns.requests"),
      className: "text-right",
      cell: (row) => row.totalRequests.toLocaleString(),
      sortKey: "totalRequests",
      getValue: (row) => row.totalRequests,
    },
    {
      header: t("columns.tokens"),
      className: "text-right",
      cell: (row) => formatTokenAmount(row.totalTokens),
      sortKey: "totalTokens",
      getValue: (row) => row.totalTokens,
    },
    {
      header: t("columns.cost"),
      className: "text-right font-mono",
      cell: (row) => row.totalCostFormatted ?? row.totalCost,
      sortKey: "totalCost",
      getValue: (row) => row.totalCost,
      defaultBold: true,
    },
    {
      header: t("columns.successRate"),
      className: "text-right",
      cell: (row) => renderSuccessRateCell(row, t),
      sortKey: "successRate",
      getValue: (row) => row.successRate,
    },
  ];

  const renderUserTable = () => (
    <LeaderboardTable<UserEntry, UserModelStatClient>
      data={data as UserEntry[]}
      period={period}
      columns={userColumns}
      getRowKey={(row) => row.userId}
      {...(isAdmin
        ? {
            getSubRows: (row) => row.modelStats,
            getSubRowKey: (subRow) => subRow.model ?? "__null__",
          }
        : {})}
    />
  );

  const renderProviderTable = () => (
    <LeaderboardTable<ProviderEntry, ModelProviderStatClient>
      data={data as ProviderEntry[]}
      period={period}
      columns={providerColumns}
      getRowKey={(row) => row.providerId}
      getSubRows={(row) => row.modelStats}
      getSubRowKey={(subRow) => subRow.model}
    />
  );

  const renderProviderCacheHitRateTable = () => (
    <LeaderboardTable<ProviderCacheHitRateEntry, ModelCacheHitStat>
      data={data as ProviderCacheHitRateEntry[]}
      period={period}
      columns={providerCacheHitRateColumns}
      getRowKey={(row) => row.providerId}
      getSubRows={(row) => row.modelStats}
      getSubRowKey={(subRow) => subRow.model}
    />
  );

  const renderUserCacheHitRateTable = () => (
    <LeaderboardTable<UserCacheHitRateEntry, UserCacheHitModelStat>
      data={data as UserCacheHitRateEntry[]}
      period={period}
      columns={userCacheHitRateColumns}
      getRowKey={(row) => row.userId}
      {...(isAdmin
        ? {
            getSubRows: (row) => row.modelStats,
            getSubRowKey: (subRow) => subRow.model ?? "__null__",
          }
        : {})}
    />
  );

  const renderModelTable = () => (
    <LeaderboardTable<ModelEntry>
      data={data as ModelEntry[]}
      period={period}
      columns={modelColumns}
      getRowKey={(row) => row.model}
    />
  );

  const renderTable = () => {
    if (scope === "user") return renderUserTable();
    if (scope === "userCacheHitRate") return renderUserCacheHitRateTable();
    if (scope === "provider") return renderProviderTable();
    if (scope === "providerCacheHitRate") return renderProviderCacheHitRateTable();
    return renderModelTable();
  };

  return (
    <div className="w-full">
      {/* Scope toggle */}
      <div className="mb-4 flex flex-wrap items-start gap-4">
        <div className="flex min-w-[220px] flex-1 flex-col gap-2">
          <LeaderboardPrimaryTabs
            isAdmin={isAdmin}
            activePrimaryTab={activePrimaryTab}
            onPrimaryChange={handlePrimaryTabChange}
            labels={{
              user: t("tabs.primaryUser"),
              provider: t("tabs.primaryProvider"),
              model: t("tabs.primaryModel"),
            }}
          />
          {showSecondaryTabs ? (
            <LeaderboardSecondaryTabs
              activePrimaryTab={activePrimaryTab}
              activeSecondaryTab={activeSecondaryTab}
              onSecondaryChange={handleSecondaryTabChange}
              labels={{
                cost: t("tabs.secondaryCost"),
                cacheHit: t("tabs.secondaryCacheHit"),
              }}
            />
          ) : null}
        </div>

        {isProviderFamily ? (
          <ProviderTypeFilter
            value={providerTypeFilter}
            onChange={setProviderTypeFilter}
            disabled={loading}
          />
        ) : null}
      </div>

      {isUserFamily && isAdmin && (
        <div className="flex flex-wrap gap-4 mb-4">
          <div className="flex-1 min-w-[200px] max-w-[300px]">
            <TagInput
              data-testid="leaderboard-user-tag-filter"
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
              data-testid="leaderboard-user-group-filter"
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
          renderTable()
        )}
      </div>
    </div>
  );
}
