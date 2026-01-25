"use client";

import { format } from "date-fns";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FilterDisplayNames, UsageLogFilters } from "./types";

interface ActiveFiltersDisplayProps {
  filters: UsageLogFilters;
  onRemove: (key: keyof UsageLogFilters) => void;
  onClearAll: () => void;
  displayNames: FilterDisplayNames;
  isAdmin: boolean;
  className?: string;
}

interface ActiveFilter {
  key: keyof UsageLogFilters;
  label: string;
  value: string;
}

export function ActiveFiltersDisplay({
  filters,
  onRemove,
  onClearAll,
  displayNames,
  isAdmin,
  className,
}: ActiveFiltersDisplayProps) {
  const t = useTranslations("dashboard.logs.filters");

  const activeFilters = useMemo(() => {
    const result: ActiveFilter[] = [];

    // User filter (admin only)
    if (isAdmin && filters.userId !== undefined) {
      const userName = displayNames.getUserName(filters.userId);
      result.push({
        key: "userId",
        label: t("user"),
        value: userName ?? filters.userId.toString(),
      });
    }

    // Key filter
    if (filters.keyId !== undefined) {
      const keyName = displayNames.getKeyName(filters.keyId);
      result.push({
        key: "keyId",
        label: t("apiKey"),
        value: keyName ?? filters.keyId.toString(),
      });
    }

    // Provider filter (admin only)
    if (isAdmin && filters.providerId !== undefined) {
      const providerName = displayNames.getProviderName(filters.providerId);
      result.push({
        key: "providerId",
        label: t("provider"),
        value: providerName ?? filters.providerId.toString(),
      });
    }

    // Session ID filter
    if (filters.sessionId) {
      result.push({
        key: "sessionId",
        label: t("sessionId"),
        value:
          filters.sessionId.length > 12
            ? `${filters.sessionId.slice(0, 12)}...`
            : filters.sessionId,
      });
    }

    // Date range filter
    if (filters.startTime && filters.endTime) {
      const startDate = format(new Date(filters.startTime), "MM/dd");
      const endDate = format(new Date(filters.endTime - 1000), "MM/dd");
      result.push({
        key: "startTime",
        label: t("dateRange"),
        value: startDate === endDate ? startDate : `${startDate} - ${endDate}`,
      });
    }

    // Model filter
    if (filters.model) {
      result.push({
        key: "model",
        label: t("model"),
        value: filters.model,
      });
    }

    // Endpoint filter
    if (filters.endpoint) {
      result.push({
        key: "endpoint",
        label: t("endpoint"),
        value: filters.endpoint,
      });
    }

    // Status code filter
    if (filters.excludeStatusCode200) {
      result.push({
        key: "excludeStatusCode200",
        label: t("statusCode"),
        value: "!200",
      });
    } else if (filters.statusCode !== undefined) {
      result.push({
        key: "statusCode",
        label: t("statusCode"),
        value: filters.statusCode.toString(),
      });
    }

    // Min retry count filter
    if (filters.minRetryCount !== undefined && filters.minRetryCount > 0) {
      result.push({
        key: "minRetryCount",
        label: t("minRetryCount"),
        value: `>=${filters.minRetryCount}`,
      });
    }

    return result;
  }, [filters, displayNames, isAdmin, t]);

  if (activeFilters.length === 0) {
    return null;
  }

  const handleRemove = (key: keyof UsageLogFilters) => {
    // Special handling for date range - clear both start and end time
    if (key === "startTime") {
      onRemove("startTime");
      onRemove("endTime");
    } else {
      onRemove(key);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        // Mobile: horizontal scroll
        "overflow-x-auto scrollbar-hide pb-1 -mb-1",
        className
      )}
    >
      <span className="text-xs text-muted-foreground font-medium shrink-0">
        {t("activeFilters.title")}:
      </span>

      {activeFilters.map(({ key, label, value }) => (
        <Badge key={key} variant="secondary" className="gap-1 pr-1.5 pl-2 py-1 h-auto shrink-0">
          <span className="text-xs">
            {label}: <span className="font-semibold">{value}</span>
          </span>
          <button
            type="button"
            onClick={() => handleRemove(key)}
            className="ml-1 rounded-full outline-none hover:bg-muted-foreground/20 focus:ring-2 focus:ring-ring/50 cursor-pointer"
            aria-label={t("activeFilters.remove")}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}

      {activeFilters.length > 2 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClearAll}
          className="h-auto py-1 px-2 text-xs shrink-0"
        >
          {t("activeFilters.clearAll")}
        </Button>
      )}
    </div>
  );
}
