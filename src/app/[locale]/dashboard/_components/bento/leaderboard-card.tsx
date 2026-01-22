"use client";

import { Award, ChevronRight, Medal, Trophy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn, formatCurrency, formatTokenAmount } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/utils/currency";
import { BentoCard } from "./bento-grid";

interface LeaderboardEntry {
  id: string | number;
  name: string;
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
}

interface LeaderboardCardProps {
  title: string;
  entries: LeaderboardEntry[];
  currencyCode: CurrencyCode;
  isLoading?: boolean;
  emptyText?: string;
  viewAllHref?: string;
  maxItems?: number;
  accentColor?: "primary" | "purple" | "blue";
  className?: string;
}

const accentColors = {
  primary: {
    bar: "bg-primary",
    progress: "bg-muted/40 dark:bg-white/10",
  },
  purple: {
    bar: "bg-purple-500",
    progress: "bg-muted/40 dark:bg-white/10",
  },
  blue: {
    bar: "bg-blue-500",
    progress: "bg-muted/40 dark:bg-white/10",
  },
};

const rankConfig = [
  {
    icon: Trophy,
    iconColor: "text-amber-500",
    bgColor: "bg-amber-500/10 dark:bg-amber-500/20",
    borderColor: "border-amber-500/20",
  },
  {
    icon: Medal,
    iconColor: "text-slate-400",
    bgColor: "bg-slate-400/10 dark:bg-slate-400/20",
    borderColor: "border-slate-400/20",
  },
  {
    icon: Award,
    iconColor: "text-orange-600",
    bgColor: "bg-orange-600/10 dark:bg-orange-600/20",
    borderColor: "border-orange-600/20",
  },
];

function RankBadge({ rank }: { rank: number }) {
  const config = rankConfig[rank - 1];

  if (!config) {
    return (
      <div className="flex items-center justify-center h-7 w-7 rounded-md bg-muted/50 text-xs font-medium text-muted-foreground">
        #{rank}
      </div>
    );
  }

  const Icon = config.icon;

  return (
    <div
      className={cn(
        "flex items-center justify-center h-7 w-7 rounded-md border",
        config.bgColor,
        config.borderColor
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", config.iconColor)} />
    </div>
  );
}

function LeaderboardItem({
  entry,
  rank,
  maxCost,
  currencyCode,
  accentColor,
}: {
  entry: LeaderboardEntry;
  rank: number;
  maxCost: number;
  currencyCode: CurrencyCode;
  accentColor: "primary" | "purple" | "blue";
}) {
  const percentage = maxCost > 0 ? (entry.totalCost / maxCost) * 100 : 0;
  const colors = accentColors[accentColor];
  const t = useTranslations("dashboard.leaderboard");

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-2 rounded-lg transition-colors",
        "hover:bg-muted/30 dark:hover:bg-white/[0.03]"
      )}
    >
      <RankBadge rank={rank} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-medium truncate">{entry.name}</span>
          <span className="text-sm font-semibold tabular-nums ml-2">
            {formatCurrency(entry.totalCost, currencyCode)}
          </span>
        </div>

        {/* Progress Bar */}
        <div className={cn("w-full h-1.5 rounded-full overflow-hidden", colors.progress)}>
          <div
            className={cn("h-full rounded-full transition-all duration-500", colors.bar)}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>

        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-muted-foreground">
            {entry.totalRequests.toLocaleString()} {t("requests")}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {formatTokenAmount(entry.totalTokens)} {t("tokens")}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Leaderboard Card
 * Displays ranked list with progress bars and glass morphism
 */
export function LeaderboardCard({
  title,
  entries,
  currencyCode,
  isLoading,
  emptyText,
  viewAllHref,
  maxItems = 3,
  accentColor = "primary",
  className,
}: LeaderboardCardProps) {
  const router = useRouter();
  const t = useTranslations("dashboard.leaderboard");

  const displayEntries = entries.slice(0, maxItems);
  const maxCost = Math.max(...entries.map((e) => e.totalCost), 0);

  return (
    <BentoCard className={cn("flex flex-col", className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold">{title}</h4>
        {viewAllHref && (
          <button
            onClick={() => router.push(viewAllHref)}
            className="flex items-center gap-0.5 text-xs text-primary hover:text-primary/80 transition-colors cursor-pointer font-medium"
          >
            <span>{t("viewAll")}</span>
            <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col gap-1">
        {isLoading ? (
          // Loading Skeletons
          Array.from({ length: maxItems }).map((_, idx) => (
            <div key={idx} className="flex items-center gap-3 p-2">
              <div className="h-7 w-7 rounded-md bg-muted/50 animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-muted/50 rounded animate-pulse w-3/4" />
                <div className="h-1.5 bg-muted/50 rounded animate-pulse" />
              </div>
            </div>
          ))
        ) : displayEntries.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            {emptyText || t("noData")}
          </div>
        ) : (
          displayEntries.map((entry, idx) => (
            <LeaderboardItem
              key={entry.id}
              entry={entry}
              rank={idx + 1}
              maxCost={maxCost}
              currencyCode={currencyCode}
              accentColor={accentColor}
            />
          ))
        )}
      </div>
    </BentoCard>
  );
}
