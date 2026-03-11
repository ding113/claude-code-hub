"use client";

import { useQuery } from "@tanstack/react-query";
import { Filter, Key, Server } from "lucide-react";
import { useTranslations } from "next-intl";
import { getKeys } from "@/actions/keys";
import { getProviders } from "@/actions/providers";
import { useLazyModels } from "@/app/[locale]/dashboard/logs/_hooks/use-lazy-filter-options";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TimeRangePreset, UserInsightsFilters } from "./types";

interface UserInsightsFilterBarProps {
  userId: number;
  filters: UserInsightsFilters;
  onFiltersChange: (filters: UserInsightsFilters) => void;
}

const TIME_RANGE_OPTIONS: { key: TimeRangePreset; labelKey: string }[] = [
  { key: "today", labelKey: "timeRange.today" },
  { key: "7days", labelKey: "timeRange.7days" },
  { key: "30days", labelKey: "timeRange.30days" },
  { key: "thisMonth", labelKey: "timeRange.thisMonth" },
];

export function UserInsightsFilterBar({
  userId,
  filters,
  onFiltersChange,
}: UserInsightsFilterBarProps) {
  const t = useTranslations("dashboard.leaderboard.userInsights");

  const { data: keysData } = useQuery({
    queryKey: ["user-insights-keys", userId],
    queryFn: async () => {
      const result = await getKeys(userId);
      if (!result.ok) return [];
      return result.data;
    },
    staleTime: 60_000,
  });

  const { data: providersData } = useQuery({
    queryKey: ["user-insights-providers"],
    queryFn: async () => {
      const result = await getProviders();
      return result;
    },
    staleTime: 60_000,
  });

  const { data: models, onOpenChange: onModelsOpenChange } = useLazyModels();

  const hasActiveFilters = filters.keyId || filters.providerId || filters.model;

  return (
    <div className="space-y-3">
      {/* Time range preset buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {TIME_RANGE_OPTIONS.map((opt) => (
            <Button
              key={opt.key}
              variant={filters.timeRange === opt.key ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => onFiltersChange({ ...filters, timeRange: opt.key })}
              data-testid={`user-insights-time-range-${opt.key}`}
            >
              {t(opt.labelKey)}
            </Button>
          ))}
        </div>
      </div>

      {/* Dimension filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />
          {t("filters")}
        </div>

        {/* Key filter */}
        <Select
          value={filters.keyId ? String(filters.keyId) : "all"}
          onValueChange={(value) =>
            onFiltersChange({
              ...filters,
              keyId: value === "all" ? undefined : Number(value),
            })
          }
        >
          <SelectTrigger className="h-7 w-[160px] text-xs">
            <Key className="h-3 w-3 mr-1" />
            <SelectValue placeholder={t("allKeys")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allKeys")}</SelectItem>
            {keysData?.map((key) => (
              <SelectItem key={key.id} value={String(key.id)}>
                {key.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Provider filter */}
        <Select
          value={filters.providerId ? String(filters.providerId) : "all"}
          onValueChange={(value) =>
            onFiltersChange({
              ...filters,
              providerId: value === "all" ? undefined : Number(value),
            })
          }
        >
          <SelectTrigger className="h-7 w-[160px] text-xs">
            <Server className="h-3 w-3 mr-1" />
            <SelectValue placeholder={t("allProviders")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allProviders")}</SelectItem>
            {providersData?.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Model filter */}
        <Select
          value={filters.model ?? "all"}
          onValueChange={(value) =>
            onFiltersChange({
              ...filters,
              model: value === "all" ? undefined : value,
            })
          }
          onOpenChange={onModelsOpenChange}
        >
          <SelectTrigger className="h-7 w-[200px] text-xs">
            <SelectValue placeholder={t("allModels")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allModels")}</SelectItem>
            {models.map((model) => (
              <SelectItem key={model} value={model}>
                {model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Clear filters */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() =>
              onFiltersChange({
                timeRange: filters.timeRange,
              })
            }
          >
            {t("allTime")}
          </Button>
        )}
      </div>
    </div>
  );
}
