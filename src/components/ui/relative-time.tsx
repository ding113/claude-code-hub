"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
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

  // 客户端挂载后显示相对时间
  return <span className={className}>{timeAgo}</span>;
}
