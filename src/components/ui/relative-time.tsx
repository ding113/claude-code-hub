"use client";

import { useEffect, useState } from "react";
import { format } from "timeago.js";

interface RelativeTimeProps {
  date: string | Date | null;
  locale?: string;
  className?: string;
  fallback?: string;
  autoUpdate?: boolean;
  updateInterval?: number;
}

/**
 * 客户端相对时间显示组件
 *
 * 解决 Next.js SSR Hydration 错误：
 * - 服务端渲染占位符
 * - 客户端挂载后显示相对时间
 * - 可选自动更新
 */
export function RelativeTime({
  date,
  locale = "zh_CN",
  className,
  fallback = "—",
  autoUpdate = true,
  updateInterval = 10000, // 默认每 10 秒更新
}: RelativeTimeProps) {
  const [timeAgo, setTimeAgo] = useState<string>(fallback);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // 如果 date 为 null，直接显示 fallback
    if (!date) {
      setMounted(true);
      return;
    }

    setMounted(true);
    setTimeAgo(format(date, locale));

    if (!autoUpdate) return;

    // 定时更新时间
    const interval = setInterval(() => {
      setTimeAgo(format(date, locale));
    }, updateInterval);

    return () => clearInterval(interval);
  }, [date, locale, autoUpdate, updateInterval]);

  // 服务端渲染和客户端首次渲染显示占位符
  if (!mounted) {
    return <span className={className}>{fallback}</span>;
  }

  // 客户端挂载后显示相对时间
  return <span className={className}>{timeAgo}</span>;
}
