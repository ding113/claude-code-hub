"use client";

import type { LucideIcon } from "lucide-react";
import * as React from "react";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: number | string;
  description?: string;
  icon?: LucideIcon;
  formatter?: (value: number) => string;
  className?: string;
}

/**
 * 指标卡片组件
 * 支持数字变化时的平滑动画
 */
export function MetricCard({
  title,
  value,
  description,
  icon: Icon,
  formatter,
  className,
}: MetricCardProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevValueRef = React.useRef(value);

  useEffect(() => {
    if (typeof value === "number" && typeof prevValueRef.current === "number") {
      if (value !== prevValueRef.current) {
        setIsAnimating(true);
        // 使用 requestAnimationFrame 实现平滑动画
        const duration = 500; // 动画时长500ms
        const startValue = prevValueRef.current;
        const diff = value - startValue;
        const startTime = Date.now();

        const animate = () => {
          const elapsed = Date.now() - startTime;
          const progress = Math.min(elapsed / duration, 1);

          // 使用 easeOutCubic 缓动函数
          const easeProgress = 1 - (1 - progress) ** 3;
          const currentValue = startValue + diff * easeProgress;

          setDisplayValue(currentValue);

          if (progress < 1) {
            requestAnimationFrame(animate);
          } else {
            setIsAnimating(false);
            prevValueRef.current = value;
          }
        };

        requestAnimationFrame(animate);
      }
    } else {
      setDisplayValue(value);
      prevValueRef.current = value;
    }
  }, [value]);

  // 格式化显示值
  const formattedValue =
    typeof displayValue === "number" && formatter
      ? formatter(Math.round(displayValue))
      : typeof displayValue === "number"
        ? Math.round(displayValue).toLocaleString()
        : displayValue;

  return (
    <Card className={cn("transition-colors duration-200", className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "text-2xl font-bold transition-opacity duration-200",
            isAnimating && "opacity-80"
          )}
        >
          {formattedValue}
        </div>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </CardContent>
    </Card>
  );
}
