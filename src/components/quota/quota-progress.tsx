"use client";

import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

interface QuotaProgressProps {
  current: number;
  limit: number | null;
  className?: string;
}

export function QuotaProgress({ current, limit, className }: QuotaProgressProps) {
  if (!limit || limit <= 0) {
    return null;
  }

  const percentage = (current / limit) * 100;
  const isWarning = percentage >= 60 && percentage < 80;
  const isDanger = percentage >= 80 && percentage < 100;
  const isExceeded = percentage >= 100;

  return (
    <ProgressPrimitive.Root
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-primary/20", className)}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          "h-full w-full flex-1 transition-all",
          isExceeded && "bg-red-500",
          isDanger && !isExceeded && "bg-orange-500",
          isWarning && !isDanger && !isExceeded && "bg-yellow-500",
          !isWarning && !isDanger && !isExceeded && "bg-primary"
        )}
        style={{ transform: `translateX(-${100 - Math.min(percentage, 100)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
