"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export function CodeDisplayPlainTextarea({
  value,
  className,
  maxHeight,
  lineHeightPx = 18,
}: {
  value: string;
  className?: string;
  maxHeight?: string;
  lineHeightPx?: number;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // 对超长文本，避免频繁 React 受控更新导致卡顿：
  // - defaultValue 用于首屏/首次渲染
  // - 后续变更通过 effect 直接写入 DOM
  useEffect(() => {
    if (!ref.current) return;
    if (ref.current.value === value) return;
    ref.current.value = value;
  }, [value]);

  return (
    <textarea
      ref={ref}
      readOnly
      spellCheck={false}
      className={cn(
        "w-full resize-none bg-transparent font-mono text-xs outline-none",
        "whitespace-pre overflow-auto rounded-md border border-border/50 p-3",
        className
      )}
      style={{ maxHeight, lineHeight: `${lineHeightPx}px` }}
      defaultValue={value}
    />
  );
}
