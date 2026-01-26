"use client";

import { useEffect, useState } from "react";
import { getUserAllLimitUsage } from "@/actions/users";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type LimitType = "5h" | "daily" | "weekly" | "monthly" | "total";

export interface UserLimitBadgeProps {
  userId: number;
  limitType: LimitType;
  limit: number | null;
  label: string;
  unit?: string;
}

interface LimitUsageData {
  limit5h: { usage: number; limit: number | null };
  limitDaily: { usage: number; limit: number | null };
  limitWeekly: { usage: number; limit: number | null };
  limitMonthly: { usage: number; limit: number | null };
  limitTotal: { usage: number; limit: number | null };
}

// Global cache for user limit usage data
const usageCache = new Map<number, { data: LimitUsageData; timestamp: number }>();
const CACHE_TTL = 60 * 1000; // 1 minute

export function clearUsageCache(userId?: number): void {
  if (userId !== undefined) {
    usageCache.delete(userId);
  } else {
    usageCache.clear();
  }
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
  unit = "$",
}: UserLimitBadgeProps) {
  const [usageData, setUsageData] = useState<LimitUsageData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    // If no limit is set, don't fetch usage data
    if (limit === null || limit === undefined) {
      return;
    }

    // Check cache first
    const cached = usageCache.get(userId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      // Reset error/loading state when using cached data
      setError(false);
      setIsLoading(false);
      setUsageData((prev) => (prev === cached.data ? prev : cached.data));
      return;
    }

    setIsLoading(true);
    setError(false);

    getUserAllLimitUsage(userId)
      .then((res) => {
        if (res.ok && res.data) {
          usageCache.set(userId, { data: res.data, timestamp: Date.now() });
          setUsageData(res.data);
        } else {
          setError(true);
        }
      })
      .catch(() => {
        setError(true);
      })
      .finally(() => {
        setIsLoading(false);
      });
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
