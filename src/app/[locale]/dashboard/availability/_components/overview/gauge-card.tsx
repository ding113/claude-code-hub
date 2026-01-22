"use client";

import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface GaugeCardProps {
  value: number;
  label: string;
  icon: LucideIcon;
  trend?: {
    value: number;
    direction: "up" | "down" | "stable";
  };
  thresholds?: {
    warning: number;
    critical: number;
  };
  size?: "sm" | "md" | "lg";
  formatter?: (value: number) => string;
  invertColors?: boolean;
  className?: string;
}

const sizeConfig = {
  sm: { gauge: 64, stroke: 4, iconSize: 16, fontSize: "text-lg" },
  md: { gauge: 80, stroke: 5, iconSize: 20, fontSize: "text-2xl" },
  lg: { gauge: 96, stroke: 6, iconSize: 24, fontSize: "text-3xl" },
};

function getGaugeColor(
  value: number,
  thresholds: { warning: number; critical: number },
  invertColors: boolean
): string {
  if (invertColors) {
    // For metrics where lower is better (error rate, latency)
    if (value <= thresholds.critical) return "text-emerald-500";
    if (value <= thresholds.warning) return "text-amber-500";
    return "text-rose-500";
  }
  // For metrics where higher is better (availability)
  if (value >= thresholds.warning) return "text-emerald-500";
  if (value >= thresholds.critical) return "text-amber-500";
  return "text-rose-500";
}

function getTrendIcon(direction: "up" | "down" | "stable") {
  switch (direction) {
    case "up":
      return ArrowUp;
    case "down":
      return ArrowDown;
    default:
      return ArrowRight;
  }
}

function getTrendColor(direction: "up" | "down" | "stable", invertColors: boolean) {
  if (direction === "stable") return "text-muted-foreground bg-muted/50";
  if (invertColors) {
    // For inverted metrics, down is good
    return direction === "down"
      ? "text-emerald-500 bg-emerald-500/10"
      : "text-rose-500 bg-rose-500/10";
  }
  // For normal metrics, up is good
  return direction === "up" ? "text-emerald-500 bg-emerald-500/10" : "text-rose-500 bg-rose-500/10";
}

export function GaugeCard({
  value,
  label,
  icon: Icon,
  trend,
  thresholds = { warning: 80, critical: 50 },
  size = "md",
  formatter = (v) => `${v.toFixed(1)}%`,
  invertColors = false,
  className,
}: GaugeCardProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const prevValueRef = useRef(0);
  const config = sizeConfig[size];

  // Animate value changes
  useEffect(() => {
    let cancelled = false;
    const duration = 800;
    const startValue = prevValueRef.current;
    const diff = value - startValue;
    const startTime = Date.now();

    const animate = () => {
      if (cancelled) return;
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const easeProgress = 1 - (1 - progress) ** 3;
      const currentValue = startValue + diff * easeProgress;

      setDisplayValue(currentValue);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        prevValueRef.current = value;
      }
    };

    requestAnimationFrame(animate);
    return () => {
      cancelled = true;
    };
  }, [value]);

  // SVG gauge calculations
  const radius = (config.gauge - config.stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const normalizedValue = Math.min(Math.max(displayValue, 0), 100);
  const offset = circumference - (normalizedValue / 100) * circumference;
  const gaugeColor = getGaugeColor(displayValue, thresholds, invertColors);

  const TrendIcon = trend ? getTrendIcon(trend.direction) : null;
  const trendColor = trend ? getTrendColor(trend.direction, invertColors) : "";

  return (
    <div
      className={cn(
        // Glass card base
        "relative overflow-hidden rounded-2xl p-4 md:p-5",
        "bg-card/60 dark:bg-[rgba(20,20,23,0.5)]",
        "backdrop-blur-lg",
        "border border-border/50 dark:border-white/[0.08]",
        "shadow-sm",
        // Inner light gradient
        "before:absolute before:inset-0 before:bg-gradient-to-b before:from-white/[0.02] before:to-transparent before:pointer-events-none before:z-[1]",
        // Hover effects
        "transition-all duration-300 ease-out",
        "hover:border-primary/20 hover:shadow-md",
        "hover:-translate-y-0.5",
        "group",
        className
      )}
    >
      {/* Subtle glow effect */}
      <div
        className={cn(
          "absolute -top-[30%] -right-[15%] w-[120px] h-[120px] rounded-full pointer-events-none z-0",
          gaugeColor.replace("text-", "bg-").replace("500", "500/10"),
          "blur-[40px]",
          "opacity-50 group-hover:opacity-70 transition-opacity duration-500"
        )}
      />

      <div className="relative z-10 flex items-center gap-4">
        {/* Circular Gauge */}
        <div
          className="relative flex-shrink-0"
          style={{ width: config.gauge, height: config.gauge }}
        >
          <svg width={config.gauge} height={config.gauge} className="transform -rotate-90">
            {/* Background circle */}
            <circle
              cx={config.gauge / 2}
              cy={config.gauge / 2}
              r={radius}
              stroke="currentColor"
              strokeWidth={config.stroke}
              fill="none"
              className="text-muted/20"
            />
            {/* Progress circle with gradient */}
            <circle
              cx={config.gauge / 2}
              cy={config.gauge / 2}
              r={radius}
              stroke="currentColor"
              strokeWidth={config.stroke}
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              className={cn("transition-all duration-700 ease-out", gaugeColor)}
            />
          </svg>
          {/* Center icon */}
          <div className="absolute inset-0 flex items-center justify-center">
            <Icon
              className={cn(gaugeColor, "transition-colors duration-300")}
              style={{ width: config.iconSize, height: config.iconSize }}
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-col min-w-0">
          <p className="text-sm font-medium text-muted-foreground truncate">{label}</p>
          <h3 className={cn("font-bold tracking-tight text-foreground", config.fontSize)}>
            {formatter(displayValue)}
          </h3>
          {/* Trend indicator */}
          {trend && TrendIcon && (
            <div
              className={cn(
                "flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded-full w-fit text-xs font-medium",
                trendColor
              )}
            >
              <TrendIcon className="h-3 w-3" />
              <span>
                {trend.value > 0 ? "+" : ""}
                {trend.value.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
