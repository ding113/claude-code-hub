import { AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type HealthStatus = "healthy" | "unhealthy" | "unknown";

interface HealthBadgeProps {
  status: HealthStatus;
  statusCode?: number | null;
  errorMessage?: string | null;
  className?: string;
}

export function HealthBadge({ status, statusCode, errorMessage, className }: HealthBadgeProps) {
  const display = statusCode != null ? String(statusCode) : "-";

  const colors =
    status === "healthy"
      ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800"
      : status === "unhealthy"
        ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800"
        : "bg-muted/50 text-muted-foreground border-border";

  const Icon =
    status === "healthy" ? CheckCircle2 : status === "unhealthy" ? AlertTriangle : HelpCircle;

  const badge = (
    <Badge variant="outline" className={cn("gap-1", colors, className)}>
      <Icon className="h-3 w-3" />
      {display}
    </Badge>
  );

  if (status !== "unhealthy" || !errorMessage) {
    return badge;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent>{errorMessage}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
