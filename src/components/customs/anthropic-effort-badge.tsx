import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const ANTHROPIC_EFFORT_BADGE_STYLES: Record<string, string> = {
  auto: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
  low: "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/30 dark:text-cyan-300",
  medium:
    "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300",
  high: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300",
  xhigh:
    "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300",
  max: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-800 dark:bg-fuchsia-950/30 dark:text-fuchsia-300",
};

const DEFAULT_BADGE_STYLE =
  "border-muted-foreground/20 bg-muted/40 text-muted-foreground dark:border-muted-foreground/30 dark:bg-muted/20";

export function getAnthropicEffortBadgeClassName(effort: string): string {
  return ANTHROPIC_EFFORT_BADGE_STYLES[effort.trim().toLowerCase()] ?? DEFAULT_BADGE_STYLE;
}

interface AnthropicEffortBadgeProps {
  effort: string;
  label: string;
  className?: string;
}

export function AnthropicEffortBadge({ effort, label, className }: AnthropicEffortBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "min-h-5 w-fit rounded-full px-1.5 py-0.5 text-[10px] leading-none whitespace-nowrap",
        getAnthropicEffortBadgeClassName(effort),
        className
      )}
    >
      {label}
    </Badge>
  );
}
