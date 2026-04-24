"use client";

import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Fake200RetryTooltipProps {
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

export function Fake200RetryTooltip({
  className,
  side = "top",
  align = "start",
}: Fake200RetryTooltipProps) {
  const t = useTranslations("dashboard.logs.details");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 rounded-sm text-[10px] font-medium underline decoration-dotted underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
            className
          )}
        >
          <span>{t("fake200RetryTooltipLabel")}</span>
          <InfoIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} align={align} className="max-w-[320px] space-y-2">
        <div className="font-medium">{t("fake200RetryTooltipTitle")}</div>
        <p>{t("fake200RetryTooltipServerRetry")}</p>
        <p>{t("fake200RetryTooltipSessionFallback")}</p>
      </TooltipContent>
    </Tooltip>
  );
}
