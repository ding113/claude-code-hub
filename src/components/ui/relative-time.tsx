"use client";

import { format as formatDate } from "date-fns";
import { useLocale } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateDistance } from "@/lib/utils/date-format";

interface RelativeTimeProps {
  date: string | Date | null;
  className?: string;
  fallback?: string;
  autoUpdate?: boolean;
  updateInterval?: number;
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
}: RelativeTimeProps) {
  const [timeAgo, setTimeAgo] = useState<string>(fallback);
  const [mounted, setMounted] = useState(false);
  const locale = useLocale();

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
      setTimeAgo(formatDateDistance(dateObj, new Date(), locale));
    };

    updateTime();

    if (!autoUpdate) return;

    // 定时更新时间
    const interval = setInterval(updateTime, updateInterval);

    return () => clearInterval(interval);
  }, [date, autoUpdate, updateInterval, locale]);

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
