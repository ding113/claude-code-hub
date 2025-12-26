import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface BalanceIndicatorProps {
  balanceUsd: number | null;
  lowThresholdUsd?: number | null;
  className?: string;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function BalanceIndicator({
  balanceUsd,
  lowThresholdUsd,
  className,
}: BalanceIndicatorProps) {
  if (balanceUsd == null) {
    return (
      <Badge variant="outline" className={cn("text-muted-foreground", className)}>
        -
      </Badge>
    );
  }

  const isLow = lowThresholdUsd != null && balanceUsd < lowThresholdUsd;

  return (
    <Badge
      variant="outline"
      className={cn(
        isLow
          ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800"
          : "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800",
        className
      )}
    >
      {formatUsd(balanceUsd)}
    </Badge>
  );
}
