"use client";

import type { LucideIcon } from "lucide-react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export type StepStatus =
  | "success"
  | "failure"
  | "warning"
  | "pending"
  | "skipped"
  | "session_reuse";

interface StepCardProps {
  /** Step number (1-based) */
  step: number;
  /** Icon to display */
  icon: LucideIcon;
  /** Step title */
  title: string;
  /** Optional subtitle */
  subtitle?: string;
  /** Step status */
  status: StepStatus;
  /** Timestamp offset in ms (relative to baseTimestamp) */
  timestamp?: number;
  /** Base timestamp for calculating relative time */
  baseTimestamp?: number;
  /** Expandable details content */
  details?: React.ReactNode;
  /** Whether this is the last step (hides connector line) */
  isLast?: boolean;
  /** Optional className */
  className?: string;
}

const statusConfig: Record<StepStatus, { dot: string; bg: string; text: string }> = {
  success: {
    dot: "bg-emerald-500",
    bg: "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  failure: {
    dot: "bg-rose-500",
    bg: "bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800",
    text: "text-rose-700 dark:text-rose-300",
  },
  warning: {
    dot: "bg-amber-500",
    bg: "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800",
    text: "text-amber-700 dark:text-amber-300",
  },
  pending: {
    dot: "bg-slate-400",
    bg: "bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700",
    text: "text-slate-600 dark:text-slate-400",
  },
  skipped: {
    dot: "bg-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800",
    text: "text-blue-700 dark:text-blue-300",
  },
  session_reuse: {
    dot: "bg-violet-500",
    bg: "bg-violet-50 dark:bg-violet-950/20 border-violet-200 dark:border-violet-800",
    text: "text-violet-700 dark:text-violet-300",
  },
};

export function StepCard({
  step,
  icon: Icon,
  title,
  subtitle,
  status,
  timestamp,
  baseTimestamp,
  details,
  isLast = false,
  className,
}: StepCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const config = statusConfig[status];

  const relativeTime =
    timestamp !== undefined && baseTimestamp !== undefined ? timestamp - baseTimestamp : null;

  const hasDetails = !!details;

  return (
    <div className={cn("relative flex gap-3", className)}>
      {/* Left side: Step indicator and connector line */}
      <div className="flex flex-col items-center">
        {/* Step number circle */}
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2",
            config.bg
          )}
        >
          <span className={cn("text-xs font-semibold", config.text)}>{step}</span>
        </div>

        {/* Connector line */}
        {!isLast && (
          <div
            className={cn(
              "w-0.5 flex-1 min-h-[20px]",
              status === "skipped"
                ? "border-l-2 border-dashed border-slate-300 dark:border-slate-600"
                : config.dot
            )}
          />
        )}
      </div>

      {/* Right side: Content card */}
      <div className={cn("flex-1 pb-4", isLast && "pb-0")}>
        <div
          className={cn(
            "rounded-lg border p-3 sm:p-4 transition-colors",
            config.bg,
            hasDetails && "cursor-pointer hover:shadow-sm"
          )}
          onClick={hasDetails ? () => setIsExpanded(!isExpanded) : undefined}
          onKeyDown={
            hasDetails
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setIsExpanded(!isExpanded);
                  }
                }
              : undefined
          }
          tabIndex={hasDetails ? 0 : undefined}
          role={hasDetails ? "button" : undefined}
          aria-expanded={hasDetails ? isExpanded : undefined}
        >
          {/* Header */}
          <div className="flex items-start gap-2">
            {/* Icon */}
            <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", config.text)} />

            {/* Title and subtitle */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn("text-sm font-medium", config.text)}>{title}</span>
                {relativeTime !== null && (
                  <span className="text-xs text-muted-foreground font-mono">
                    +{relativeTime.toFixed(0)}ms
                  </span>
                )}
              </div>
              {subtitle && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{subtitle}</p>
              )}
            </div>

            {/* Expand/collapse indicator */}
            {hasDetails && (
              <div className="shrink-0">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            )}
          </div>

          {/* Expandable details */}
          {hasDetails && isExpanded && (
            <div className="mt-3 pt-3 border-t border-current/10">{details}</div>
          )}
        </div>
      </div>
    </div>
  );
}
