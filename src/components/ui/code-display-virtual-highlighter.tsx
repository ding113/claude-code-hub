"use client";

import { Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Button } from "@/components/ui/button";
import {
  type BuildLineIndexErrorCode,
  buildLineIndex,
} from "@/components/ui/code-display-worker-client";
import { cn, getTextKey } from "@/lib/utils";

type RangeState = {
  startLine: number;
  endLine: number;
  renderStartLine: number;
  renderEndLine: number;
  contextOffsetPx: number;
  topPadPx: number;
  bottomPadPx: number;
  windowText: string;
};

export function CodeDisplayVirtualHighlighter({
  text,
  language,
  maxHeight,
  resolvedTheme,
  lineHeightPx,
  overscanLines,
  contextLines,
  maxLines,
  workerEnabled,
  perfDebugEnabled,
  className,
  onRequestPlainView,
}: {
  text: string;
  language: "json" | "text";
  maxHeight?: string;
  resolvedTheme: "light" | "dark";
  lineHeightPx: number;
  overscanLines: number;
  contextLines: number;
  maxLines: number;
  workerEnabled: boolean;
  perfDebugEnabled: boolean;
  className?: string;
  onRequestPlainView?: (reason?: BuildLineIndexErrorCode, lineCount?: number) => void;
}) {
  const t = useTranslations("dashboard.sessions");

  const highlighterStyle = resolvedTheme === "dark" ? oneDark : oneLight;
  const textRef = useRef(text);
  textRef.current = text;

  const textKey = useMemo(() => getTextKey(text), [text]);
  const onRequestPlainViewRef = useRef(onRequestPlainView);
  onRequestPlainViewRef.current = onRequestPlainView;

  const [indexStatus, setIndexStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [indexProgress, setIndexProgress] = useState<{ processed: number; total: number } | null>(
    null
  );
  const [lineStarts, setLineStarts] = useState<Int32Array | null>(null);
  const [lineCount, setLineCount] = useState(0);

  const indexAbortRef = useRef<AbortController | null>(null);
  const indexJobRef = useRef(0);

  useEffect(() => {
    const currentText = textRef.current;
    const currentTextKey = textKey;
    const jobId = (indexJobRef.current += 1);

    indexAbortRef.current?.abort();
    const controller = new AbortController();
    indexAbortRef.current = controller;

    setIndexStatus("loading");
    setIndexProgress({ processed: 0, total: currentText.length });
    setLineStarts(null);
    setLineCount(0);

    const start = performance.now();
    void buildLineIndex({
      text: currentText,
      maxLines,
      onProgress: (p) => {
        if (controller.signal.aborted) return;
        if (p.stage !== "index") return;
        setIndexProgress({ processed: p.processed, total: p.total });
      },
      signal: controller.signal,
      workerEnabled,
    }).then((res) => {
      if (controller.signal.aborted) return;
      if (jobId !== indexJobRef.current) return;

      const costMs = Math.round(performance.now() - start);
      if (perfDebugEnabled) {
        console.debug("CodeDisplay buildLineIndex", {
          costMs,
          textKey: currentTextKey,
          inputChars: currentText.length,
          ok: res.ok,
          errorCode: res.ok ? undefined : res.errorCode,
          lineCount: res.lineCount,
        });
      }

      if (!res.ok) {
        setIndexStatus("error");
        setIndexProgress(null);
        onRequestPlainViewRef.current?.(res.errorCode, res.lineCount);
        return;
      }

      setLineStarts(res.lineStarts);
      setLineCount(res.lineCount);
      setIndexStatus("ready");
      setIndexProgress(null);
    });

    return () => controller.abort();
  }, [maxLines, perfDebugEnabled, textKey, workerEnabled]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const scrollTopRef = useRef(0);
  const rangeRef = useRef<RangeState | null>(null);

  const [viewportHeight, setViewportHeight] = useState(0);
  const [range, setRange] = useState<RangeState | null>(null);

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

  const updateThresholdLines = Math.max(1, Math.floor(overscanLines / 2));

  const updateWindow = useCallback(
    (force: boolean) => {
      const starts = lineStarts;
      if (!starts) return;
      const lc = lineCount;
      if (lc <= 0) return;

      const currentText = textRef.current;
      const scrollTop = scrollTopRef.current;
      const height = viewportHeight;

      const visibleStart = Math.floor(scrollTop / lineHeightPx);
      const visibleEnd = Math.ceil((scrollTop + height) / lineHeightPx);

      const startLine = Math.max(0, visibleStart - overscanLines);
      const endLine = Math.min(lc, visibleEnd + overscanLines);
      const renderStartLine = Math.max(0, startLine - contextLines);
      const renderEndLine = endLine;

      const prev = rangeRef.current;
      if (!force && prev) {
        if (
          Math.abs(startLine - prev.startLine) < updateThresholdLines &&
          Math.abs(endLine - prev.endLine) < updateThresholdLines
        ) {
          return;
        }
      }

      const startOffset = starts[renderStartLine] ?? 0;
      const endOffset =
        renderEndLine < lc ? (starts[renderEndLine] ?? currentText.length) : currentText.length;

      const contextOffsetPx = (startLine - renderStartLine) * lineHeightPx;
      const topPadPx = startLine * lineHeightPx;
      const bottomPadPx = (lc - endLine) * lineHeightPx;

      const next: RangeState = {
        startLine,
        endLine,
        renderStartLine,
        renderEndLine,
        contextOffsetPx,
        topPadPx,
        bottomPadPx,
        windowText: currentText.slice(startOffset, endOffset),
      };

      rangeRef.current = next;
      setRange(next);
    },
    [
      contextLines,
      lineCount,
      lineHeightPx,
      lineStarts,
      overscanLines,
      updateThresholdLines,
      viewportHeight,
    ]
  );

  useEffect(() => {
    if (indexStatus !== "ready") return;
    updateWindow(true);
  }, [indexStatus, updateWindow]);

  if (indexStatus === "loading") {
    const percent =
      indexProgress && indexProgress.total > 0
        ? Math.floor((indexProgress.processed / indexProgress.total) * 100)
        : 0;

    return (
      <div data-testid="code-display-virtual-highlighter" className={cn("space-y-3", className)}>
        <div className="flex items-center justify-between gap-3 rounded-md border border-border/50 bg-background/40 p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{t("codeDisplay.virtual.indexWorking", { percent })}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              indexAbortRef.current?.abort();
              onRequestPlainViewRef.current?.("CANCELED");
            }}
            className="h-8"
          >
            <X className="h-4 w-4 mr-2" />
            {t("codeDisplay.cancel")}
          </Button>
        </div>
      </div>
    );
  }

  if (indexStatus !== "ready" || !lineStarts || !range) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      data-testid="code-display-virtual-highlighter"
      className={cn("overflow-auto rounded-md border border-border/50 bg-transparent", className)}
      style={{ maxHeight }}
      onScroll={(e) => {
        scrollTopRef.current = e.currentTarget.scrollTop;
        if (rafRef.current !== null) return;
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          updateWindow(false);
        });
      }}
    >
      <div style={{ height: range.topPadPx }} />
      <div style={{ marginTop: -range.contextOffsetPx }}>
        <SyntaxHighlighter
          language={language}
          style={highlighterStyle}
          customStyle={{
            margin: 0,
            padding: 0,
            background: "transparent",
            fontSize: "12px",
            whiteSpace: "pre",
            lineHeight: `${lineHeightPx}px`,
          }}
        >
          {range.windowText}
        </SyntaxHighlighter>
      </div>
      <div style={{ height: range.bottomPadPx }} />
    </div>
  );
}
