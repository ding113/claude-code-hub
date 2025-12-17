"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface LimitStatusIndicatorProps {
  /** Limit value. `null/undefined` means unset. */
  value: number | null | undefined;
  /** Current usage value (for percentage display). */
  usage?: number;
  /** Text label shown in non-compact mode. */
  label: string;
  /** Visual variant. `compact` only shows value without label. */
  variant?: "default" | "compact";
  /** Whether to show percentage instead of value (requires usage). */
  showPercentage?: boolean;
  /** Unit to display (e.g., "$" for currency, empty for count). */
  unit?: string;
}

function formatLimitValue(raw: number, unit?: string): string {
  if (!Number.isFinite(raw)) return String(raw);
  const formatted = Number.isInteger(raw) ? String(raw) : raw.toFixed(2).replace(/\.00$/, "");
  return unit ? `${unit}${formatted}` : formatted;
}

function formatPercentage(usage: number, limit: number): string {
  const percentage = Math.min(Math.round((usage / limit) * 100), 100);
  return `${percentage}%`;
}

function getPercentageColor(usage: number, limit: number): string {
  const percentage = (usage / limit) * 100;
  if (percentage >= 100) return "text-destructive";
  if (percentage >= 80) return "text-orange-600";
  return "";
}

/**
 * Limit status indicator for table cells.
 * - Unset: shows "-"
 * - Set: shows value (or percentage if usage is provided and showPercentage is true)
 */
export function LimitStatusIndicator({
  value,
  usage,
  label,
  variant = "default",
  showPercentage = false,
  unit = "$",
}: LimitStatusIndicatorProps) {
  const isSet = typeof value === "number" && Number.isFinite(value);
  const hasUsage = typeof usage === "number" && Number.isFinite(usage);

  // Determine display text
  let displayText: string;
  let colorClass = "";

  if (!isSet) {
    displayText = "-";
  } else if (showPercentage && hasUsage) {
    displayText = formatPercentage(usage, value);
    colorClass = getPercentageColor(usage, value);
  } else {
    displayText = formatLimitValue(value, unit);
  }

  const statusText = isSet
    ? hasUsage
      ? `${formatLimitValue(usage, unit)} / ${formatLimitValue(value, unit)}`
      : formatLimitValue(value, unit)
    : "-";

  if (variant === "compact") {
    return (
      <Badge
        variant={isSet ? "secondary" : "outline"}
        className={cn("px-2 py-0.5 tabular-nums text-xs", colorClass)}
        title={`${label}: ${statusText}`}
        aria-label={`${label}: ${statusText}`}
      >
        {displayText}
      </Badge>
    );
  }

  return (
    <Badge
      variant={isSet ? "secondary" : "outline"}
      className={cn("gap-1.5 px-2")}
      title={`${label}: ${statusText}`}
      aria-label={`${label}: ${statusText}`}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", !isSet && "text-muted-foreground", colorClass)}>
        {displayText}
      </span>
    </Badge>
  );
}
