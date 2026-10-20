import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const THINKING_EFFORT_BADGE_STYLES: Record<string, string> = {
  none: "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300",
  minimal:
    "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-900/40 dark:text-stone-300",
  auto: "border-sky-300 bg-gradient-to-r from-cyan-50 via-sky-50 to-indigo-50 text-sky-800 dark:border-sky-700 dark:from-cyan-950/40 dark:via-sky-950/40 dark:to-indigo-950/40 dark:text-sky-200",
  low: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
  medium:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300",
  high: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300",
  // xhigh 介于 high 与 max 之间，需要独立样式以维持强度等级的视觉顺序。
  xhigh:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300",
  max: "border-red-300 bg-red-100 text-red-800 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200",
};

const DEFAULT_BADGE_STYLE =
  "border-muted-foreground/20 bg-muted/40 text-muted-foreground dark:border-muted-foreground/30 dark:bg-muted/20";

/** 按思考强度等级返回一致的标签颜色，未知等级使用中性样式。 */
export function getThinkingEffortBadgeClassName(effort: string): string {
  return THINKING_EFFORT_BADGE_STYLES[effort.trim().toLowerCase()] ?? DEFAULT_BADGE_STYLE;
}

/** 思考强度标签属性。 */
interface ThinkingEffortBadgeProps {
  effort: string;
  label: string;
  className?: string;
}

/** 展示 Anthropic effort 或 Codex reasoning effort 的统一强度标签。 */
export function ThinkingEffortBadge({ effort, label, className }: ThinkingEffortBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "w-fit px-1 text-[10px] leading-tight whitespace-nowrap",
        getThinkingEffortBadgeClassName(effort),
        className
      )}
    >
      {label}
    </Badge>
  );
}
