"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

function getLineRange(
  text: string,
  lineStarts: Int32Array,
  lineNo: number
): [start: number, end: number] {
  const lineCount = lineStarts.length;
  if (lineNo < 0) return [0, 0];
  if (lineNo >= lineCount) return [text.length, text.length];

  const start = lineStarts[lineNo] ?? 0;
  const nextStart = lineNo + 1 < lineCount ? (lineStarts[lineNo + 1] ?? text.length) : text.length;

  // slice(start, end) 的 end 是排他上界：
  // - 对非最后一行：nextStart 指向下一行行首（通常是 '\n' 后的索引）
  // - 对最后一行：nextStart === text.length
  let end = nextStart;
  if (nextStart > start && text.charCodeAt(nextStart - 1) === 10) {
    end = nextStart - 1; // 去掉 '\n'
    if (end > start && text.charCodeAt(end - 1) === 13) {
      end -= 1; // 兼容 CRLF：去掉 '\r'
    }
  }

  end = Math.max(start, end);
  return [start, end];
}

export function CodeDisplayMatchesList({
  text,
  matches,
  lineStarts,
  maxHeight,
  lineHeightPx,
  overscan = 20,
  className,
}: {
  text: string;
  matches: Int32Array;
  lineStarts: Int32Array;
  maxHeight?: string;
  lineHeightPx: number;
  overscan?: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const scrollTopRef = useRef(0);

  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => setViewportHeight(el.clientHeight);
    update();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(el);
    }

    window.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  const totalRows = matches.length;
  const { startIndex, endIndex, topPad, bottomPad } = useMemo(() => {
    if (viewportHeight <= 0) {
      return { startIndex: 0, endIndex: Math.min(totalRows, 50), topPad: 0, bottomPad: 0 };
    }

    const start = Math.max(0, Math.floor(scrollTop / lineHeightPx) - overscan);
    const end = Math.min(
      totalRows,
      Math.ceil((scrollTop + viewportHeight) / lineHeightPx) + overscan
    );
    const top = start * lineHeightPx;
    const bottom = (totalRows - end) * lineHeightPx;
    return { startIndex: start, endIndex: end, topPad: top, bottomPad: bottom };
  }, [lineHeightPx, overscan, scrollTop, totalRows, viewportHeight]);

  return (
    <div
      ref={containerRef}
      data-testid="code-display-matches-list"
      className={cn(
        "overflow-auto rounded-md border border-border/50 bg-transparent font-mono text-xs",
        className
      )}
      style={maxHeight ? { maxHeight } : undefined}
      onScroll={(e) => {
        const next = e.currentTarget.scrollTop;
        scrollTopRef.current = next;
        if (rafRef.current !== null) return;
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          setScrollTop(scrollTopRef.current);
        });
      }}
    >
      <div style={{ height: topPad }} />
      <div className="min-w-max">
        {Array.from({ length: Math.max(0, endIndex - startIndex) }, (_, localIdx) => {
          const idx = startIndex + localIdx;
          const lineNo = matches[idx] ?? 0;
          const [start, end] = getLineRange(text, lineStarts, lineNo);
          const lineText = text.slice(start, end);

          return (
            <div
              // idx 作为 key 已足够：matches 是稳定数组（仅随查询/内容变化）
              key={idx}
              className="flex items-center gap-3 px-3"
              style={{ height: lineHeightPx, lineHeight: `${lineHeightPx}px` }}
            >
              <span className="w-14 shrink-0 text-muted-foreground tabular-nums">{lineNo + 1}</span>
              <span className="whitespace-pre">{lineText}</span>
            </div>
          );
        })}
      </div>
      <div style={{ height: bottomPad }} />
    </div>
  );
}
