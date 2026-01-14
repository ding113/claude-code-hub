"use client";

import { format as formatDate } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateDistance } from "@/lib/utils/date-format";

interface RelativeTimeProps {
  date: string | Date | null;
  className?: string;
  fallback?: string;
  autoUpdate?: boolean;
  updateInterval?: number;
  format?: "full" | "short";
}

/**
 * 客户端相对时间显示组件（使用 date-fns + next-intl）
 *
 * 解决 Next.js SSR Hydration 错误：
 * - 服务端渲染占位符
 * - 客户端挂载后显示相对时间
 * - 可选自动更新
 * - 使用 date-fns locale wrapper 支持多语言
 */
export function RelativeTime({
  date,
  className,
  fallback = "—",
  autoUpdate = true,
  updateInterval = 10000, // 默认每 10 秒更新
  format = "full",
}: RelativeTimeProps) {
  const [timeAgo, setTimeAgo] = useState<string>(fallback);
  const [mounted, setMounted] = useState(false);
  const locale = useLocale();
  const tShort = useTranslations("common.relativeTimeShort");

  // Format short distance with i18n
  const formatShortDistance = useCallback(
    (dateObj: Date, now: Date): string => {
      if (Number.isNaN(dateObj.getTime())) return fallback;
      if (dateObj > now) return tShort("now");

      const diffMs = now.getTime() - dateObj.getTime();
      const seconds = Math.floor(diffMs / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      const weeks = Math.floor(days / 7);
      const months = Math.floor(days / 30);
      const years = Math.floor(days / 365);

      if (years > 0) return tShort("yearsAgo", { count: years });
      if (months > 0) return tShort("monthsAgo", { count: months });
      if (weeks > 0) return tShort("weeksAgo", { count: weeks });
      if (days > 0) return tShort("daysAgo", { count: days });
      if (hours > 0) return tShort("hoursAgo", { count: hours });
      if (minutes > 0) return tShort("minutesAgo", { count: minutes });
      if (seconds > 0) return tShort("secondsAgo", { count: seconds });

      return tShort("now");
    },
    [tShort, fallback]
  );

  // Precompute an absolute timestamp string for tooltip content. Include timezone display.
  const absolute = useMemo(() => {
    if (!date) return fallback;
    const dateObj = typeof date === "string" ? new Date(date) : date;
    if (Number.isNaN(dateObj.getTime())) return fallback;
    // date-fns does not fully support `z` for IANA abbreviations; use `OOOO` to show GMT offset.
    // Example output: 2024-05-01 13:45:12 GMT+08:00
    return formatDate(dateObj, "yyyy-MM-dd HH:mm:ss OOOO");
  }, [date, fallback]);

  useEffect(() => {
    // 如果 date 为 null，直接显示 fallback
    if (!date) {
      setMounted(true);
      return;
    }

    setMounted(true);

    // 计算相对时间
    const updateTime = () => {
      const dateObj = typeof date === "string" ? new Date(date) : date;
      const now = new Date();
      if (format === "short") {
        setTimeAgo(formatShortDistance(dateObj, now));
      } else {
        setTimeAgo(formatDateDistance(dateObj, now, locale));
      }
    };

    updateTime();

    if (!autoUpdate) return;

    // 定时更新时间
    const interval = setInterval(updateTime, updateInterval);

    return () => clearInterval(interval);
  }, [date, autoUpdate, updateInterval, locale, format, formatShortDistance]);

  // 服务端渲染和客户端首次渲染显示占位符
  if (!mounted) {
    return <span className={className}>{fallback}</span>;
  }

  // 客户端挂载后显示相对时间，并在悬停/聚焦时展示绝对时间 Tooltip。
  // 为了键盘可访问性，使触发元素可聚焦（tabIndex=0）。
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time
          className={className}
          // HTMLTimeElement `dateTime` attribute for semantics/SEO
          dateTime={
            typeof date === "string"
              ? new Date(date).toISOString()
              : date
                ? date.toISOString()
                : undefined
          }
        >
          {timeAgo}
        </time>
      </TooltipTrigger>
      <TooltipContent>{absolute}</TooltipContent>
    </Tooltip>
  );
}
