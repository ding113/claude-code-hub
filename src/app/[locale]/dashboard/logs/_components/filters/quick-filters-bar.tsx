"use client";

import { AlertCircle, Calendar, CalendarDays, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type FilterPreset = "today" | "this-week" | "errors-only" | "show-retries";

interface QuickFiltersBarProps {
  activePreset: FilterPreset | null;
  onPresetToggle: (preset: FilterPreset) => void;
  className?: string;
}

export function QuickFiltersBar({ activePreset, onPresetToggle, className }: QuickFiltersBarProps) {
  const t = useTranslations("dashboard.logs.filters");

  const timePresets: Array<{ id: FilterPreset; label: string; icon: typeof Calendar }> = [
    { id: "today", label: t("quickFilters.today"), icon: Calendar },
    { id: "this-week", label: t("quickFilters.thisWeek"), icon: CalendarDays },
  ];

  const filterPresets: Array<{ id: FilterPreset; label: string; icon: typeof AlertCircle }> = [
    { id: "errors-only", label: t("quickFilters.errorsOnly"), icon: AlertCircle },
    { id: "show-retries", label: t("quickFilters.showRetries"), icon: RefreshCw },
  ];

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        // Mobile: horizontal scroll
        "overflow-x-auto scrollbar-hide pb-1 mb-3",
        className
      )}
    >
      {/* Time presets */}
      {timePresets.map(({ id, label, icon: Icon }) => (
        <Button
          key={id}
          type="button"
          variant={activePreset === id ? "default" : "outline"}
          size="sm"
          onClick={() => onPresetToggle(id)}
          className="shrink-0"
        >
          <Icon className="h-4 w-4 mr-1.5" />
          {label}
        </Button>
      ))}

      {/* Separator */}
      <div className="h-5 w-px bg-border shrink-0 hidden sm:block" />

      {/* Filter presets */}
      {filterPresets.map(({ id, label, icon: Icon }) => (
        <Button
          key={id}
          type="button"
          variant={activePreset === id ? "default" : "outline"}
          size="sm"
          onClick={() => onPresetToggle(id)}
          className="shrink-0"
        >
          <Icon className="h-4 w-4 mr-1.5" />
          {label}
        </Button>
      ))}
    </div>
  );
}
