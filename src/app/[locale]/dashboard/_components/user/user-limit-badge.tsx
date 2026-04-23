"use client";

import { useEffect, useState } from "react";
import { QuotaQuickEditPopover } from "@/components/quota/quota-quick-edit-popover";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  clearUsageCache,
  getSharedUserLimitUsage,
  type LimitUsageData,
  peekCachedUserLimitUsage,
} from "@/lib/dashboard/user-limit-usage-cache";
import { cn } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/utils/currency";

export type LimitType = "5h" | "daily" | "weekly" | "monthly" | "total";

export interface UserLimitBadgeProps {
  userId: number;
  limitType: LimitType;
  limit: number | null;
  label: string;
  unit?: string;
  /** 可选：允许点击编辑。传入 onSave 后，Badge 成为可点击触发器 */
  editable?: boolean;
  onSave?: (newLimit: number | null) => Promise<boolean>;
  currencyCode?: CurrencyCode;
  /** 编辑器的数值类型（默认 currency） */
  editUnit?: "currency" | "integer";
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
  editable = false,
  onSave,
  currencyCode = "USD",
  editUnit = "currency",
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
    const noLimitBadge = (
      <Badge
        variant="outline"
        className={cn(
          "px-2 py-0.5 tabular-nums text-xs",
          editable && onSave && "cursor-pointer hover:ring-1 hover:ring-ring"
        )}
        title={`${label}: -`}
        aria-label={`${label}: -`}
      >
        -
      </Badge>
    );
    if (editable && onSave) {
      return (
        <QuotaQuickEditPopover
          currentLimit={null}
          label={label}
          unit={editUnit}
          currencyCode={currencyCode}
          onSave={async (v) => {
            const ok = await onSave(v);
            if (ok) clearUsageCache(userId);
            return ok;
          }}
        >
          {noLimitBadge}
        </QuotaQuickEditPopover>
      );
    }
    return noLimitBadge;
  }

  // Loading state
  if (isLoading) {
    return <Skeleton className="h-5 w-12" />;
  }

  // Error state - show just the limit value
  if (error || !usageData) {
    const errorBadge = (
      <Badge
        variant="secondary"
        className={cn(
          "px-2 py-0.5 tabular-nums text-xs",
          editable && onSave && "cursor-pointer hover:ring-1 hover:ring-ring"
        )}
        title={`${label}: ${formatValue(limit, unit)}`}
        aria-label={`${label}: ${formatValue(limit, unit)}`}
      >
        {formatValue(limit, unit)}
      </Badge>
    );
    if (editable && onSave) {
      return (
        <QuotaQuickEditPopover
          currentLimit={limit}
          label={label}
          unit={editUnit}
          currencyCode={currencyCode}
          onSave={async (v) => {
            const ok = await onSave(v);
            if (ok) clearUsageCache(userId);
            return ok;
          }}
        >
          {errorBadge}
        </QuotaQuickEditPopover>
      );
    }
    return errorBadge;
  }

  // Get usage for this limit type
  const key = getLimitTypeKey(limitType);
  const typeData = usageData[key];
  const usage = typeData?.usage ?? 0;

  // Calculate percentage
  const percentage = formatPercentage(usage, limit);
  const colorClass = getPercentageColor(usage, limit);
  const statusText = `${formatValue(usage, unit)} / ${formatValue(limit, unit)}`;

  const percentBadge = (
    <Badge
      variant="secondary"
      className={cn(
        "px-2 py-0.5 tabular-nums text-xs",
        colorClass,
        editable && onSave && "cursor-pointer hover:ring-1 hover:ring-ring"
      )}
      title={`${label}: ${statusText}`}
      aria-label={`${label}: ${statusText}`}
    >
      {percentage}
    </Badge>
  );
  if (editable && onSave) {
    return (
      <QuotaQuickEditPopover
        currentLimit={limit}
        label={label}
        unit={editUnit}
        currencyCode={currencyCode}
        onSave={async (v) => {
          const ok = await onSave(v);
          if (ok) clearUsageCache(userId);
          return ok;
        }}
      >
        {percentBadge}
      </QuotaQuickEditPopover>
    );
  }
  return percentBadge;
}
