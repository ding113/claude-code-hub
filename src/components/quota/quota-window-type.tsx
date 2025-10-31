"use client";

import { Badge } from "@/components/ui/badge";
import { RefreshCw, Calendar, CalendarDays, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

type WindowType = "5h" | "weekly" | "monthly" | "daily";

interface WindowTypeConfig {
  label: string;
  description: string;
  icon: typeof RefreshCw;
  variant: "default" | "secondary" | "outline";
  color: string;
}

const WINDOW_CONFIG: Record<WindowType, WindowTypeConfig> = {
  "5h": {
    label: "滚动窗口",
    description: "统计过去5小时内的消费",
    icon: RefreshCw,
    variant: "default",
    color: "text-blue-600 dark:text-blue-400",
  },
  weekly: {
    label: "自然周",
    description: "周一 00:00 重置",
    icon: CalendarDays,
    variant: "secondary",
    color: "text-purple-600 dark:text-purple-400",
  },
  monthly: {
    label: "自然月",
    description: "每月1日 00:00 重置",
    icon: Calendar,
    variant: "secondary",
    color: "text-green-600 dark:text-green-400",
  },
  daily: {
    label: "自然日",
    description: "每日 00:00 重置",
    icon: Clock,
    variant: "secondary",
    color: "text-orange-600 dark:text-orange-400",
  },
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
  const config = WINDOW_CONFIG[type];
  const Icon = config.icon;

  if (showDescription) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        {showIcon && <Icon className={cn("h-4 w-4", config.color)} />}
        <div className="flex flex-col">
          <span className={cn("font-medium", size === "sm" ? "text-xs" : "text-sm")}>
            {config.label}
          </span>
          <span className="text-xs text-muted-foreground">{config.description}</span>
        </div>
      </div>
    );
  }

  return (
    <Badge variant={config.variant} className={cn("gap-1", className)}>
      {showIcon && <Icon className="h-3 w-3" />}
      <span>{config.label}</span>
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
  const config = WINDOW_CONFIG[type];

  return <span className={cn("text-xs text-muted-foreground", className)}>{config.label}</span>;
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
  const config = WINDOW_CONFIG[type];
  const Icon = config.icon;

  return (
    <div
      className={cn("group relative inline-flex items-center gap-1.5 cursor-help", className)}
      title={config.description}
    >
      <Icon className={cn("h-3.5 w-3.5", config.color)} />
      <span className="text-xs font-medium">{config.label}</span>

      {/* Tooltip */}
      <div className="invisible group-hover:visible absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded shadow-md border whitespace-nowrap z-10">
        {config.description}
        <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-popover" />
      </div>
    </div>
  );
}
