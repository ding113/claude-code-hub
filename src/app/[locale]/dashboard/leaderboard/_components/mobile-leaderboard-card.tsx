"use client";

import { Award, ChevronDown, ChevronUp, Medal, Trophy } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn, formatTokenAmount } from "@/lib/utils";
import type {
  LeaderboardEntry,
  ModelLeaderboardEntry,
  ProviderCacheHitRateLeaderboardEntry,
  ProviderLeaderboardEntry,
} from "@/repository/leaderboard";

type LeaderboardScope = "user" | "provider" | "providerCacheHitRate" | "model";

type UserEntry = LeaderboardEntry & { totalCostFormatted?: string };
type ProviderEntry = ProviderLeaderboardEntry & { totalCostFormatted?: string };
type ProviderCacheHitRateEntry = ProviderCacheHitRateLeaderboardEntry;
type ModelEntry = ModelLeaderboardEntry & { totalCostFormatted?: string };
type AnyEntry = UserEntry | ProviderEntry | ProviderCacheHitRateEntry | ModelEntry;

export interface MobileLeaderboardCardProps {
  rank: number;
  data: AnyEntry;
  scope: LeaderboardScope;
  expanded: boolean;
  onToggle: () => void;
}

export function MobileLeaderboardCard({
  rank,
  data,
  scope,
  expanded,
  onToggle,
}: MobileLeaderboardCardProps) {
  const t = useTranslations("dashboard.leaderboard");
  const isTopThree = rank <= 3;

  const getRankIcon = () => {
    if (rank === 1) return <Trophy className="h-4 w-4 text-yellow-500" />;
    if (rank === 2) return <Medal className="h-4 w-4 text-gray-400" />;
    if (rank === 3) return <Award className="h-4 w-4 text-orange-600" />;
    return null;
  };

  const getName = (): string => {
    switch (scope) {
      case "user":
        return (data as UserEntry).userName;
      case "provider":
      case "providerCacheHitRate":
        return (data as ProviderEntry | ProviderCacheHitRateEntry).providerName;
      case "model":
        return (data as ModelEntry).model;
    }
  };

  const getPrimaryMetric = (): string => {
    switch (scope) {
      case "user": {
        const entry = data as UserEntry;
        return entry.totalCostFormatted ?? `$${Number(entry.totalCost).toFixed(2)}`;
      }
      case "provider": {
        const entry = data as ProviderEntry;
        return entry.totalCostFormatted ?? `$${Number(entry.totalCost).toFixed(2)}`;
      }
      case "providerCacheHitRate": {
        const entry = data as ProviderCacheHitRateEntry;
        return `${(Number(entry.cacheHitRate || 0) * 100).toFixed(1)}%`;
      }
      case "model": {
        const entry = data as ModelEntry;
        return entry.totalCostFormatted ?? `$${Number(entry.totalCost).toFixed(2)}`;
      }
    }
  };

  const renderExpandedContent = () => {
    switch (scope) {
      case "user": {
        const entry = data as UserEntry;
        return (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-muted-foreground">{t("columns.requests")}</div>
              <div className="font-mono">{entry.totalRequests.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-muted-foreground">{t("columns.tokens")}</div>
              <div className="font-mono">{formatTokenAmount(entry.totalTokens)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">{t("columns.cost")}</div>
              <div className="font-mono">
                {entry.totalCostFormatted ?? `$${Number(entry.totalCost).toFixed(2)}`}
              </div>
            </div>
          </div>
        );
      }
      case "provider": {
        const entry = data as ProviderEntry;
        return (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-muted-foreground">{t("columns.requests")}</div>
              <div className="font-mono">{entry.totalRequests.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-muted-foreground">{t("columns.cost")}</div>
              <div className="font-mono">
                {entry.totalCostFormatted ?? `$${Number(entry.totalCost).toFixed(2)}`}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">{t("columns.tokens")}</div>
              <div className="font-mono">{formatTokenAmount(entry.totalTokens)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">{t("columns.successRate")}</div>
              <div className="font-mono">
                {`${(Number(entry.successRate || 0) * 100).toFixed(1)}%`}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">{t("columns.avgTtfbMs")}</div>
              <div className="font-mono">
                {entry.avgTtfbMs && entry.avgTtfbMs > 0
                  ? `${Math.round(entry.avgTtfbMs).toLocaleString()} ms`
                  : "-"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">{t("columns.avgTokensPerSecond")}</div>
              <div className="font-mono">
                {entry.avgTokensPerSecond && entry.avgTokensPerSecond > 0
                  ? `${entry.avgTokensPerSecond.toFixed(1)} tok/s`
                  : "-"}
              </div>
            </div>
          </div>
        );
      }
      case "providerCacheHitRate": {
        const entry = data as ProviderCacheHitRateEntry;
        return (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-muted-foreground">{t("columns.cacheHitRequests")}</div>
              <div className="font-mono">{entry.totalRequests.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-muted-foreground">{t("columns.cacheHitRate")}</div>
              <div className="font-mono">
                {`${(Number(entry.cacheHitRate || 0) * 100).toFixed(1)}%`}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">{t("columns.cacheReadTokens")}</div>
              <div className="font-mono">{formatTokenAmount(entry.cacheReadTokens)}</div>
            </div>
            <div className="col-span-3">
              <div className="text-muted-foreground">{t("columns.totalTokens")}</div>
              <div className="font-mono">{formatTokenAmount(entry.totalInputTokens)}</div>
            </div>
          </div>
        );
      }
      case "model": {
        const entry = data as ModelEntry;
        return (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-muted-foreground">{t("columns.requests")}</div>
              <div className="font-mono">{entry.totalRequests.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-muted-foreground">{t("columns.tokens")}</div>
              <div className="font-mono">{formatTokenAmount(entry.totalTokens)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">{t("columns.cost")}</div>
              <div className="font-mono">
                {entry.totalCostFormatted ?? `$${Number(entry.totalCost).toFixed(2)}`}
              </div>
            </div>
            <div className="col-span-3">
              <div className="text-muted-foreground">{t("columns.successRate")}</div>
              <div className="font-mono">
                {`${(Number(entry.successRate || 0) * 100).toFixed(1)}%`}
              </div>
            </div>
          </div>
        );
      }
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      className={cn(
        "rounded-lg border p-3 cursor-pointer transition-colors",
        "hover:bg-muted/50 active:bg-muted/70",
        isTopThree && "bg-muted/50"
      )}
    >
      {/* Collapsed header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {getRankIcon()}
          <Badge
            variant={isTopThree ? "default" : "outline"}
            className={cn(
              "min-w-[32px] justify-center",
              rank === 1 && "bg-yellow-500 hover:bg-yellow-600",
              rank === 2 && "bg-gray-400 hover:bg-gray-500 text-white",
              rank === 3 && "bg-orange-600 hover:bg-orange-700 text-white"
            )}
          >
            #{rank}
          </Badge>
          <span className="font-medium truncate">{getName()}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="font-mono text-sm font-bold">{getPrimaryMetric()}</span>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && <div className="mt-3 pt-3 border-t">{renderExpandedContent()}</div>}
    </div>
  );
}
