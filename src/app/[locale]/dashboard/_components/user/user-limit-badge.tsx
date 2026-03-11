"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getSharedUserLimitUsage,
  type LimitUsageData,
  peekCachedUserLimitUsage,
} from "@/lib/dashboard/user-limit-usage-cache";
import { cn } from "@/lib/utils";

export type LimitType = "5h" | "daily" | "weekly" | "monthly" | "total";

export interface UserLimitBadgeProps {
  userId: number;
  limitType: LimitType;
  limit: number | null;
  label: string;
  unit?: string;
}

function formatPercentage(usage: number, limit: number): string {
  const percentage = Math.min(Math.round((usage / limit) * 100), 999);
  return `${percentage}%`;
}

function formatValue(value: number, unit?: string): string {
  if (!Number.isFinite(value)) return String(value);
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.00$/, "");
  return unit ? `${unit}${formatted}` : formatted;
}

function getPercentageColor(usage: number, limit: number): string {
  const percentage = (usage / limit) * 100;
  if (percentage >= 100) return "text-destructive";
  if (percentage >= 80) return "text-orange-600";
  return "";
}

function getLimitTypeKey(limitType: LimitType): keyof LimitUsageData {
  const mapping: Record<LimitType, keyof LimitUsageData> = {
    "5h": "limit5h",
    daily: "limitDaily",
    weekly: "limitWeekly",
    monthly: "limitMonthly",
    total: "limitTotal",
  };
  return mapping[limitType];
}

export function UserLimitBadge({
  userId,
  limitType,
  limit,
  label,
  unit = "",
}: UserLimitBadgeProps) {
  const [usageData, setUsageData] = useState<LimitUsageData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    // If no limit is set, don't fetch usage data
    if (limit === null || limit === undefined) {
      return;
    }

    // Check cache first
    const cached = peekCachedUserLimitUsage(userId);
    if (cached) {
      // Reset error/loading state when using cached data
      setError(false);
      setIsLoading(false);
      setUsageData((prev) => (prev === cached ? prev : cached));
      return;
    }

    setIsLoading(true);
    setError(false);

    getSharedUserLimitUsage(userId)
      .then((data) => {
        if (isCancelled) {
          return;
        }

        if (data) {
          setUsageData(data);
        } else {
          setError(true);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setError(true);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [userId, limit]);

  // No limit set - show "-"
  if (limit === null || limit === undefined) {
    return (
      <Badge
        variant="outline"
        className="px-2 py-0.5 tabular-nums text-xs"
        title={`${label}: -`}
        aria-label={`${label}: -`}
      >
        -
      </Badge>
    );
  }

  // Loading state
  if (isLoading) {
    return <Skeleton className="h-5 w-12" />;
  }

  // Error state - show just the limit value
  if (error || !usageData) {
    return (
      <Badge
        variant="secondary"
        className="px-2 py-0.5 tabular-nums text-xs"
        title={`${label}: ${formatValue(limit, unit)}`}
        aria-label={`${label}: ${formatValue(limit, unit)}`}
      >
        {formatValue(limit, unit)}
      </Badge>
    );
  }

  // Get usage for this limit type
  const key = getLimitTypeKey(limitType);
  const typeData = usageData[key];
  const usage = typeData?.usage ?? 0;

  // Calculate percentage
  const percentage = formatPercentage(usage, limit);
  const colorClass = getPercentageColor(usage, limit);
  const statusText = `${formatValue(usage, unit)} / ${formatValue(limit, unit)}`;

  return (
    <Badge
      variant="secondary"
      className={cn("px-2 py-0.5 tabular-nums text-xs", colorClass)}
      title={`${label}: ${statusText}`}
      aria-label={`${label}: ${statusText}`}
    >
      {percentage}
    </Badge>
  );
}
