"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowUp, GitBranch, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { IpDetailsDialog } from "@/app/[locale]/dashboard/_components/ip-details-dialog";
import { IpDisplayTrigger } from "@/app/[locale]/dashboard/_components/ip-display-trigger";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { IpGeoLookupMode } from "@/hooks/use-ip-geo";
import { useVirtualizedInfiniteList } from "@/hooks/use-virtualized-infinite-list";
import type { ActionResult } from "@/lib/api-client/v1/actions/types";
import { getUsageLogsBatch } from "@/lib/api-client/v1/actions/usage-logs";
import type { LogsTableColumn } from "@/lib/column-visibility";
import { cn, formatTokenAmount } from "@/lib/utils";
import { copyTextToClipboard } from "@/lib/utils/clipboard";
import type { CurrencyCode } from "@/lib/utils/currency";
import { Decimal, formatCurrency, toDecimal } from "@/lib/utils/currency";
import { buildHedgeBillingTable } from "@/lib/utils/hedge-billing";
import {
  calculateOutputRate,
  formatDuration,
  isNonBillingEndpoint,
  shouldHideOutputRate,
} from "@/lib/utils/performance-formatter";
import { shouldShowCostBadgeInCell } from "@/lib/utils/provider-chain-display";
import { getFinalProviderName } from "@/lib/utils/provider-chain-formatter";
import { isProviderFinalized } from "@/lib/utils/provider-display";
import { hasPriorityServiceTierSpecialSetting } from "@/lib/utils/special-settings";
import type { UsageLogRow, UsageLogsBatchResult } from "@/repository/usage-logs";
import type { BillingModelSource } from "@/types/system-config";
import { ErrorDetailsDialog } from "./error-details-dialog";
import { ModelDisplayWithRedirect } from "./model-display-with-redirect";
import { ProviderChainPopover } from "./provider-chain-popover";

const BATCH_SIZE = 50;
const ROW_HEIGHT = 64; // Estimated row height in pixels

export type LogsFetchFn = (
  params: VirtualizedLogsTableFilters & {
    cursor?: { createdAt: string; id: number };
    limit: number;
  }
) => Promise<ActionResult<UsageLogsBatchResult>>;

export interface VirtualizedLogsTableFilters {
  userId?: number;
  keyId?: number;
  providerId?: number;
  sessionId?: string;
  startTime?: number;
  endTime?: number;
  statusCode?: number;
  excludeStatusCode200?: boolean;
  model?: string;
  endpoint?: string;
  minRetryCount?: number;
}

const STATUS_BADGE_FALLBACK =
  "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600";

function getStatusBadgeClassName(statusCode: number | null): string {
  if (statusCode != null && statusCode >= 200 && statusCode < 300) {
    return "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700";
  }
  if (statusCode != null && statusCode >= 400 && statusCode < 500) {
    return "bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700";
  }
  if (statusCode != null && statusCode >= 500) {
    return "bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700";
  }
  return STATUS_BADGE_FALLBACK;
}

function StatusBadgeOnly({ statusCode }: { statusCode: number | null }) {
  return (
    <Badge variant="outline" className={getStatusBadgeClassName(statusCode)}>
      {statusCode ?? "-"}
    </Badge>
  );
}

function hasPositiveReasoningTokens(value: number | null | undefined): value is number {
  return value != null && value > 0;
}

function hasTokenValue(value: number | null | undefined): value is number {
  return value != null;
}

interface CompactMetricRow {
  key: string;
  label: string;
  value: ReactNode;
  tone?: "default" | "muted";
  labelExtra?: ReactNode;
  valueSlot?: string;
}

function compactMetricRows(rows: Array<CompactMetricRow | null>): CompactMetricRow[] {
  const compactedRows: CompactMetricRow[] = [];

  for (const row of rows) {
    if (row) compactedRows.push(row);
  }

  return compactedRows;
}

function CompactMetricRows({ rows, emptyLabel }: { rows: CompactMetricRow[]; emptyLabel: string }) {
  if (rows.length === 0) {
    return (
      <span data-slot="logs-metric-empty" className="text-muted-foreground">
        {emptyLabel}
      </span>
    );
  }

  return (
    <div className="grid gap-0.5 leading-tight tabular-nums" data-slot="logs-metric-rows">
      {rows.map((row) => (
        <div
          key={row.key}
          className="grid grid-cols-[minmax(2.5rem,auto)_minmax(0,1fr)] items-baseline gap-x-1.5"
          data-slot={`logs-metric-row-${row.key}`}
        >
          <span className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground/75">
            <span className="truncate">{row.label}</span>
            {row.labelExtra}
          </span>
          <span
            className={cn(
              "min-w-0 text-right font-mono",
              row.tone === "muted" ? "text-muted-foreground" : "text-foreground"
            )}
            data-slot={row.valueSlot}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

interface VirtualizedLogsTableProps {
  filters: VirtualizedLogsTableFilters;
  currencyCode?: CurrencyCode;
  billingModelSource?: BillingModelSource;
  autoRefreshEnabled?: boolean;
  autoRefreshIntervalMs?: number;
  hideStatusBar?: boolean;
  hideScrollToTop?: boolean;
  hiddenColumns?: LogsTableColumn[];
  bodyClassName?: string;
  serverTimeZone?: string;
  /** Custom fetch function (defaults to getUsageLogsBatch) */
  fetchFn?: LogsFetchFn;
  /** Custom query key prefix (defaults to "usage-logs-batch") */
  queryKeyPrefix?: string;
  /** Disable the detail side-panel dialog on status badge click */
  disableDetailDialog?: boolean;
  /** Select which IP lookup authorization model the detail dialog should use */
  ipLookupMode?: IpGeoLookupMode;
}

export function VirtualizedLogsTable({
  filters,
  currencyCode = "USD",
  billingModelSource = "original",
  autoRefreshEnabled = true,
  autoRefreshIntervalMs = 5000,
  hideStatusBar = false,
  hideScrollToTop = false,
  hiddenColumns,
  bodyClassName,
  serverTimeZone: _serverTimeZone,
  fetchFn,
  queryKeyPrefix = "usage-logs-batch",
  disableDetailDialog = false,
  ipLookupMode = "default",
}: VirtualizedLogsTableProps) {
  const t = useTranslations("dashboard");
  const tChain = useTranslations("provider-chain");
  const [isHistoryBrowsing, setIsHistoryBrowsing] = useState(false);
  const shouldPoll = autoRefreshEnabled && !isHistoryBrowsing;

  const hideProviderColumn = hiddenColumns?.includes("provider") ?? false;
  const hideUserColumn = hiddenColumns?.includes("user") ?? false;
  const hideKeyColumn = hiddenColumns?.includes("key") ?? false;
  const hideSessionIdColumn = hiddenColumns?.includes("sessionId") ?? false;
  const hideIpColumn = hiddenColumns?.includes("ip") ?? false;
  const hideTokensColumn = hiddenColumns?.includes("tokens") ?? false;
  const hideCacheColumn = hiddenColumns?.includes("cache") ?? false;
  const hideCostColumn = hiddenColumns?.includes("cost") ?? false;
  const hidePerformanceColumn = hiddenColumns?.includes("performance") ?? false;

  // Dialog state for model redirect click and chain item click
  const [dialogState, setDialogState] = useState<{
    logId: number | null;
    scrollToRedirect: boolean;
    targetTab?: "summary" | "logic-trace" | "performance";
    expandedChainIndex?: number;
  }>({ logId: null, scrollToRedirect: false });

  const [ipDialogOpen, setIpDialogOpen] = useState(false);
  const [ipDialogValue, setIpDialogValue] = useState<string | null>(null);

  const handleCopySessionIdClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const sessionId = event.currentTarget.dataset.sessionId;
      if (!sessionId) return;

      void copyTextToClipboard(sessionId).then((ok) => {
        if (ok) toast.success(t("actions.copied"));
      });
    },
    [t]
  );

  // Infinite query with cursor-based pagination
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, error } =
    useInfiniteQuery({
      queryKey: [queryKeyPrefix, filters],
      queryFn: async ({ pageParam }) => {
        const fetcher = fetchFn ?? getUsageLogsBatch;
        const result = await fetcher({
          ...filters,
          cursor: pageParam,
          limit: BATCH_SIZE,
        });
        if (!result.ok) {
          throw new Error(result.error);
        }
        return result.data;
      },
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      initialPageParam: undefined as { createdAt: string; id: number } | undefined,
      staleTime: 30000, // 30 seconds
      refetchOnWindowFocus: false,
      refetchInterval: (query) => {
        if (!shouldPoll) return false;
        if (query.state.fetchStatus !== "idle") return false;
        return autoRefreshIntervalMs;
      },
    });

  // Flatten all pages into a single array
  const pages = data?.pages;
  const allLogs = useMemo(() => pages?.flatMap((page) => page.logs) ?? [], [pages]);
  const filtersResetKey = useMemo(() => JSON.stringify(filters), [filters]);
  const previousFiltersResetKeyRef = useRef(filtersResetKey);

  const getItemKey = useCallback(
    (index: number) => allLogs[index]?.id ?? `loader-${index}`,
    [allLogs]
  );

  const {
    parentRef,
    rowVirtualizer,
    virtualItems,
    showScrollToTop,
    handleScroll,
    scrollToTop,
    resetScrollPosition,
  } = useVirtualizedInfiniteList({
    itemCount: allLogs.length,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    getItemKey,
  });

  useEffect(() => {
    setIsHistoryBrowsing(showScrollToTop);
  }, [showScrollToTop]);

  const handleFiltersReset = useEffectEvent((nextResetKey: string) => {
    if (previousFiltersResetKeyRef.current === nextResetKey) return;
    previousFiltersResetKeyRef.current = nextResetKey;
    resetScrollPosition();
  });

  useEffect(() => {
    handleFiltersReset(filtersResetKey);
  }, [filtersResetKey]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">{t("logs.stats.loading")}</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-8 text-destructive">
        {error instanceof Error ? error.message : t("logs.error.loadFailed")}
      </div>
    );
  }

  if (allLogs.length === 0) {
    return <div className="text-center py-8 text-muted-foreground">{t("logs.table.noData")}</div>;
  }

  const renderCostTooltip = (log: UsageLogRow) => {
    const title = t("logs.details.billingDetails.title");
    const totalCostLabel = t("logs.billingDetails.totalCost");
    const amountClassName = "font-mono tabular-nums text-right";
    const headerChip = log.context1mApplied ? (
      <Badge
        variant="outline"
        className="shrink-0 text-[10px] leading-tight px-1 bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-800"
      >
        {t("logs.billingDetails.context1m")}
      </Badge>
    ) : null;

    const resolveCacheCreationRows = () => {
      const breakdown = log.costBreakdown;
      if (!breakdown) {
        return [] as Array<{
          amount: string;
          tokens: number | null | undefined;
          ttl?: "5m" | "1h";
        }>;
      }

      const tokens5m = log.cacheCreation5mInputTokens ?? 0;
      const tokens1h = log.cacheCreation1hInputTokens ?? 0;
      const totalCacheTokens = log.cacheCreationInputTokens;
      const has5m = breakdown.cache_creation_5m !== undefined;
      const has1h = breakdown.cache_creation_1h !== undefined;
      if (has5m || has1h) {
        return [
          {
            amount: breakdown.cache_creation_5m ?? "0",
            tokens: tokens5m > 0 ? tokens5m : log.cacheTtlApplied !== "1h" ? totalCacheTokens : 0,
            ttl: "5m" as const,
          },
          {
            amount: breakdown.cache_creation_1h ?? "0",
            tokens: tokens1h > 0 ? tokens1h : log.cacheTtlApplied === "1h" ? totalCacheTokens : 0,
            ttl: "1h" as const,
          },
        ];
      }

      const aggregate = toDecimal(breakdown.cache_creation);
      if (!aggregate || aggregate.lte(0)) {
        return [];
      }

      if (log.cacheTtlApplied === "mixed" && tokens5m + tokens1h > 0) {
        const totalTokens = new Decimal(tokens5m + tokens1h);
        const fiveMShare = aggregate.mul(tokens5m).div(totalTokens);
        return [
          {
            amount: fiveMShare.toString(),
            tokens: tokens5m,
            ttl: "5m" as const,
          },
          {
            amount: aggregate.minus(fiveMShare).toString(),
            tokens: tokens1h,
            ttl: "1h" as const,
          },
        ];
      }

      if (log.cacheTtlApplied === "1h") {
        return [
          {
            amount: aggregate.toString(),
            tokens: tokens1h > 0 ? tokens1h : totalCacheTokens,
            ttl: "1h" as const,
          },
        ];
      }

      if (log.cacheTtlApplied === "5m") {
        return [
          {
            amount: aggregate.toString(),
            tokens: tokens5m > 0 ? tokens5m : totalCacheTokens,
            ttl: "5m" as const,
          },
        ];
      }

      return [
        {
          amount: aggregate.toString(),
          tokens: totalCacheTokens,
        },
      ];
    };

    const createCostRow = (
      label: string,
      amount: string | null | undefined,
      tokens: number | null | undefined,
      ttl?: "5m" | "1h"
    ) => {
      const parsedAmount = toDecimal(amount);
      if (!parsedAmount || parsedAmount.lte(0)) return null;

      const tokenCount = tokens ?? 0;
      const unitPrice = tokenCount > 0 ? parsedAmount.mul(1_000_000).div(tokenCount) : null;

      return {
        key: `${label}-${ttl ?? "default"}`,
        label,
        ttl,
        unitPrice: unitPrice
          ? t("logs.billingDetails.unitPricePer1M", {
              price: formatCurrency(unitPrice, currencyCode, 2),
            })
          : null,
        amount: formatCurrency(parsedAmount, currencyCode, 6),
      };
    };

    const renderTtlChip = (ttl: "5m" | "1h") => (
      <Badge
        variant="outline"
        className="px-1 text-[10px] leading-tight text-muted-foreground border-border/60"
      >
        {ttl}
      </Badge>
    );

    const renderValueBlock = ({
      primary,
      secondary,
      emphasize = false,
      secondaryClassName,
    }: {
      primary: string;
      secondary?: ReactNode;
      emphasize?: boolean;
      secondaryClassName?: string;
    }) => (
      <div className={cn("flex flex-col items-end", amountClassName)}>
        {secondary ? (
          <span className={cn("text-[11px] text-muted-foreground", secondaryClassName)}>
            {secondary}
          </span>
        ) : null}
        <span
          className={cn(
            emphasize ? "text-sm font-semibold text-emerald-600 dark:text-emerald-300" : ""
          )}
        >
          {primary}
        </span>
      </div>
    );

    const renderSummaryRow = ({
      label,
      primary,
      secondary,
      emphasize = false,
      className,
      secondaryClassName,
    }: {
      label: string;
      primary: string;
      secondary?: ReactNode;
      emphasize?: boolean;
      className?: string;
      secondaryClassName?: string;
    }) => (
      <div className={cn("flex items-start justify-between gap-3", className)}>
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        {renderValueBlock({ primary, secondary, emphasize, secondaryClassName })}
      </div>
    );

    const isActiveMultiplier = (value: number) =>
      Number.isFinite(value) && value > 0 && value !== 1;

    const hedgeTable = buildHedgeBillingTable(log.costUsd, log.hedgeLosers, {
      inputTokens: log.inputTokens,
      outputTokens: log.outputTokens,
      cacheCreationInputTokens: log.cacheCreationInputTokens,
      cacheReadInputTokens: log.cacheReadInputTokens,
    });
    const hedgeSection = hedgeTable ? (
      <div className="space-y-2 border-t border-border/60 pt-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-foreground">
            {t("logs.billingDetails.hedgeRacing")}
          </span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {t("logs.billingDetails.hedgeMergedCount", { count: hedgeTable.count })}
          </span>
        </div>
        <div className="space-y-2">
          {renderSummaryRow({
            label: t("logs.billingDetails.hedgeWinner"),
            primary: formatCurrency(hedgeTable.winnerCost, currencyCode, 6),
          })}
          {hedgeTable.attempts
            .filter((attempt) => attempt.kind === "loser")
            .map((loser) => (
              <div
                key={`${loser.providerId}-${loser.attemptNumber}`}
                className="flex items-start justify-between gap-3"
              >
                <span className="text-[11px] text-rose-600 dark:text-rose-300 truncate">
                  {loser.providerName ?? t("logs.billingDetails.hedgeLoserShort")}
                </span>
                <span className={cn(amountClassName, "text-rose-600 dark:text-rose-300")}>
                  {formatCurrency(loser.costUsd, currencyCode, 6)}
                </span>
              </div>
            ))}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
          <span>{t("logs.billingDetails.hedgeTokenTotal")}</span>
          <span className="font-mono">
            {[
              `${formatTokenAmount(hedgeTable.tokenTotals.inputTokens)} ${t("logs.billingDetails.input")}`,
              `${formatTokenAmount(hedgeTable.tokenTotals.outputTokens)} ${t("logs.billingDetails.output")}`,
              ...(hedgeTable.hasCacheWrite
                ? [
                    `${formatTokenAmount(hedgeTable.tokenTotals.cacheCreationInputTokens)} ${t("logs.billingDetails.hedgeColCacheWrite")}`,
                  ]
                : []),
              ...(hedgeTable.hasCacheRead
                ? [
                    `${formatTokenAmount(hedgeTable.tokenTotals.cacheReadInputTokens)} ${t("logs.billingDetails.hedgeColCacheRead")}`,
                  ]
                : []),
            ].join(" · ")}
          </span>
        </div>
      </div>
    ) : null;

    if (!log.costBreakdown) {
      return (
        <TooltipContent align="end" variant="popover" className="max-w-[320px] p-3">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-foreground">{title}</span>
              {headerChip}
            </div>
            <div className="space-y-1 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
              <div className="flex items-center justify-between gap-3">
                <span>{t("logs.billingDetails.output")}</span>
                <span className={amountClassName}>{formatTokenAmount(log.outputTokens)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>{t("logs.billingDetails.reasoningTokens")}</span>
                <span className={amountClassName}>
                  {formatTokenAmount(log.reasoningOutputTokens)}
                </span>
              </div>
              <div>{t("logs.billingDetails.includedInOutput")}</div>
            </div>
            <div className="border-t border-border/60 pt-2">
              {renderSummaryRow({
                label: totalCostLabel,
                primary: formatCurrency(log.costUsd, currencyCode, 6),
                emphasize: true,
              })}
            </div>
            {hedgeSection}
          </div>
        </TooltipContent>
      );
    }

    const cacheCreationRows = resolveCacheCreationRows();
    const costRows = [
      createCostRow(t("logs.billingDetails.input"), log.costBreakdown.input, log.inputTokens),
      createCostRow(t("logs.billingDetails.output"), log.costBreakdown.output, log.outputTokens),
      {
        key: "reasoning",
        label: t("logs.billingDetails.reasoningTokens"),
        ttl: undefined,
        amount: formatTokenAmount(log.reasoningOutputTokens),
        unitPrice: t("logs.billingDetails.includedInOutput"),
      },
      ...cacheCreationRows.map((row) =>
        createCostRow(t("logs.columns.cacheWrite"), row.amount, row.tokens, row.ttl)
      ),
      createCostRow(
        t("logs.billingDetails.cacheRead"),
        log.costBreakdown.cache_read,
        log.cacheReadInputTokens
      ),
    ].filter((row): row is NonNullable<typeof row> => row !== null);

    const activeMultiplierRows = [
      isActiveMultiplier(log.costBreakdown.provider_multiplier)
        ? {
            key: "provider",
            label: t("logs.billingDetails.providerMultiplier"),
            value: `${log.costBreakdown.provider_multiplier.toFixed(2)}x`,
          }
        : null,
      isActiveMultiplier(log.costBreakdown.group_multiplier)
        ? {
            key: "group",
            label: t("logs.billingDetails.groupMultiplier"),
            value: `${log.costBreakdown.group_multiplier.toFixed(2)}x`,
          }
        : null,
    ].filter((row): row is NonNullable<typeof row> => row !== null);

    const hasActiveMultipliers = activeMultiplierRows.length > 0;
    const baseTotal = formatCurrency(log.costBreakdown.base_total, currencyCode, 6);
    // costBreakdown.total is the winner-only base; when hedge losers were billed the grand
    // total lives in costUsd, so prefer it then (keeps the tooltip total == sum of its rows).
    const finalTotal = formatCurrency(
      log.hedgeLosers && log.hedgeLosers.length > 0
        ? (log.costUsd ?? log.costBreakdown.total)
        : log.costBreakdown.total,
      currencyCode,
      6
    );

    return (
      <TooltipContent align="end" variant="popover" className="max-w-[320px] p-3">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-foreground">{title}</span>
            {headerChip}
          </div>

          {costRows.length > 0 ? (
            <div className="space-y-2">
              {costRows.map((row) => (
                <div key={row.key} className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-muted-foreground">
                    <span>{row.label}</span>
                    {row.ttl ? renderTtlChip(row.ttl) : null}
                  </div>
                  {renderValueBlock({ primary: row.amount, secondary: row.unitPrice })}
                </div>
              ))}
            </div>
          ) : null}

          {hasActiveMultipliers ? (
            <>
              {renderSummaryRow({
                label: t("logs.billingDetails.baseTotal"),
                primary: baseTotal,
                className: costRows.length > 0 ? "border-t border-border/60 pt-2" : undefined,
              })}

              <div className="space-y-2 rounded-md border border-border/60 bg-muted/40 p-2">
                {activeMultiplierRows.map((row) => (
                  <div key={row.key} className="flex items-center justify-between gap-3">
                    <span className="text-[11px] text-muted-foreground">{row.label}</span>
                    <span className={cn(amountClassName, "text-[11px]")}>{row.value}</span>
                  </div>
                ))}
              </div>

              {renderSummaryRow({
                label: totalCostLabel,
                primary: finalTotal,
                secondary: baseTotal,
                secondaryClassName: "line-through",
                emphasize: true,
                className: "border-t border-border/60 pt-2",
              })}
            </>
          ) : (
            renderSummaryRow({
              label: totalCostLabel,
              primary: finalTotal,
              emphasize: true,
              className: costRows.length > 0 ? "border-t border-border/60 pt-2" : undefined,
            })
          )}

          {hedgeSection}
        </div>
      </TooltipContent>
    );
  };

  return (
    <div className="space-y-4">
      {/* Status bar */}
      {hideStatusBar ? null : (
        <div className="flex items-center justify-between text-xs text-muted-foreground/70 px-3 pt-2">
          <span>{t("logs.table.loadedCount", { count: allLogs.length })}</span>
          {isFetchingNextPage && (
            <span className="flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("logs.table.loadingMore")}
            </span>
          )}
          {!hasNextPage && allLogs.length > 0 && <span>{t("logs.table.noMoreData")}</span>}
        </div>
      )}

      {/* Table with virtual scrolling */}
      <div className="overflow-x-auto">
        <div className="min-w-[800px]">
          {/* Fixed header */}
          <div className="bg-muted/30 border-b sticky top-0 z-10">
            <div className="flex items-center h-8 text-[11px] font-medium text-muted-foreground/80 tracking-wide">
              <div className="flex-[0.6] min-w-[56px] pl-3 truncate" title={t("logs.columns.time")}>
                {t("logs.columns.time")}
              </div>
              {hideUserColumn ? null : (
                <div
                  className="flex-[0.8] min-w-[50px] px-1.5 truncate"
                  title={t("logs.columns.user")}
                >
                  {t("logs.columns.user")}
                </div>
              )}
              {hideKeyColumn ? null : (
                <div
                  className="flex-[0.6] min-w-[50px] px-1.5 truncate"
                  title={t("logs.columns.key")}
                >
                  {t("logs.columns.key")}
                </div>
              )}
              {hideSessionIdColumn ? null : (
                <div
                  className="flex-[0.8] min-w-[80px] px-1.5 truncate"
                  title={t("logs.columns.sessionId")}
                >
                  {t("logs.columns.sessionId")}
                </div>
              )}
              {hideIpColumn ? null : (
                <div
                  className="flex-[0.8] min-w-[90px] px-1.5 truncate"
                  title={t("logs.columns.ip")}
                >
                  {t("logs.columns.ip")}
                </div>
              )}
              {hideProviderColumn ? null : (
                <div
                  className="flex-[1.5] min-w-[100px] px-1.5 truncate"
                  title={t("logs.columns.provider")}
                >
                  {t("logs.columns.provider")}
                </div>
              )}
              <div
                className="flex-[1.6] min-w-[128px] px-1.5 truncate md:flex-[1.3] md:min-w-[100px]"
                title={t("logs.columns.model")}
              >
                {t("logs.columns.model")}
              </div>
              {hideTokensColumn ? null : (
                <div
                  className="flex-[0.7] min-w-[96px] text-right px-1.5 truncate"
                  title={t("logs.columns.tokens")}
                >
                  {t("logs.columns.tokens")}
                </div>
              )}
              {hideCacheColumn ? null : (
                <div
                  className="flex-[0.8] min-w-[70px] text-right px-1.5 truncate"
                  title={t("logs.columns.cache")}
                >
                  {t("logs.columns.cache")}
                </div>
              )}
              {hideCostColumn ? null : (
                <div
                  className="flex-[0.6] min-w-[50px] text-right px-1.5 truncate"
                  title={t("logs.columns.cost")}
                >
                  {t("logs.columns.cost")}
                </div>
              )}
              {hidePerformanceColumn ? null : (
                <div
                  className="flex-[0.8] min-w-[80px] text-right px-1.5 truncate"
                  title={t("logs.columns.performance")}
                >
                  {t("logs.columns.performance")}
                </div>
              )}
              <div
                className="flex-[0.7] min-w-[70px] pr-3 truncate"
                title={t("logs.columns.status")}
              >
                {t("logs.columns.status")}
              </div>
            </div>
          </div>

          {/* Virtualized body */}
          <div
            ref={parentRef}
            className={cn("h-[600px] overflow-auto", bodyClassName)}
            onScroll={handleScroll}
          >
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualItems.map((virtualRow) => {
                const isLoaderRow = virtualRow.index >= allLogs.length;
                const log = allLogs[virtualRow.index];

                if (isLoaderRow) {
                  return (
                    <div
                      key="loader"
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      className="flex items-center justify-center"
                    >
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  );
                }

                const isNonBilling = isNonBillingEndpoint(log.endpoint);
                const _isWarmupSkipped = log.blockedBy === "warmup";
                return (
                  <div
                    key={log.id}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className={cn(
                      "flex items-center text-sm border-b border-border/40 transition-colors hover:bg-accent/50",
                      isNonBilling ? "bg-muted/30 text-muted-foreground dark:bg-muted/15" : ""
                    )}
                  >
                    {/* Time */}
                    <div className="flex-[0.6] min-w-[56px] font-mono text-xs truncate pl-3">
                      <RelativeTime date={log.createdAt} fallback="-" format="short" />
                    </div>

                    {/* User */}
                    {hideUserColumn ? null : (
                      <div
                        className="flex-[0.8] min-w-[50px] text-sm truncate px-1.5"
                        title={log.userName}
                      >
                        {log.userName}
                      </div>
                    )}

                    {/* Key */}
                    {hideKeyColumn ? null : (
                      <div
                        className="flex-[0.6] min-w-[50px] font-mono text-xs truncate px-1.5"
                        title={log.keyName}
                      >
                        {log.keyName}
                      </div>
                    )}

                    {/* Session ID */}
                    {hideSessionIdColumn ? null : (
                      <div className="flex-[0.8] min-w-[80px] px-1.5">
                        {log.sessionId ? (
                          <TooltipProvider>
                            <Tooltip delayDuration={300}>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className="w-full text-left font-mono text-xs truncate cursor-pointer hover:underline"
                                  data-session-id={log.sessionId}
                                  onClick={handleCopySessionIdClick}
                                >
                                  {log.sessionId}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent
                                side="bottom"
                                align="start"
                                variant="popover"
                                className="max-w-[500px]"
                              >
                                <p className="text-xs whitespace-normal break-words font-mono">
                                  {log.sessionId}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground">-</span>
                        )}
                      </div>
                    )}

                    {/* IP */}
                    {hideIpColumn ? null : (
                      <div className="flex-[0.8] min-w-[90px] px-1.5 overflow-hidden">
                        <IpDisplayTrigger
                          ip={log.clientIp}
                          onClick={() => {
                            setIpDialogValue(log.clientIp as string);
                            setIpDialogOpen(true);
                          }}
                        />
                      </div>
                    )}

                    {/* Provider */}
                    {hideProviderColumn ? null : (
                      <div className="flex-[1.2] min-w-[84px] px-1.5 md:flex-[1.5] md:min-w-[100px]">
                        {log.blockedBy ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-orange-100 dark:bg-orange-950 px-2 py-1 text-xs font-medium text-orange-700 dark:text-orange-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-orange-600 dark:bg-orange-400" />
                            {t("logs.table.blocked")}
                          </span>
                        ) : !isProviderFinalized(log) ? (
                          log._liveChain ? (
                            <div className="flex items-center gap-1.5 min-w-0">
                              <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />
                              <span className="text-xs text-muted-foreground truncate">
                                {log._liveChain.chain.length > 0
                                  ? log._liveChain.chain[log._liveChain.chain.length - 1].name
                                  : t("logs.details.inProgress")}
                              </span>
                              {log._liveChain.phase === "retrying" && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] px-1 py-0 shrink-0 text-amber-500 border-amber-300"
                                >
                                  {t("logs.details.retrying")}
                                </Badge>
                              )}
                              {log._liveChain.phase === "hedge_racing" && (
                                <GitBranch className="h-3 w-3 shrink-0 text-indigo-500" />
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              {t("logs.details.inProgress")}
                            </span>
                          )
                        ) : (
                          <div className="flex flex-col items-start gap-0.5 min-w-0">
                            <div className="flex items-center gap-1 min-w-0 w-full overflow-hidden">
                              {(() => {
                                // 计算倍率，用于判断是否显示 Badge
                                const successfulProvider =
                                  log.providerChain && log.providerChain.length > 0
                                    ? [...log.providerChain]
                                        .reverse()
                                        .find(
                                          (item) =>
                                            item.reason === "request_success" ||
                                            item.reason === "retry_success" ||
                                            item.reason === "hedge_winner"
                                        )
                                    : null;
                                const actualCostMultiplier =
                                  successfulProvider?.costMultiplier ?? log.costMultiplier;
                                const multiplier =
                                  actualCostMultiplier === "" || actualCostMultiplier == null
                                    ? null
                                    : Number(actualCostMultiplier);
                                const hasCostBadge =
                                  actualCostMultiplier !== "" &&
                                  actualCostMultiplier != null &&
                                  Number.isFinite(multiplier) &&
                                  multiplier !== 1;
                                const showBadgeInTable = shouldShowCostBadgeInCell(
                                  log.providerChain,
                                  multiplier
                                );

                                return (
                                  <>
                                    <div className="flex-1 min-w-0 overflow-hidden">
                                      <ProviderChainPopover
                                        chain={log.providerChain ?? []}
                                        finalProvider={
                                          getFinalProviderName(log.providerChain ?? []) ||
                                          log.providerName ||
                                          tChain("circuit.unknown")
                                        }
                                        hasCostBadge={hasCostBadge}
                                        onChainItemClick={(chainIndex) => {
                                          setDialogState({
                                            logId: log.id,
                                            scrollToRedirect: false,
                                            targetTab: "logic-trace",
                                            expandedChainIndex: chainIndex,
                                          });
                                        }}
                                      />
                                    </div>
                                    {/* Cost multiplier badge - only show when no retry */}
                                    {showBadgeInTable && (
                                      <Badge
                                        variant="outline"
                                        className={
                                          multiplier! > 1
                                            ? "text-[10px] px-1 py-0 bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-800 shrink-0"
                                            : "text-[10px] px-1 py-0 bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-800 shrink-0"
                                        }
                                      >
                                        x{multiplier!.toFixed(2)}
                                      </Badge>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Model */}
                    <div className="flex-[1.6] min-w-[128px] font-mono text-xs px-1.5 md:flex-[1.3] md:min-w-[100px]">
                      <div className="flex min-w-0 items-start gap-1">
                        <ModelDisplayWithRedirect
                          originalModel={log.originalModel}
                          currentModel={log.model}
                          actualResponseModel={log.actualResponseModel}
                          billingModelSource={billingModelSource}
                          specialSettings={log.specialSettings}
                          reasoningOutputTokens={log.reasoningOutputTokens}
                          onRedirectClick={
                            disableDetailDialog
                              ? undefined
                              : () => setDialogState({ logId: log.id, scrollToRedirect: true })
                          }
                        />
                      </div>
                    </div>

                    {/* Tokens */}
                    {hideTokensColumn ? null : (
                      <div className="flex-[0.7] min-w-[112px] text-right text-xs px-1.5">
                        {(() => {
                          const tokenRows = compactMetricRows([
                            hasTokenValue(log.inputTokens)
                              ? {
                                  key: "input",
                                  label: t("logs.table.metricLabels.input"),
                                  value: formatTokenAmount(log.inputTokens),
                                }
                              : null,
                            hasTokenValue(log.outputTokens)
                              ? {
                                  key: "output",
                                  label: t("logs.table.metricLabels.output"),
                                  value: formatTokenAmount(log.outputTokens),
                                  tone: "muted",
                                  valueSlot: "logs-token-output-inline",
                                }
                              : null,
                            hasPositiveReasoningTokens(log.reasoningOutputTokens)
                              ? {
                                  key: "reasoning",
                                  label: t("logs.table.metricLabels.reasoning"),
                                  value: formatTokenAmount(log.reasoningOutputTokens),
                                  tone: "muted",
                                  valueSlot: "logs-token-reasoning-inline",
                                }
                              : null,
                          ]);

                          return (
                            <TooltipProvider>
                              <Tooltip delayDuration={250}>
                                <TooltipTrigger asChild>
                                  <div className="cursor-help" data-slot="logs-token-cell">
                                    <CompactMetricRows
                                      rows={tokenRows}
                                      emptyLabel={t("logs.table.emptyValue")}
                                    />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent
                                  align="end"
                                  variant="popover"
                                  className="text-xs space-y-1"
                                >
                                  <div>
                                    {t("logs.billingDetails.input")}:{" "}
                                    {formatTokenAmount(log.inputTokens)}
                                  </div>
                                  <div>
                                    {t("logs.billingDetails.output")}:{" "}
                                    {formatTokenAmount(log.outputTokens)}
                                  </div>
                                  {hasPositiveReasoningTokens(log.reasoningOutputTokens) ? (
                                    <div className="pl-3 text-muted-foreground space-y-0.5">
                                      <div>
                                        {t("logs.billingDetails.reasoningTokens")}:{" "}
                                        {formatTokenAmount(log.reasoningOutputTokens)}
                                      </div>
                                      <div className="text-[11px] text-muted-foreground/90">
                                        {t("logs.billingDetails.includedInOutputShort")}
                                      </div>
                                    </div>
                                  ) : null}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          );
                        })()}
                      </div>
                    )}

                    {/* Cache */}
                    {hideCacheColumn ? null : (
                      <div className="flex-[0.8] min-w-[112px] text-right text-xs px-1.5">
                        {(() => {
                          const ttlBadge = log.cacheTtlApplied ? (
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] leading-tight px-1",
                                log.swapCacheTtlApplied
                                  ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800"
                                  : "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800"
                              )}
                              title={
                                log.swapCacheTtlApplied
                                  ? t("logs.billingDetails.cacheTtlSwapped")
                                  : undefined
                              }
                            >
                              {log.cacheTtlApplied}
                              {log.swapCacheTtlApplied ? " ~" : ""}
                            </Badge>
                          ) : null;
                          const cacheRows = compactMetricRows([
                            hasTokenValue(log.cacheCreationInputTokens)
                              ? {
                                  key: "cache-write",
                                  label: t("logs.table.metricLabels.cacheWrite"),
                                  labelExtra: ttlBadge,
                                  value: formatTokenAmount(log.cacheCreationInputTokens),
                                }
                              : null,
                            hasTokenValue(log.cacheReadInputTokens)
                              ? {
                                  key: "cache-read",
                                  label: t("logs.table.metricLabels.cacheRead"),
                                  value: formatTokenAmount(log.cacheReadInputTokens),
                                  tone: "muted",
                                }
                              : null,
                          ]);

                          return (
                            <TooltipProvider>
                              <Tooltip delayDuration={250}>
                                <TooltipTrigger asChild>
                                  <div className="cursor-help">
                                    <CompactMetricRows
                                      rows={cacheRows}
                                      emptyLabel={t("logs.table.emptyValue")}
                                    />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent
                                  align="end"
                                  variant="popover"
                                  className="text-xs space-y-1"
                                >
                                  <div className="font-medium">{t("logs.columns.cacheWrite")}</div>
                                  <div className="pl-2">
                                    5m:{" "}
                                    {formatTokenAmount(
                                      (log.cacheCreation5mInputTokens ?? 0) > 0
                                        ? log.cacheCreation5mInputTokens
                                        : log.cacheTtlApplied !== "1h"
                                          ? log.cacheCreationInputTokens
                                          : 0
                                    )}
                                  </div>
                                  <div className="pl-2">
                                    1h:{" "}
                                    {formatTokenAmount(
                                      (log.cacheCreation1hInputTokens ?? 0) > 0
                                        ? log.cacheCreation1hInputTokens
                                        : log.cacheTtlApplied === "1h"
                                          ? log.cacheCreationInputTokens
                                          : 0
                                    )}
                                  </div>
                                  <div className="font-medium mt-1">
                                    {t("logs.columns.cacheRead")}
                                  </div>
                                  <div className="pl-2">
                                    {formatTokenAmount(log.cacheReadInputTokens)}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          );
                        })()}
                      </div>
                    )}

                    {/* Cost */}
                    {hideCostColumn ? null : (
                      <div className="flex-[0.6] min-w-[50px] text-right font-mono text-xs px-1.5">
                        {isNonBilling ? (
                          "-"
                        ) : log.costUsd != null ? (
                          <TooltipProvider>
                            <Tooltip delayDuration={250}>
                              <TooltipTrigger asChild>
                                <span className="cursor-help inline-flex items-center gap-1">
                                  {formatCurrency(log.costUsd, currencyCode, 6)}
                                  {hasPriorityServiceTierSpecialSetting(log.specialSettings) && (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] leading-tight px-1 bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-800"
                                      title={t("logs.billingDetails.fastPriority")}
                                    >
                                      {t("logs.billingDetails.fast")}
                                    </Badge>
                                  )}
                                  {log.context1mApplied && (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] leading-tight px-1 bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-800"
                                    >
                                      1M
                                    </Badge>
                                  )}
                                </span>
                              </TooltipTrigger>
                              {renderCostTooltip(log)}
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          "-"
                        )}
                      </div>
                    )}

                    {/* Performance */}
                    {hidePerformanceColumn ? null : (
                      <div className="flex-[0.8] min-w-[112px] text-right text-xs px-1.5">
                        {(() => {
                          const rate = calculateOutputRate(
                            log.outputTokens,
                            log.durationMs,
                            log.ttfbMs
                          );
                          const hideRate = shouldHideOutputRate(rate, log.durationMs, log.ttfbMs);
                          const performanceRows = compactMetricRows([
                            log.durationMs != null
                              ? {
                                  key: "duration",
                                  label: t("logs.table.metricLabels.duration"),
                                  value: formatDuration(log.durationMs),
                                }
                              : null,
                            log.ttfbMs != null && log.ttfbMs > 0
                              ? {
                                  key: "ttfb",
                                  label: t("logs.table.metricLabels.ttfb"),
                                  value: formatDuration(log.ttfbMs),
                                  tone: "muted",
                                }
                              : null,
                            rate !== null && !hideRate
                              ? {
                                  key: "rate",
                                  label: t("logs.table.metricLabels.rate"),
                                  value: `${rate.toFixed(0)} tok/s`,
                                  tone: "muted",
                                }
                              : null,
                          ]);

                          return (
                            <TooltipProvider>
                              <Tooltip delayDuration={250}>
                                <TooltipTrigger asChild>
                                  <div className="cursor-help">
                                    <CompactMetricRows
                                      rows={performanceRows}
                                      emptyLabel={t("logs.table.emptyValue")}
                                    />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent
                                  align="end"
                                  variant="popover"
                                  className="text-xs space-y-1"
                                >
                                  <div>
                                    {t("logs.details.performance.duration")}:{" "}
                                    {formatDuration(log.durationMs)}
                                  </div>
                                  {log.ttfbMs != null && (
                                    <div>
                                      {t("logs.details.performance.ttfb")}:{" "}
                                      {formatDuration(log.ttfbMs)}
                                    </div>
                                  )}
                                  {rate !== null && !hideRate && (
                                    <div>
                                      {t("logs.details.performance.outputRate")}: {rate.toFixed(1)}{" "}
                                      tok/s
                                    </div>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          );
                        })()}
                      </div>
                    )}

                    {/* Status */}
                    <div className="flex-[0.7] min-w-[70px] pr-3">
                      {disableDetailDialog ? (
                        <StatusBadgeOnly statusCode={log.statusCode} />
                      ) : (
                        <ErrorDetailsDialog
                          statusCode={log.statusCode}
                          errorMessage={log.errorMessage}
                          providerChain={log.providerChain}
                          sessionId={log.sessionId}
                          requestSequence={log.requestSequence}
                          blockedBy={log.blockedBy}
                          blockedReason={log.blockedReason}
                          originalModel={log.originalModel}
                          currentModel={log.model}
                          actualResponseModel={log.actualResponseModel}
                          userAgent={log.userAgent}
                          clientIp={log.clientIp}
                          messagesCount={log.messagesCount}
                          endpoint={log.endpoint}
                          billingModelSource={billingModelSource}
                          specialSettings={log.specialSettings}
                          inputTokens={log.inputTokens}
                          outputTokens={log.outputTokens}
                          reasoningOutputTokens={log.reasoningOutputTokens}
                          cacheCreationInputTokens={log.cacheCreationInputTokens}
                          cacheCreation5mInputTokens={log.cacheCreation5mInputTokens}
                          cacheCreation1hInputTokens={log.cacheCreation1hInputTokens}
                          cacheReadInputTokens={log.cacheReadInputTokens}
                          cacheTtlApplied={log.cacheTtlApplied}
                          swapCacheTtlApplied={log.swapCacheTtlApplied}
                          costUsd={log.costUsd}
                          costMultiplier={log.costMultiplier}
                          groupCostMultiplier={log.groupCostMultiplier}
                          costBreakdown={log.costBreakdown}
                          hedgeLosers={log.hedgeLosers}
                          context1mApplied={log.context1mApplied}
                          durationMs={log.durationMs}
                          ttfbMs={log.ttfbMs}
                          externalOpen={dialogState.logId === log.id ? true : undefined}
                          onExternalOpenChange={(open) => {
                            if (!open) setDialogState({ logId: null, scrollToRedirect: false });
                          }}
                          scrollToRedirect={
                            dialogState.logId === log.id && dialogState.scrollToRedirect
                          }
                          initialTab={
                            dialogState.logId === log.id ? dialogState.targetTab : undefined
                          }
                          initialExpandedChainIndex={
                            dialogState.logId === log.id
                              ? dialogState.expandedChainIndex
                              : undefined
                          }
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Scroll to top button */}
      {hideScrollToTop ? null : showScrollToTop ? (
        <Button
          variant="outline"
          size="sm"
          className="fixed bottom-8 right-8 shadow-lg z-50"
          onClick={scrollToTop}
        >
          <ArrowUp className="h-4 w-4 mr-1" />
          {t("logs.table.scrollToTop")}
        </Button>
      ) : null}

      <IpDetailsDialog
        ip={ipDialogValue}
        open={ipDialogOpen}
        onOpenChange={setIpDialogOpen}
        lookupMode={ipLookupMode}
      />
    </div>
  );
}
