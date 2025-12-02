"use client";

import { AlertTriangle, Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCountdown } from "@/hooks/useCountdown";
import { cn } from "@/lib/utils";

interface QuotaCountdownProps {
  resetAt: Date | null;
  label?: string;
  className?: string;
  showIcon?: boolean;
  size?: "sm" | "md" | "lg";
}

/**
 * 限额倒计时组件
 *
 * 根据剩余时间显示不同颜色：
 * - 绿色（正常）：> 24 小时
 * - 黄色（预警）：> 1 小时 && <= 24 小时
 * - 橙色（警告）：> 10 分钟 && <= 1 小时
 * - 红色（紧急）：<= 10 分钟
 *
 * @example
 * ```tsx
 * <QuotaCountdown
 *   resetAt={resetTime}
 *   label="重置倒计时"
 *   showIcon
 * />
 * ```
 */
export function QuotaCountdown({
  resetAt,
  label,
  className,
  showIcon = true,
  size = "md",
}: QuotaCountdownProps) {
  const t = useTranslations("quota");
  const resolvedLabel = label ?? t("countdown.reset");
  const countdown = useCountdown(resetAt);

  // 根据剩余时间判断状态
  const getStatus = () => {
    if (countdown.isExpired) return "expired";
    if (countdown.totalSeconds > 86400) return "normal"; // > 24h
    if (countdown.totalSeconds > 3600) return "warning"; // > 1h
    if (countdown.totalSeconds > 600) return "danger"; // > 10min
    return "critical"; // <= 10min
  };

  const status = getStatus();

  // 状态样式映射
  const statusStyles = {
    expired: "text-muted-foreground",
    normal: "text-green-600 dark:text-green-400",
    warning: "text-yellow-600 dark:text-yellow-400",
    danger: "text-orange-600 dark:text-orange-400",
    critical: "text-red-600 dark:text-red-400 animate-pulse",
  };

  // 尺寸样式
  const sizeStyles = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
  };

  const iconSizes = {
    sm: "h-3 w-3",
    md: "h-4 w-4",
    lg: "h-5 w-5",
  };

  // 选择图标
  const Icon = status === "critical" ? AlertTriangle : Clock;

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {showIcon && <Icon className={cn(iconSizes[size], statusStyles[status])} />}
      <div className={cn("flex flex-col", sizeStyles[size])}>
        {resolvedLabel && <span className="text-muted-foreground">{resolvedLabel}:</span>}
        <span className={cn("font-mono font-medium tabular-nums", statusStyles[status])}>
          {countdown.formatted}
        </span>
      </div>
    </div>
  );
}

/**
 * 简短倒计时组件（仅显示时间，无标签）
 */
export function QuotaCountdownCompact({
  resetAt,
  className,
}: {
  resetAt: Date | null;
  className?: string;
}) {
  const countdown = useCountdown(resetAt);

  const getStatus = () => {
    if (countdown.isExpired) return "expired";
    if (countdown.totalSeconds > 86400) return "normal";
    if (countdown.totalSeconds > 3600) return "warning";
    if (countdown.totalSeconds > 600) return "danger";
    return "critical";
  };

  const status = getStatus();

  const statusStyles = {
    expired: "text-muted-foreground",
    normal: "text-green-600 dark:text-green-400",
    warning: "text-yellow-600 dark:text-yellow-400",
    danger: "text-orange-600 dark:text-orange-400",
    critical: "text-red-600 dark:text-red-400 animate-pulse",
  };

  return (
    <span
      className={cn("font-mono text-xs font-medium tabular-nums", statusStyles[status], className)}
    >
      {countdown.shortFormatted}
    </span>
  );
}

/**
 * 带百分比进度条的倒计时
 */
export function QuotaCountdownWithProgress({
  resetAt,
  startAt,
  label,
  className,
}: {
  resetAt: Date | null;
  startAt?: Date | null;
  label?: string;
  className?: string;
}) {
  const t = useTranslations("quota");
  const countdown = useCountdown(resetAt);
  const resolvedLabel = label ?? t("countdown.reset");

  // 计算进度百分比
  const getProgress = () => {
    if (!resetAt || countdown.isExpired) return 100;

    const now = Date.now();
    const target = new Date(resetAt).getTime();
    const start = startAt ? new Date(startAt).getTime() : now;

    const total = target - start;
    const elapsed = now - start;

    if (total <= 0) return 100;

    return Math.min(100, Math.max(0, (elapsed / total) * 100));
  };

  const progress = getProgress();

  // 根据进度判断颜色
  const getProgressColor = () => {
    if (progress >= 90) return "bg-red-500";
    if (progress >= 75) return "bg-orange-500";
    if (progress >= 50) return "bg-yellow-500";
    return "bg-green-500";
  };

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{resolvedLabel}</span>
        <QuotaCountdownCompact resetAt={resetAt} />
      </div>
      <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full transition-all duration-300", getProgressColor())}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
