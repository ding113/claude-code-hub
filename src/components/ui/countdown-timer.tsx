"use client";

import { useState, useEffect } from "react";
import { useLocale } from "next-intl";
import { formatDateDistance } from "@/lib/utils/date-format";

interface CountdownTimerProps {
  /** 目标时间 */
  targetDate: Date;
  /** 前缀文本 */
  prefix?: string;
  /** 自定义类名 */
  className?: string;
}

/**
 * 倒计时组件
 * 实时显示距离目标时间的剩余时间
 */
export function CountdownTimer({ targetDate, prefix, className }: CountdownTimerProps) {
  const locale = useLocale();
  const [timeLeft, setTimeLeft] = useState<string>("");

  useEffect(() => {
    // 更新倒计时显示
    const updateCountdown = () => {
      const formatted = formatDateDistance(targetDate, new Date(), locale);
      setTimeLeft(formatted);
    };

    // 立即更新一次
    updateCountdown();

    // 每30秒更新一次（减少不必要的渲染）
    const interval = setInterval(updateCountdown, 30000);

    return () => clearInterval(interval);
  }, [targetDate, locale]);

  if (!timeLeft) return null;

  return (
    <span className={className}>
      {prefix}
      {timeLeft}
    </span>
  );
}
