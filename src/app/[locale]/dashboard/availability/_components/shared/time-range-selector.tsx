"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { TimeRangeOption } from "../availability-dashboard";

interface TimeRangeSelectorProps {
  value: TimeRangeOption;
  onChange: (value: TimeRangeOption) => void;
  className?: string;
}

const TIME_RANGE_OPTIONS: TimeRangeOption[] = ["15min", "1h", "6h", "24h", "7d"];

export function TimeRangeSelector({ value, onChange, className }: TimeRangeSelectorProps) {
  const t = useTranslations("dashboard.availability.timeRange");

  return (
    <div className={cn("flex gap-1 p-1 rounded-lg bg-muted/50", className)}>
      {TIME_RANGE_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200",
            value === option
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-background/50"
          )}
        >
          {t(option)}
        </button>
      ))}
    </div>
  );
}
