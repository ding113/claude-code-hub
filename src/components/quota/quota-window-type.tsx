"use client";

import { Calendar, CalendarDays, Clock, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type WindowType = "5h" | "weekly" | "monthly" | "daily";

interface WindowTypeConfig {
  icon: typeof RefreshCw;
  variant: "default" | "secondary" | "outline";
  color: string;
}

// Static icon/style config; labels/descriptions come from i18n
const WINDOW_STYLE: Record<WindowType, WindowTypeConfig> = {
  "5h": { icon: RefreshCw, variant: "default", color: "text-blue-600 dark:text-blue-400" },
  weekly: {
    icon: CalendarDays,
    variant: "secondary",
    color: "text-purple-600 dark:text-purple-400",
  },
  monthly: { icon: Calendar, variant: "secondary", color: "text-green-600 dark:text-green-400" },
  daily: { icon: Clock, variant: "secondary", color: "text-orange-600 dark:text-orange-400" },
};

interface QuotaWindowTypeProps {
  type: WindowType;
  className?: string;
  showIcon?: boolean;
  showDescription?: boolean;
  size?: "sm" | "md";
}

/**
 * 限额窗口类型标签组件
 *
 * 显示不同时间窗口的类型和说明：
 * - 5h: 滚动窗口（过去5小时）
 * - weekly: 自然周（周一重置）
 * - monthly: 自然月（每月1日重置）
 * - daily: 自然日（每日重置）
 *
 * @example
 * ```tsx
 * <QuotaWindowType type="5h" showIcon showDescription />
 * <QuotaWindowType type="weekly" showIcon />
 * ```
 */
export function QuotaWindowType({
  type,
  className,
  showIcon = true,
  showDescription = false,
  size = "sm",
}: QuotaWindowTypeProps) {
  const t = useTranslations("quota");
  const style = WINDOW_STYLE[type];
  const Icon = style.icon;
  const label = t(`windowType.${type}.label` as `windowType.${WindowType}.label`);
  const description = t(`windowType.${type}.description` as `windowType.${WindowType}.description`);

  if (showDescription) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        {showIcon && <Icon className={cn("h-4 w-4", style.color)} />}
        <div className="flex flex-col">
          <span className={cn("font-medium", size === "sm" ? "text-xs" : "text-sm")}>{label}</span>
          <span className="text-xs text-muted-foreground">{description}</span>
        </div>
      </div>
    );
  }

  return (
    <Badge variant={style.variant} className={cn("gap-1", className)}>
      {showIcon && <Icon className="h-3 w-3" />}
      <span>{label}</span>
    </Badge>
  );
}

/**
 * 简洁的窗口类型标签（仅文字）
 */
export function QuotaWindowTypeCompact({
  type,
  className,
}: {
  type: WindowType;
  className?: string;
}) {
  const t = useTranslations("quota");
  const label = t(`windowType.${type}.label` as `windowType.${WindowType}.label`);
  return <span className={cn("text-xs text-muted-foreground", className)}>{label}</span>;
}

/**
 * 带工具提示的窗口类型标签
 */
export function QuotaWindowTypeWithTooltip({
  type,
  className,
}: {
  type: WindowType;
  className?: string;
}) {
  const t = useTranslations("quota");
  const style = WINDOW_STYLE[type];
  const Icon = style.icon;
  const label = t(`windowType.${type}.label` as `windowType.${WindowType}.label`);
  const description = t(`windowType.${type}.description` as `windowType.${WindowType}.description`);

  return (
    <div
      className={cn("group relative inline-flex items-center gap-1.5 cursor-help", className)}
      title={description}
    >
      <Icon className={cn("h-3.5 w-3.5", style.color)} />
      <span className="text-xs font-medium">{label}</span>

      {/* Tooltip */}
      <div className="invisible group-hover:visible absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded shadow-md border whitespace-nowrap z-10">
        {description}
        <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-popover" />
      </div>
    </div>
  );
}
