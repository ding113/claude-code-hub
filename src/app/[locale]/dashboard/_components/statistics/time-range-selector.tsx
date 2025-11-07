"use client";

import * as React from "react";
import { TIME_RANGE_OPTIONS, type TimeRange } from "@/types/statistics";
import { cn } from "@/lib/utils";

interface TimeRangeSelectorProps {
  value: TimeRange;
  onChange: (timeRange: TimeRange) => void;
  className?: string;
  disabled?: boolean;
}

/**
 * 时间范围选择器组件
 * 提供今天、7天、30天的选择
 */
export function TimeRangeSelector({
  value,
  onChange,
  className,
  disabled = false,
}: TimeRangeSelectorProps) {
  return (
    <div className={cn("flex flex-wrap ", className)}>
      {TIME_RANGE_OPTIONS.map((option) => (
        <button
          key={option.key}
          data-active={value === option.key}
          disabled={disabled}
          className="data-[active=true]:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed relative z-30 flex flex-none flex-col items-start justify-center gap-1 border-t px-6 py-4 text-left lg:border-t-0 lg:px-8 lg:py-6 lg:[&:not(:first-child)]:border-l transition-all duration-200 hover:bg-muted/30 disabled:hover:bg-transparent"
          onClick={() => !disabled && onChange(option.key)}
          title={option.description}
        >
          <span className="text-muted-foreground text-xs transition-colors whitespace-nowrap">
            {option.description}
          </span>
          <span className="text-lg leading-none font-bold sm:text-xl transition-colors whitespace-nowrap">
            {option.label}
          </span>
        </button>
      ))}
    </div>
  );
}
