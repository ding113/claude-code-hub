"use client";

import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ConfidenceBadgeProps {
  requestCount: number;
  thresholds?: {
    low: number;
    medium: number;
    high: number;
  };
  className?: string;
}

type ConfidenceLevel = "low" | "medium" | "high";

function getConfidenceLevel(
  count: number,
  thresholds: { low: number; medium: number; high: number }
): ConfidenceLevel {
  if (count >= thresholds.high) return "high";
  if (count >= thresholds.medium) return "medium";
  return "low";
}

const confidenceConfig: Record<
  ConfidenceLevel,
  { bars: number; color: string; bgColor: string; borderStyle: string }
> = {
  low: {
    bars: 1,
    color: "bg-slate-400",
    bgColor: "bg-slate-400/10",
    borderStyle: "border-dashed border-slate-400/50",
  },
  medium: {
    bars: 2,
    color: "bg-amber-500",
    bgColor: "bg-amber-500/10",
    borderStyle: "border-solid border-amber-500/50",
  },
  high: {
    bars: 3,
    color: "bg-emerald-500",
    bgColor: "bg-emerald-500/10",
    borderStyle: "border-solid border-emerald-500/50",
  },
};

export function ConfidenceBadge({
  requestCount,
  thresholds = { low: 10, medium: 50, high: 200 },
  className,
}: ConfidenceBadgeProps) {
  const t = useTranslations("dashboard.availability.confidence");
  const level = getConfidenceLevel(requestCount, thresholds);
  const config = confidenceConfig[level];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border",
              config.bgColor,
              config.borderStyle,
              "cursor-help",
              className
            )}
          >
            {/* Signal bars */}
            <div className="flex items-end gap-0.5 h-3">
              {[1, 2, 3].map((bar) => (
                <div
                  key={bar}
                  className={cn(
                    "w-1 rounded-sm transition-colors",
                    bar <= config.bars ? config.color : "bg-muted/30"
                  )}
                  style={{ height: `${bar * 4}px` }}
                />
              ))}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[200px]">
          <div className="text-xs space-y-1">
            <p className="font-medium">{t(level)}</p>
            <p className="text-muted-foreground">{t(`${level}Tooltip`, { count: requestCount })}</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
