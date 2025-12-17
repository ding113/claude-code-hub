"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface LimitStatusIndicatorProps {
  /** Limit value. `null/undefined` means unset. */
  value: number | null | undefined;
  /** Text label shown in non-compact mode. */
  label: string;
  /** Visual variant. `compact` only shows the dot indicator. */
  variant?: "default" | "compact";
}

function formatLimitValue(raw: number): string {
  if (!Number.isFinite(raw)) return String(raw);
  if (Number.isInteger(raw)) return String(raw);
  // Keep it readable for quota-like values.
  return raw.toFixed(2).replace(/\.00$/, "");
}

/**
 * Limit status indicator for table cells.
 * - Unset: gray hollow ring + "未设置"
 * - Set: colored solid dot + value
 */
export function LimitStatusIndicator({
  value,
  label,
  variant = "default",
}: LimitStatusIndicatorProps) {
  const isSet = typeof value === "number" && Number.isFinite(value);
  const statusText = isSet ? formatLimitValue(value) : "未设置";

  return (
    <Badge
      variant={isSet ? "secondary" : "outline"}
      className={cn(
        "gap-1.5",
        variant === "compact" && "px-1.5 py-1",
        variant === "default" && "px-2"
      )}
      title={`${label}: ${statusText}`}
      aria-label={`${label}: ${statusText}`}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-2.5 w-2.5 rounded-full",
          isSet ? "bg-primary" : "border border-muted-foreground"
        )}
      />
      {variant === "default" && (
        <>
          <span className="text-muted-foreground">{label}</span>
          <span className={cn("tabular-nums", !isSet && "text-muted-foreground")}>
            {statusText}
          </span>
        </>
      )}
    </Badge>
  );
}
