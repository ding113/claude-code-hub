"use client";

import { BarChart3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { getUsageLogsStats } from "@/actions/usage-logs";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTokenAmount } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/utils/currency";
import { formatCurrency } from "@/lib/utils/currency";
import type { UsageLogSummary } from "@/repository/usage-logs";

interface UsageLogsStatsPanelProps {
  filters: {
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
  };
  currencyCode?: CurrencyCode;
}

export function UsageLogsStatsPanel({ filters, currencyCode = "USD" }: UsageLogsStatsPanelProps) {
  const t = useTranslations("dashboard");
  const [stats, setStats] = useState<UsageLogSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filtersKey = JSON.stringify(filters);

  const loadStats = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await getUsageLogsStats(filters);
      if (result.ok && result.data) {
        setStats(result.data);
      } else {
        setError(!result.ok ? result.error : t("logs.error.loadFailed"));
      }
    } catch (err) {
      console.error("Failed to load usage logs stats:", err);
      setError(t("logs.error.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [filters, t]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: filtersKey is used to detect filter changes
  useEffect(() => {
    loadStats();
  }, [filtersKey, loadStats]);

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border/50 bg-card/30 text-sm flex-wrap">
      <BarChart3 className="h-4 w-4 text-muted-foreground shrink-0" />
      {isLoading ? (
        <div className="flex items-center gap-4 flex-wrap">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-28" />
        </div>
      ) : error ? (
        <span className="text-destructive">{error}</span>
      ) : stats ? (
        <StatsContent stats={stats} currencyCode={currencyCode} />
      ) : null}
    </div>
  );
}

function StatsContent({
  stats,
  currencyCode,
}: {
  stats: UsageLogSummary;
  currencyCode: CurrencyCode;
}) {
  const t = useTranslations("dashboard");

  return (
    <div className="flex items-center gap-x-4 gap-y-1 flex-wrap">
      <StatItem
        label={t("logs.stats.totalRequests")}
        value={stats.totalRequests.toLocaleString()}
      />

      <Separator />

      <StatItem
        label={t("logs.stats.totalAmount")}
        value={formatCurrency(stats.totalCost, currencyCode)}
      />

      <Separator />

      <StatItem
        label={t("logs.stats.totalTokens")}
        value={formatTokenAmount(stats.totalTokens)}
        detail={`${t("logs.stats.input")} ${formatTokenAmount(stats.totalInputTokens)} / ${t("logs.stats.output")} ${formatTokenAmount(stats.totalOutputTokens)}`}
      />

      <Separator />

      <StatItem
        label={t("logs.stats.cacheTokens")}
        value={formatTokenAmount(stats.totalCacheCreationTokens + stats.totalCacheReadTokens)}
        detail={`${t("logs.stats.write")} ${formatTokenAmount(stats.totalCacheCreationTokens)} / ${t("logs.stats.read")} ${formatTokenAmount(stats.totalCacheReadTokens)}`}
      />
    </div>
  );
}

function StatItem({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">{value}</span>
      {detail ? <span className="text-xs text-muted-foreground/70">({detail})</span> : null}
    </span>
  );
}

function Separator() {
  return <span className="text-border hidden sm:inline">|</span>;
}
