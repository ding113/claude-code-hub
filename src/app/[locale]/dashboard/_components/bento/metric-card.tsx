"use client";

import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ComparisonData {
  value: number;
  label: string;
  isPercentage?: boolean;
}

interface MetricCardProps {
  title: string;
  value: number | string;
  icon?: LucideIcon;
  trend?: {
    value: number;
    direction: "up" | "down" | "stable";
    label?: string;
  };
  comparisons?: ComparisonData[];
  formatter?: (value: number) => string;
  onClick?: () => void;
  className?: string;
  accentColor?: "primary" | "emerald" | "blue" | "amber" | "purple" | "rose";
}

const accentColors = {
  primary: {
    glow: "bg-primary/10",
    glowBlur: "blur-[50px]",
    iconBg: "bg-primary/10 dark:bg-primary/15",
    text: "text-primary",
  },
  emerald: {
    glow: "bg-emerald-500/10",
    glowBlur: "blur-[50px]",
    iconBg: "bg-emerald-500/10 dark:bg-emerald-500/15",
    text: "text-emerald-500",
  },
  blue: {
    glow: "bg-blue-500/10",
    glowBlur: "blur-[50px]",
    iconBg: "bg-blue-500/10 dark:bg-blue-500/15",
    text: "text-blue-500",
  },
  amber: {
    glow: "bg-amber-500/10",
    glowBlur: "blur-[50px]",
    iconBg: "bg-amber-500/10 dark:bg-amber-500/15",
    text: "text-amber-500",
  },
  purple: {
    glow: "bg-purple-500/10",
    glowBlur: "blur-[50px]",
    iconBg: "bg-purple-500/10 dark:bg-purple-500/15",
    text: "text-purple-500",
  },
  rose: {
    glow: "bg-rose-500/10",
    glowBlur: "blur-[50px]",
    iconBg: "bg-rose-500/10 dark:bg-rose-500/15",
    text: "text-rose-500",
  },
};

const trendConfig = {
  up: {
    bg: "bg-emerald-500/10 dark:bg-emerald-500/15",
    text: "text-emerald-500 dark:text-emerald-400",
    border: "border border-emerald-500/20",
  },
  down: {
    bg: "bg-rose-500/10 dark:bg-rose-500/15",
    text: "text-rose-500 dark:text-rose-400",
    border: "border border-rose-500/20",
  },
  stable: {
    bg: "bg-muted/50",
    text: "text-muted-foreground",
    border: "border border-muted/30",
  },
};

function ComparisonBadge({ value, label, isPercentage = true }: ComparisonData) {
  const isPositive = value > 0;
  const isNegative = value < 0;
  const Icon = isPositive ? ArrowUp : isNegative ? ArrowDown : ArrowRight;

  return (
    <div className="flex items-center gap-1.5">
      <div
        className={cn(
          "flex items-center gap-0.5 text-xs font-medium",
          isPositive && "text-emerald-500 dark:text-emerald-400",
          isNegative && "text-rose-500 dark:text-rose-400",
          !isPositive && !isNegative && "text-muted-foreground"
        )}
      >
        <Icon className="h-3 w-3" />
        <span>
          {value > 0 ? "+" : ""}
          {value}
          {isPercentage && "%"}
        </span>
      </div>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

export function BentoMetricCard({
  title,
  value,
  icon: Icon,
  trend,
  comparisons,
  formatter,
  onClick,
  className,
  accentColor = "primary",
}: MetricCardProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevValueRef = useRef(value);
  const colors = accentColors[accentColor];

  useEffect(() => {
    let cancelled = false;
    if (typeof value === "number" && typeof prevValueRef.current === "number") {
      if (value !== prevValueRef.current) {
        setIsAnimating(true);
        const duration = 400;
        const startValue = prevValueRef.current;
        const diff = value - startValue;
        const startTime = Date.now();

        const animate = () => {
          if (cancelled) return;
          const elapsed = Date.now() - startTime;
          const progress = Math.min(elapsed / duration, 1);
          const easeProgress = 1 - (1 - progress) ** 3;
          const currentValue = startValue + diff * easeProgress;

          setDisplayValue(currentValue);

          if (progress < 1) {
            requestAnimationFrame(animate);
          } else {
            setIsAnimating(false);
            prevValueRef.current = value;
          }
        };

        requestAnimationFrame(animate);
      }
    } else {
      setDisplayValue(value);
      prevValueRef.current = value;
    }
    return () => {
      cancelled = true;
    };
  }, [value]);

  const formattedValue =
    typeof displayValue === "number" && formatter
      ? formatter(Math.round(displayValue))
      : typeof displayValue === "number"
        ? Math.round(displayValue).toLocaleString()
        : displayValue;

  const TrendIcon =
    trend?.direction === "up" ? ArrowUp : trend?.direction === "down" ? ArrowDown : ArrowRight;

  const trendStyle = trend ? trendConfig[trend.direction] : null;

  const Component = onClick ? "button" : "div";
  const componentProps = onClick ? { type: "button" as const } : {};

  return (
    <Component
      {...componentProps}
      onClick={onClick}
      className={cn(
        // Glass card base
        "relative overflow-hidden rounded-2xl p-5 md:p-6",
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
        // Layout
        "flex flex-col justify-between h-full min-h-[140px]",
        // Interactive
        onClick && "cursor-pointer active:scale-[0.99]",
        "group",
        className
      )}
    >
      {/* Subtle Mesh Gradient Glow */}
      <div
        className={cn(
          "absolute -top-[30%] -right-[15%] w-[150px] h-[150px] rounded-full pointer-events-none z-0",
          colors.glow,
          colors.glowBlur,
          "opacity-50 group-hover:opacity-70 transition-opacity duration-500"
        )}
      />

      {/* Content */}
      <div className="relative z-10">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            {Icon && (
              <div
                className={cn(
                  "p-2 rounded-lg flex-shrink-0",
                  colors.iconBg,
                  "transition-all duration-300 group-hover:scale-105"
                )}
              >
                <Icon className={cn("h-4 w-4", colors.text)} />
              </div>
            )}
            <p className="text-sm font-medium text-muted-foreground group-hover:text-foreground/80 transition-colors truncate">
              {title}
            </p>
          </div>

          {/* Trend Badge */}
          {trend && trendStyle && (
            <div
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0",
                trendStyle.bg,
                trendStyle.text,
                trendStyle.border
              )}
            >
              <TrendIcon className="h-3 w-3" />
              <span>
                {trend.value > 0 ? "+" : ""}
                {trend.value}%
              </span>
            </div>
          )}
        </div>

        {/* Value */}
        <div className="mt-3">
          <h3
            className={cn(
              "text-2xl md:text-3xl font-bold tracking-tight text-foreground",
              "transition-opacity duration-200",
              isAnimating && "opacity-80"
            )}
          >
            {formattedValue}
          </h3>
          {trend?.label && <p className="text-xs text-muted-foreground mt-1">{trend.label}</p>}
        </div>
      </div>

      {/* Comparison Section */}
      {comparisons && comparisons.length > 0 && (
        <div className="mt-auto pt-3 relative z-10 flex flex-wrap gap-x-4 gap-y-1">
          {comparisons.map((comparison, index) => (
            <ComparisonBadge key={index} {...comparison} />
          ))}
        </div>
      )}
    </Component>
  );
}
