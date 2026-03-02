"use client";

import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  File as FileIcon,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCodeDisplayConfig } from "@/components/ui/code-display-config-context";
import { CodeDisplayMatchesList } from "@/components/ui/code-display-matches-list";
import { CodeDisplayPlainTextarea } from "@/components/ui/code-display-plain-textarea";
import { CodeDisplayVirtualHighlighter } from "@/components/ui/code-display-virtual-highlighter";
import {
  type BuildLineIndexErrorCode,
  buildLineIndex,
  formatJsonPretty,
  type SearchLinesErrorCode,
  searchLines,
} from "@/components/ui/code-display-worker-client";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { cn, getTextKey } from "@/lib/utils";

export type CodeDisplayLanguage = "json" | "sse" | "text";

const DEFAULT_MAX_CONTENT_BYTES = 1_000_000; // 1MB
const DEFAULT_MAX_LINES = 10_000;
const DEFAULT_JSON_INDENT = 2;
const MAX_SYNC_JSON_CHARS = 200_000;
const LARGE_CONTENT_MAX_CHARS = 4000;
const LARGE_CONTENT_MAX_LINES = 200;
const SSE_VIRTUAL_THRESHOLD = 200;
const SSE_ESTIMATED_ROW_HEIGHT_PX = 44;
const SSE_OVERSCAN = 12;

type DisplaySseEvent = { event: string; data: string };

function safeJsonParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function stringifyPretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function CodeDisplaySseDataSyntaxHighlighter({
  data,
  highlighterStyle,
}: {
  data: string;
  highlighterStyle: typeof oneDark;
}) {
  const highlightedText = useMemo(() => {
    const parsed = safeJsonParse(data);
    return parsed.ok ? stringifyPretty(parsed.value) : data;
  }, [data]);

  return (
    <SyntaxHighlighter
      language="json"
      style={highlighterStyle}
      customStyle={{
        margin: 0,
        background: "transparent",
        fontSize: "12px",
      }}
    >
      {highlightedText}
    </SyntaxHighlighter>
  );
}

/**
 * 统计 UTF-8 字节数，最多统计到超过 limitBytes 为止。
 *
 * 当返回值 > limitBytes 时，表示“已超过上限”（返回值不代表真实总字节数）。
 */
function countUtf8BytesUpToLimit(text: string, limitBytes: number): number {
  let bytes = 0;

  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }

    if (bytes > limitBytes) return bytes;
  }

  return bytes;
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [""];
  // 小内容路径：兼容 CRLF/CR，避免 only-matches 在 Windows 行尾下错判。
  if (!text.includes("\r")) return text.split("\n");
  return text.replace(/\r\n?/g, "\n").split("\n");
}

function countLinesUpTo(text: string, maxLines: number): number {
  if (text.length === 0) return 1;
  let count = 1;
  const total = text.length;
  for (let i = 0; i < total; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 10) {
      count += 1;
    } else if (code === 13) {
      count += 1;
      // CRLF 视为一个换行
      if (i + 1 < total && text.charCodeAt(i + 1) === 10) i += 1;
    }
    if (count >= maxLines) return count;
  }
  return count;
}

function getDefaultMode(language: CodeDisplayLanguage): "raw" | "pretty" {
  if (language === "text") return "raw";
  return "pretty";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// NOTE: 这里不复用 `parseSSEDataForDisplay`：它会 split 整段文本并尝试 JSON.parse(data)，
// 对超长 SSE 内容容易造成额外内存/CPU 开销。CodeDisplay 只需要用于展示的轻量解析（保留 string data）。
function parseSseForCodeDisplay(sseText: string): DisplaySseEvent[] {
  const events: DisplaySseEvent[] = [];

  let eventName = "";
  let dataLines: string[] = [];

  const flushEvent = () => {
    if (dataLines.length === 0) {
      eventName = "";
      dataLines = [];
      return;
    }

    const dataStr = dataLines.join("\n");
    if (dataStr.trim() === "[DONE]") {
      eventName = "";
      dataLines = [];
      return;
    }

    events.push({ event: eventName || "message", data: dataStr });
    eventName = "";
    dataLines = [];
  };

  let start = 0;
  for (let i = 0; i <= sseText.length; i += 1) {
    if (i !== sseText.length && sseText.charCodeAt(i) !== 10) continue;

    let line = sseText.slice(start, i);
    start = i + 1;

    if (line.endsWith("\r")) {
      line = line.slice(0, -1);
    }

    if (!line) {
      flushEvent();
      continue;
    }

    if (line.startsWith(":")) continue;

    if (line.startsWith("event:")) {
      eventName = line.substring(6).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      let value = line.substring(5);
      if (value.startsWith(" ")) value = value.slice(1);
      dataLines.push(value);
    }
  }

  flushEvent();
  return events;
}

function buildOnlyMatchesText(text: string, lineStarts: Int32Array, matches: Int32Array): string {
  const out: string[] = [];
  const lineCount = lineStarts.length;

  for (let i = 0; i < matches.length; i += 1) {
    const lineNo = matches[i] ?? 0;
    if (lineNo < 0 || lineNo >= lineCount) continue;

    const start = lineStarts[lineNo] ?? 0;
    const nextStart =
      lineNo + 1 < lineCount ? (lineStarts[lineNo + 1] ?? text.length) : text.length;
    let end = nextStart;
    if (nextStart > start) {
      const last = text.charCodeAt(nextStart - 1);
      if (last === 10) {
        end = nextStart - 1;
        if (end > start && text.charCodeAt(end - 1) === 13) {
          end -= 1;
        }
      } else if (last === 13) {
        end = nextStart - 1;
      }
    }
    end = Math.max(start, end);
    out.push(text.slice(start, end));
  }

  return out.join("\n");
}

function CodeDisplaySseEvents({
  events,
  maxHeight,
  resolvedTheme,
  highlightMaxChars,
  largePlainEnabled,
  lineHeightPx,
  labels,
}: {
  events: DisplaySseEvent[];
  maxHeight: string | undefined;
  resolvedTheme: "light" | "dark";
  highlightMaxChars: number;
  largePlainEnabled: boolean;
  lineHeightPx: number;
  labels: {
    noMatches: string;
    sseEvent: string;
    sseData: string;
  };
}) {
  const highlighterStyle = resolvedTheme === "dark" ? oneDark : oneLight;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const scrollTopRef = useRef(0);

  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(() => new Set());
  const lastEventsRef = useRef<DisplaySseEvent[] | null>(null);

  useEffect(() => {
    if (lastEventsRef.current === null) {
      lastEventsRef.current = events;
      return;
    }
    // events 可能由搜索过滤产生新列表：重置展开状态以避免索引错位
    lastEventsRef.current = events;
    setExpandedRows(new Set());
  }, [events]);

  useEffect(() => {
    const el = scrollRef.current;
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

  if (events.length === 0) {
    return <div className="text-xs text-muted-foreground">{labels.noMatches}</div>;
  }

  const useVirtual =
    events.length > SSE_VIRTUAL_THRESHOLD && expandedRows.size === 0 && viewportHeight > 0;
  // SSE 列表的单行高度与代码行高不同，这里使用一个固定估算值用于折叠态虚拟化。
  const estimatedRowHeight = SSE_ESTIMATED_ROW_HEIGHT_PX;
  const overscan = SSE_OVERSCAN;
  const total = events.length;

  const startIndex = useVirtual
    ? Math.max(0, Math.floor(scrollTop / estimatedRowHeight) - overscan)
    : 0;
  const endIndex = useVirtual
    ? Math.min(total, Math.ceil((scrollTop + viewportHeight) / estimatedRowHeight) + overscan)
    : total;

  const topPad = useVirtual ? startIndex * estimatedRowHeight : 0;
  const bottomPad = useVirtual ? (total - endIndex) * estimatedRowHeight : 0;
  const rows = events.slice(startIndex, endIndex);

  return (
    <div
      ref={scrollRef}
      className="overflow-auto"
      style={maxHeight ? { maxHeight } : undefined}
      onScroll={(e) => {
        const next = e.currentTarget.scrollTop;
        scrollTopRef.current = next;
        if (!useVirtual) return;
        if (rafRef.current !== null) return;
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          setScrollTop(scrollTopRef.current);
        });
      }}
    >
      <div className="space-y-2">
        {topPad > 0 && <div style={{ height: topPad }} />}
        {rows.map((evt, localIdx) => {
          const index = startIndex + localIdx;
          const open = expandedRows.has(index);
          const preview = evt.data.length > 120 ? `${evt.data.slice(0, 120)}...` : evt.data;

          return (
            <div
              key={index}
              data-testid="code-display-sse-row"
              className="rounded-md border bg-background/50"
            >
              <details open={open}>
                <summary
                  className="cursor-pointer select-none px-3 py-2"
                  onClick={(e) => {
                    e.preventDefault();
                    setExpandedRows((prev) => {
                      const next = new Set(prev);
                      if (next.has(index)) next.delete(index);
                      else next.add(index);
                      return next;
                    });
                  }}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                      {index + 1}
                    </span>
                    <span className="shrink-0 font-mono text-xs">{evt.event}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {preview}
                    </span>
                  </div>
                </summary>

                {open && (
                  <div className="px-3 pb-3 pt-2 space-y-2">
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">{labels.sseEvent}</div>
                      <div className="font-mono text-xs break-all">{evt.event}</div>
                    </div>

                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">{labels.sseData}</div>
                      {evt.data.length <= highlightMaxChars ? (
                        <CodeDisplaySseDataSyntaxHighlighter
                          data={evt.data}
                          highlighterStyle={highlighterStyle}
                        />
                      ) : largePlainEnabled ? (
                        <CodeDisplayPlainTextarea
                          value={evt.data}
                          maxHeight="260px"
                          lineHeightPx={lineHeightPx}
                          className="border-0 bg-transparent p-0"
                        />
                      ) : (
                        <div className="overflow-auto" style={{ maxHeight: "260px" }}>
                          <pre
                            className="text-xs whitespace-pre-wrap break-words font-mono"
                            style={{ lineHeight: `${lineHeightPx}px` }}
                          >
                            {evt.data}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </details>
            </div>
          );
        })}
        {bottomPad > 0 && <div style={{ height: bottomPad }} />}
      </div>
    </div>
  );
}

export interface CodeDisplayProps {
  content: string;
  language: CodeDisplayLanguage;
  fileName?: string;
  maxHeight?: string;
  expandedMaxHeight?: string;
  defaultExpanded?: boolean;
  maxContentBytes?: number;
  maxLines?: number;
  enableDownload?: boolean;
  enableCopy?: boolean;
  className?: string;
}

export function CodeDisplay({
  content,
  language,
  fileName,
  maxHeight = "600px",
  expandedMaxHeight,
  defaultExpanded = false,
  maxContentBytes,
  maxLines,
  enableDownload = true,
  enableCopy = true,
  className,
}: CodeDisplayProps) {
  const t = useTranslations("dashboard.sessions");
  const tActions = useTranslations("dashboard.actions");
  const codeDisplayConfig = useCodeDisplayConfig();

  const resolvedMaxContentBytes = maxContentBytes ?? DEFAULT_MAX_CONTENT_BYTES;
  const resolvedMaxLines = maxLines ?? DEFAULT_MAX_LINES;

  const contentBytes = useMemo(
    () => countUtf8BytesUpToLimit(content, resolvedMaxContentBytes + 1),
    [content, resolvedMaxContentBytes]
  );
  const isOverMaxBytes = contentBytes > resolvedMaxContentBytes;

  const lineCount = useMemo(() => {
    if (isOverMaxBytes) return 0;
    return countLinesUpTo(content, resolvedMaxLines + 1);
  }, [content, isOverMaxBytes, resolvedMaxLines]);

  const isLargeContent =
    content.length > LARGE_CONTENT_MAX_CHARS || lineCount > LARGE_CONTENT_MAX_LINES;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isExpanded = expanded || !isLargeContent;
  const contentMaxHeight = isExpanded ? expandedMaxHeight : maxHeight;

  const isHardLimited = isOverMaxBytes || lineCount > resolvedMaxLines;

  const [mode, setMode] = useState<"raw" | "pretty">(() => getDefaultMode(language));
  const [searchQuery, setSearchQuery] = useState("");
  const [showOnlyMatches, setShowOnlyMatches] = useState(false);
  const [largePrettyView, setLargePrettyView] = useState<"plain" | "virtual">("plain");
  const [forceLargePrettyPlain, setForceLargePrettyPlain] = useState(false);

  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");
  const [copied, setCopied] = useState(false);

  const lastLanguageRef = useRef(language);
  useEffect(() => {
    const prevLanguage = lastLanguageRef.current;
    if (prevLanguage === language) return;
    lastLanguageRef.current = language;

    const prevDefault = getDefaultMode(prevLanguage);
    const nextDefault = getDefaultMode(language);

    // 仅在用户未显式切换（仍处于上一个语言默认值）时，跟随语言更新默认模式。
    setMode((current) => (current === prevDefault ? nextDefault : current));
  }, [language]);

  useEffect(() => {
    const getTheme = () => (document.documentElement.classList.contains("dark") ? "dark" : "light");

    setResolvedTheme(getTheme());

    const observer = new MutationObserver(() => setResolvedTheme(getTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => observer.disconnect();
  }, []);

  const shouldFormatJsonInWorker =
    language === "json" &&
    !isHardLimited &&
    codeDisplayConfig.workerEnabled &&
    content.length > codeDisplayConfig.highlightMaxChars;

  const jsonSourceKey = useMemo(() => getTextKey(content), [content]);

  const shouldRunJsonPrettyJob = shouldFormatJsonInWorker && mode === "pretty";

  const jsonPrettyReqIdRef = useRef(0);
  const jsonPrettyAbortRef = useRef<AbortController | null>(null);
  const [jsonPrettyText, setJsonPrettyText] = useState<string | null>(null);
  const [jsonPrettyTextKey, setJsonPrettyTextKey] = useState<string | null>(null);
  const [jsonPrettyStatus, setJsonPrettyStatus] = useState<
    "idle" | "loading" | "ready" | "invalid" | "tooLarge" | "canceled" | "error"
  >("idle");
  const [jsonPrettyErrorCode, setJsonPrettyErrorCode] = useState<string | null>(null);
  const [jsonPrettyProgress, setJsonPrettyProgress] = useState<{
    processed: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      jsonPrettyAbortRef.current?.abort();
      jsonPrettyAbortRef.current = null;
    };
  }, []);

  const cancelJsonPretty = () => {
    jsonPrettyAbortRef.current?.abort();
    jsonPrettyAbortRef.current = null;
    setJsonPrettyText(null);
    setJsonPrettyTextKey(jsonSourceKey);
    setJsonPrettyStatus("canceled");
    setJsonPrettyErrorCode("CANCELED");
    setJsonPrettyProgress(null);
  };

  const retryJsonPretty = () => {
    jsonPrettyAbortRef.current?.abort();
    jsonPrettyAbortRef.current = null;
    setJsonPrettyText(null);
    setJsonPrettyTextKey(null);
    setJsonPrettyStatus("idle");
    setJsonPrettyErrorCode(null);
    setJsonPrettyProgress(null);
  };

  useEffect(() => {
    if (!shouldFormatJsonInWorker) {
      jsonPrettyAbortRef.current?.abort();
      jsonPrettyAbortRef.current = null;
      setJsonPrettyText(null);
      setJsonPrettyTextKey(null);
      setJsonPrettyStatus("idle");
      setJsonPrettyErrorCode(null);
      setJsonPrettyProgress(null);
      return;
    }

    if (jsonPrettyTextKey && jsonPrettyTextKey !== jsonSourceKey) {
      setJsonPrettyText(null);
      setJsonPrettyTextKey(null);
      setJsonPrettyStatus("idle");
      setJsonPrettyProgress(null);
    }

    if (!shouldRunJsonPrettyJob) {
      jsonPrettyAbortRef.current?.abort();
      jsonPrettyAbortRef.current = null;
      if (jsonPrettyStatus === "loading") {
        setJsonPrettyText(null);
        setJsonPrettyStatus("canceled");
        setJsonPrettyProgress(null);
      }
      if (jsonPrettyStatus === "canceled" || jsonPrettyStatus === "error") {
        setJsonPrettyStatus("idle");
        setJsonPrettyProgress(null);
      }
      return;
    }

    if (
      jsonPrettyTextKey === jsonSourceKey &&
      (jsonPrettyStatus === "loading" ||
        jsonPrettyStatus === "ready" ||
        jsonPrettyStatus === "invalid" ||
        jsonPrettyStatus === "tooLarge" ||
        jsonPrettyStatus === "canceled" ||
        jsonPrettyStatus === "error")
    ) {
      return;
    }

    const reqId = (jsonPrettyReqIdRef.current += 1);
    const controller = new AbortController();
    jsonPrettyAbortRef.current?.abort();
    jsonPrettyAbortRef.current = controller;

    setJsonPrettyTextKey(jsonSourceKey);
    setJsonPrettyStatus("loading");
    setJsonPrettyErrorCode(null);
    setJsonPrettyProgress({ processed: 0, total: content.length });

    const start = performance.now();
    void formatJsonPretty({
      text: content,
      indentSize: DEFAULT_JSON_INDENT,
      maxOutputBytes: codeDisplayConfig.maxPrettyOutputBytes,
      onProgress: (p) => {
        if (controller.signal.aborted) return;
        if (p.stage !== "format") return;
        setJsonPrettyProgress({ processed: p.processed, total: p.total });
      },
      signal: controller.signal,
    }).then((res) => {
      if (controller.signal.aborted) return;
      if (reqId !== jsonPrettyReqIdRef.current) return;

      const costMs = Math.round(performance.now() - start);
      if (codeDisplayConfig.perfDebugEnabled) {
        console.debug("CodeDisplay formatJsonPretty", {
          costMs,
          inputChars: content.length,
          ok: res.ok,
          usedStreaming: res.ok ? res.usedStreaming : undefined,
          errorCode: res.ok ? undefined : res.errorCode,
        });
      }

      if (res.ok) {
        setJsonPrettyText(res.text);
        setJsonPrettyTextKey(jsonSourceKey);
        setJsonPrettyStatus("ready");
        setJsonPrettyErrorCode(null);
        setJsonPrettyProgress(null);
        return;
      }

      setJsonPrettyErrorCode(res.errorCode);
      switch (res.errorCode) {
        case "INVALID_JSON":
          setJsonPrettyText(null);
          setJsonPrettyTextKey(jsonSourceKey);
          setJsonPrettyStatus("invalid");
          setJsonPrettyProgress(null);
          return;
        case "OUTPUT_TOO_LARGE":
          setJsonPrettyText(null);
          setJsonPrettyTextKey(jsonSourceKey);
          setJsonPrettyStatus("tooLarge");
          setJsonPrettyProgress(null);
          return;
        case "CANCELED":
          setJsonPrettyText(null);
          setJsonPrettyTextKey(jsonSourceKey);
          setJsonPrettyStatus("canceled");
          setJsonPrettyProgress(null);
          return;
        default:
          setJsonPrettyText(null);
          setJsonPrettyTextKey(jsonSourceKey);
          setJsonPrettyStatus("error");
          setJsonPrettyProgress(null);
          return;
      }
    });
  }, [
    content,
    codeDisplayConfig.maxPrettyOutputBytes,
    codeDisplayConfig.perfDebugEnabled,
    jsonPrettyStatus,
    jsonPrettyTextKey,
    jsonSourceKey,
    shouldFormatJsonInWorker,
    shouldRunJsonPrettyJob,
  ]);

  const jsonPrettySyncText = useMemo(() => {
    if (language !== "json") return null;
    if (mode !== "pretty") return null;
    if (isHardLimited) return null;
    if (shouldFormatJsonInWorker) return null;

    // 当 Worker 被禁用时，避免对超大 JSON 在主线程做 parse/stringify 导致卡顿。
    const maxSyncChars = Math.min(codeDisplayConfig.highlightMaxChars, MAX_SYNC_JSON_CHARS);
    if (!codeDisplayConfig.workerEnabled && content.length > maxSyncChars) return content;

    const parsed = safeJsonParse(content);
    if (!parsed.ok) return content;
    return JSON.stringify(parsed.value, null, DEFAULT_JSON_INDENT);
  }, [
    content,
    codeDisplayConfig.highlightMaxChars,
    codeDisplayConfig.workerEnabled,
    isHardLimited,
    language,
    mode,
    shouldFormatJsonInWorker,
  ]);

  const resolvedPrettyText = useMemo(() => {
    if (language !== "json") return content;
    if (mode !== "pretty") return content;
    if (isHardLimited) return content;

    if (shouldFormatJsonInWorker) {
      if (jsonPrettyStatus === "ready" && jsonPrettyTextKey === jsonSourceKey) {
        return jsonPrettyText ?? content;
      }
      return content;
    }

    return jsonPrettySyncText ?? content;
  }, [
    content,
    isHardLimited,
    jsonPrettyStatus,
    jsonPrettySyncText,
    jsonPrettyText,
    jsonPrettyTextKey,
    jsonSourceKey,
    language,
    mode,
    shouldFormatJsonInWorker,
  ]);

  const isLargePrettyText =
    language !== "sse" &&
    mode === "pretty" &&
    resolvedPrettyText.length > codeDisplayConfig.highlightMaxChars;

  const largePrettySourceKey = mode === "pretty" && language !== "sse" ? jsonSourceKey : null;
  const lastLargePrettySourceKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      !codeDisplayConfig.virtualHighlightEnabled ||
      !codeDisplayConfig.workerEnabled ||
      !isLargePrettyText
    ) {
      lastLargePrettySourceKeyRef.current = null;
      setForceLargePrettyPlain(false);
      setLargePrettyView("plain");
      return;
    }

    if (lastLargePrettySourceKeyRef.current !== largePrettySourceKey) {
      setForceLargePrettyPlain(false);
    }

    if (forceLargePrettyPlain) {
      lastLargePrettySourceKeyRef.current = largePrettySourceKey;
      setLargePrettyView("plain");
      return;
    }

    if (!codeDisplayConfig.largePlainEnabled) {
      lastLargePrettySourceKeyRef.current = largePrettySourceKey;
      setLargePrettyView("virtual");
      return;
    }

    if (lastLargePrettySourceKeyRef.current !== largePrettySourceKey) {
      lastLargePrettySourceKeyRef.current = largePrettySourceKey;
      setLargePrettyView("plain");
    }
  }, [
    codeDisplayConfig.largePlainEnabled,
    codeDisplayConfig.virtualHighlightEnabled,
    codeDisplayConfig.workerEnabled,
    forceLargePrettyPlain,
    isLargePrettyText,
    largePrettySourceKey,
  ]);

  const nonSseTextForMode =
    language === "sse" ? content : mode === "pretty" ? resolvedPrettyText : content;
  const nonSseTextForModeRef = useRef(nonSseTextForMode);
  nonSseTextForModeRef.current = nonSseTextForMode;

  const onlyMatchesQuery = searchQuery.trim();
  const debouncedOnlyMatchesQuery = useDebounce(onlyMatchesQuery, 200);

  const shouldOptimizeOnlyMatches =
    language !== "sse" &&
    showOnlyMatches &&
    debouncedOnlyMatchesQuery.length > 0 &&
    !isHardLimited &&
    codeDisplayConfig.workerEnabled &&
    nonSseTextForMode.length > codeDisplayConfig.highlightMaxChars;

  const onlyMatchesIndexAbortRef = useRef<AbortController | null>(null);
  const onlyMatchesSearchAbortRef = useRef<AbortController | null>(null);
  const onlyMatchesIndexJobRef = useRef(0);
  const onlyMatchesSearchJobRef = useRef(0);

  const [onlyMatchesLineStarts, setOnlyMatchesLineStarts] = useState<Int32Array | null>(null);
  const [onlyMatchesMatches, setOnlyMatchesMatches] = useState<Int32Array | null>(null);

  const [onlyMatchesIndexStatus, setOnlyMatchesIndexStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [onlyMatchesSearchStatus, setOnlyMatchesSearchStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [onlyMatchesIndexProgress, setOnlyMatchesIndexProgress] = useState<{
    processed: number;
    total: number;
  } | null>(null);
  const [onlyMatchesSearchProgress, setOnlyMatchesSearchProgress] = useState<{
    processed: number;
    total: number;
  } | null>(null);
  const [onlyMatchesIndexErrorCode, setOnlyMatchesIndexErrorCode] =
    useState<BuildLineIndexErrorCode | null>(null);
  const [onlyMatchesIndexErrorLineCount, setOnlyMatchesIndexErrorLineCount] = useState<
    number | null
  >(null);
  const [onlyMatchesSearchErrorCode, setOnlyMatchesSearchErrorCode] =
    useState<SearchLinesErrorCode | null>(null);

  const onlyMatchesLineIndexCacheRef = useRef<{
    key: string;
    lineStarts: Int32Array;
    lineCount: number;
  } | null>(null);

  const nonSseTextKey = useMemo(() => getTextKey(nonSseTextForMode), [nonSseTextForMode]);
  const nonSseTextKeyRef = useRef(nonSseTextKey);
  nonSseTextKeyRef.current = nonSseTextKey;

  useEffect(() => {
    if (!shouldOptimizeOnlyMatches) {
      onlyMatchesIndexAbortRef.current?.abort();
      onlyMatchesSearchAbortRef.current?.abort();
      onlyMatchesIndexAbortRef.current = null;
      onlyMatchesSearchAbortRef.current = null;
      setOnlyMatchesLineStarts(null);
      setOnlyMatchesMatches(null);
      setOnlyMatchesIndexStatus("idle");
      setOnlyMatchesSearchStatus("idle");
      setOnlyMatchesIndexProgress(null);
      setOnlyMatchesSearchProgress(null);
      setOnlyMatchesIndexErrorCode(null);
      setOnlyMatchesIndexErrorLineCount(null);
      setOnlyMatchesSearchErrorCode(null);
      return;
    }

    const jobId = (onlyMatchesIndexJobRef.current += 1);
    const text = nonSseTextForModeRef.current;

    const cached = onlyMatchesLineIndexCacheRef.current;
    if (cached && cached.key === nonSseTextKey) {
      setOnlyMatchesLineStarts(cached.lineStarts);
      setOnlyMatchesIndexStatus("ready");
      setOnlyMatchesIndexProgress(null);
      setOnlyMatchesIndexErrorCode(null);
      setOnlyMatchesIndexErrorLineCount(null);
    } else {
      const controller = new AbortController();
      onlyMatchesIndexAbortRef.current?.abort();
      onlyMatchesIndexAbortRef.current = controller;

      setOnlyMatchesLineStarts(null);
      setOnlyMatchesIndexStatus("loading");
      setOnlyMatchesIndexProgress({ processed: 0, total: text.length });
      setOnlyMatchesIndexErrorCode(null);
      setOnlyMatchesIndexErrorLineCount(null);

      void buildLineIndex({
        text,
        maxLines: codeDisplayConfig.maxLineIndexLines,
        onProgress: (p) => {
          if (controller.signal.aborted) return;
          if (p.stage !== "index") return;
          setOnlyMatchesIndexProgress({ processed: p.processed, total: p.total });
        },
        signal: controller.signal,
      }).then((res) => {
        if (controller.signal.aborted) return;
        if (jobId !== onlyMatchesIndexJobRef.current) return;

        if (!res.ok) {
          setOnlyMatchesLineStarts(null);
          setOnlyMatchesIndexStatus("error");
          setOnlyMatchesIndexProgress(null);
          setOnlyMatchesIndexErrorCode(res.errorCode);
          setOnlyMatchesIndexErrorLineCount(res.lineCount ?? null);
          return;
        }

        onlyMatchesLineIndexCacheRef.current = {
          key: nonSseTextKey,
          lineStarts: res.lineStarts,
          lineCount: res.lineCount,
        };
        setOnlyMatchesLineStarts(res.lineStarts);
        setOnlyMatchesIndexStatus("ready");
        setOnlyMatchesIndexProgress(null);
        setOnlyMatchesIndexErrorCode(null);
        setOnlyMatchesIndexErrorLineCount(null);
      });
    }

    return () => {
      onlyMatchesIndexAbortRef.current?.abort();
    };
  }, [codeDisplayConfig.maxLineIndexLines, nonSseTextKey, shouldOptimizeOnlyMatches]);

  useEffect(() => {
    if (!shouldOptimizeOnlyMatches) return;
    if (onlyMatchesIndexStatus !== "ready" || !onlyMatchesLineStarts) {
      onlyMatchesSearchAbortRef.current?.abort();
      onlyMatchesSearchAbortRef.current = null;
      setOnlyMatchesMatches(null);
      setOnlyMatchesSearchStatus("idle");
      setOnlyMatchesSearchProgress(null);
      setOnlyMatchesSearchErrorCode(null);
      return;
    }

    const jobId = (onlyMatchesSearchJobRef.current += 1);
    const jobTextKey = nonSseTextKey;
    const text = nonSseTextForModeRef.current;
    const query = debouncedOnlyMatchesQuery;

    const controller = new AbortController();
    onlyMatchesSearchAbortRef.current?.abort();
    onlyMatchesSearchAbortRef.current = controller;

    setOnlyMatchesMatches(null);
    setOnlyMatchesSearchStatus("loading");
    setOnlyMatchesSearchProgress({ processed: 0, total: text.length });
    setOnlyMatchesSearchErrorCode(null);

    void searchLines({
      text,
      query,
      maxResults: Math.min(resolvedMaxLines, 50_000),
      onProgress: (p) => {
        if (controller.signal.aborted) return;
        if (p.stage !== "search") return;
        setOnlyMatchesSearchProgress({ processed: p.processed, total: p.total });
      },
      signal: controller.signal,
    }).then((res) => {
      if (controller.signal.aborted) return;
      if (jobId !== onlyMatchesSearchJobRef.current) return;
      if (jobTextKey !== nonSseTextKeyRef.current) return;

      if (!res.ok) {
        setOnlyMatchesMatches(null);
        setOnlyMatchesSearchStatus("error");
        setOnlyMatchesSearchProgress(null);
        setOnlyMatchesSearchErrorCode(res.errorCode);
        return;
      }

      setOnlyMatchesMatches(res.matches);
      setOnlyMatchesSearchStatus("ready");
      setOnlyMatchesSearchProgress(null);
      setOnlyMatchesSearchErrorCode(null);
    });

    return () => {
      controller.abort();
    };
  }, [
    debouncedOnlyMatchesQuery,
    nonSseTextKey,
    onlyMatchesIndexStatus,
    onlyMatchesLineStarts,
    resolvedMaxLines,
    shouldOptimizeOnlyMatches,
  ]);

  const nonSseFilteredText = useMemo(() => {
    if (language === "sse") return null;
    if (!showOnlyMatches) return null;
    if (!onlyMatchesQuery) return null;
    if (shouldOptimizeOnlyMatches) return null;

    const shouldDebounceFallbackSearch =
      nonSseTextForMode.length > codeDisplayConfig.highlightMaxChars;
    const query = shouldDebounceFallbackSearch ? debouncedOnlyMatchesQuery : onlyMatchesQuery;
    if (!query) return null;

    const lines = splitLines(nonSseTextForMode);
    const matches = lines.filter((line) => line.includes(query));
    return matches.length === 0 ? "" : matches.join("\n");
  }, [
    debouncedOnlyMatchesQuery,
    codeDisplayConfig.highlightMaxChars,
    language,
    nonSseTextForMode,
    onlyMatchesQuery,
    showOnlyMatches,
    shouldOptimizeOnlyMatches,
  ]);

  const highlighterStyle = resolvedTheme === "dark" ? oneDark : oneLight;

  const downloadFileName =
    fileName ??
    (language === "json" ? "content.json" : language === "sse" ? "content.sse" : "content.txt");

  const resolveTextForAction = (): string => {
    if (language === "sse") return content;

    const baseText = mode === "pretty" ? resolvedPrettyText : content;
    if (!showOnlyMatches || !onlyMatchesQuery) return baseText;

    if (!shouldOptimizeOnlyMatches) {
      return nonSseFilteredText ?? baseText;
    }

    if (onlyMatchesLineStarts && onlyMatchesMatches) {
      return buildOnlyMatchesText(baseText, onlyMatchesLineStarts, onlyMatchesMatches);
    }

    return baseText;
  };

  const handleDownload = () => {
    const text = resolveTextForAction();

    const isCandidateJson = language === "json" && !(showOnlyMatches && onlyMatchesQuery);
    let downloadType: "application/json" | "text/plain" = "text/plain";

    // 避免对超大内容在主线程 JSON.parse；小内容可用于更准确决定 MIME 类型。
    const maxValidateJsonChars = MAX_SYNC_JSON_CHARS;
    if (isCandidateJson && text.length <= maxValidateJsonChars) {
      if (safeJsonParse(text).ok) downloadType = "application/json";
    }

    const blob = new Blob([text], {
      type: downloadType,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    try {
      a.href = url;
      a.download = downloadFileName;
      document.body.appendChild(a);
      a.click();
    } finally {
      if (a.isConnected) {
        document.body.removeChild(a);
      }
      URL.revokeObjectURL(url);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(resolveTextForAction());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed", err);
    }
  };

  const labels = useMemo(
    () => ({
      noMatches: t("codeDisplay.noMatches"),
      sseEvent: t("codeDisplay.sseEvent"),
      sseData: t("codeDisplay.sseData"),
    }),
    [t]
  );

  const sseEvents = useMemo(() => {
    if (language !== "sse") return null;
    if (mode !== "pretty") return null;
    if (isHardLimited) return null;
    return parseSseForCodeDisplay(content);
  }, [content, isHardLimited, language, mode]);

  const filteredSseEvents = useMemo(() => {
    if (!sseEvents) return null;
    const q = searchQuery.trim();
    if (!q) return sseEvents;
    const re = new RegExp(escapeRegExp(q), "i");
    return sseEvents.filter((evt) => re.test(evt.event) || re.test(evt.data));
  }, [searchQuery, sseEvents]);

  if (isHardLimited) {
    const sizeBytes = contentBytes;
    const sizeMB = (sizeBytes / 1_000_000).toFixed(2);
    const maxSizeMB = (resolvedMaxContentBytes / 1_000_000).toFixed(2);

    return (
      <div data-testid="code-display" className={cn("rounded-md border bg-muted/30", className)}>
        <div className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            {fileName && (
              <code className="text-xs font-mono text-muted-foreground">{fileName}</code>
            )}
            <Badge variant="secondary" className="font-mono">
              {language.toUpperCase()}
            </Badge>
          </div>
        </div>

        <div className="border-t p-3">
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
            <div className="flex items-center gap-2">
              <FileIcon className="h-4 w-4 text-destructive" />
              <p className="font-medium">{t("codeDisplay.hardLimit.title")}</p>
            </div>
            <p className="mt-1 text-sm">
              {t("codeDisplay.hardLimit.size", {
                sizeMB,
                sizeBytes: sizeBytes.toLocaleString(),
              })}
            </p>
            <p className="text-sm">
              {t("codeDisplay.hardLimit.maximum", {
                maxSizeMB,
                maxLines: resolvedMaxLines.toLocaleString(),
              })}
            </p>
            <p className="mt-2 text-xs opacity-70">{t("codeDisplay.hardLimit.hint")}</p>
            <div className="mt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownload}
                data-testid="code-display-hard-limit-download"
              >
                <Download className="h-4 w-4 mr-2" />
                {t("codeDisplay.hardLimit.download")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const headerRight = (
    <div className="flex items-center gap-2">
      <div className="relative w-full max-w-[16rem]">
        <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          data-testid="code-display-search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("codeDisplay.searchPlaceholder")}
          className="pl-8 h-9"
        />
      </div>

      {language !== "sse" && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowOnlyMatches((v) => !v)}
          data-testid="code-display-only-matches-toggle"
          className="h-9"
        >
          {showOnlyMatches ? t("codeDisplay.showAll") : t("codeDisplay.onlyMatches")}
        </Button>
      )}

      {enableCopy && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={handleCopy} className="h-9 w-9 p-0">
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{copied ? tActions("copied") : tActions("copy")}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {enableDownload && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={handleDownload} className="h-9 w-9 p-0">
                <Download className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{tActions("download")}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {isLargeContent && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
          data-testid="code-display-expand-toggle"
          className="h-9"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="h-4 w-4 mr-2" />
              {t("codeDisplay.collapse")}
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4 mr-2" />
              {t("codeDisplay.expand")}
            </>
          )}
        </Button>
      )}
    </div>
  );

  const renderOnlyMatchesOptimized = () => {
    const showProgress =
      onlyMatchesIndexStatus === "loading" || onlyMatchesSearchStatus === "loading";
    const progress = onlyMatchesSearchProgress ?? onlyMatchesIndexProgress;
    const percent =
      progress && progress.total > 0 ? Math.floor((progress.processed / progress.total) * 100) : 0;

    if (showProgress) {
      return (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border/50 bg-background/40 p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{t("codeDisplay.searchWorking", { percent })}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onlyMatchesIndexAbortRef.current?.abort();
              onlyMatchesSearchAbortRef.current?.abort();
              setShowOnlyMatches(false);
            }}
            className="h-8"
          >
            <X className="h-4 w-4 mr-2" />
            {t("codeDisplay.cancel")}
          </Button>
        </div>
      );
    }

    if (
      onlyMatchesIndexStatus === "ready" &&
      onlyMatchesSearchStatus === "ready" &&
      onlyMatchesLineStarts &&
      onlyMatchesMatches
    ) {
      if (onlyMatchesMatches.length === 0) {
        return <div className="text-xs text-muted-foreground">{t("codeDisplay.noMatches")}</div>;
      }
      return (
        <CodeDisplayMatchesList
          text={nonSseTextForMode}
          matches={onlyMatchesMatches}
          lineStarts={onlyMatchesLineStarts}
          maxHeight={contentMaxHeight}
          lineHeightPx={codeDisplayConfig.virtualLineHeightPx}
          overscan={codeDisplayConfig.virtualOverscanLines}
        />
      );
    }

    if (onlyMatchesIndexStatus === "error" || onlyMatchesSearchStatus === "error") {
      const message = (() => {
        if (onlyMatchesIndexStatus === "error") {
          if (onlyMatchesIndexErrorCode === "CANCELED")
            return t("codeDisplay.search.indexCanceled");
          if (onlyMatchesIndexErrorCode === "TOO_MANY_LINES") {
            const lineCount = onlyMatchesIndexErrorLineCount;
            if (typeof lineCount === "number") {
              return t("codeDisplay.search.indexTooManyLines", {
                lineCount,
                maxLines: codeDisplayConfig.maxLineIndexLines,
              });
            }
            return t("codeDisplay.search.indexTooManyLinesUnknown", {
              maxLines: codeDisplayConfig.maxLineIndexLines,
            });
          }
          return t("codeDisplay.search.indexFailed");
        }

        if (onlyMatchesSearchErrorCode === "CANCELED") return t("codeDisplay.search.canceled");
        return t("codeDisplay.search.failed");
      })();

      return (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border/50 bg-background/40 p-3">
          <div className="text-xs text-destructive">{message}</div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onlyMatchesIndexAbortRef.current?.abort();
              onlyMatchesSearchAbortRef.current?.abort();
              setShowOnlyMatches(false);
            }}
            className="h-8"
          >
            {t("codeDisplay.showAll")}
          </Button>
        </div>
      );
    }

    return <div className="text-xs text-muted-foreground">{t("codeDisplay.noMatches")}</div>;
  };

  return (
    <div
      data-testid="code-display"
      data-language={language}
      data-expanded={String(isExpanded)}
      data-resolved-theme={resolvedTheme}
      className={cn("rounded-md border bg-muted/30 flex flex-col min-h-0", className)}
    >
      <div className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          {fileName && (
            <code className="text-xs font-mono text-muted-foreground break-all">{fileName}</code>
          )}
          <Badge variant="secondary" className="font-mono">
            {language.toUpperCase()}
          </Badge>
        </div>
        {headerRight}
      </div>

      <div className="border-t p-3 flex flex-col min-h-0">
        <Tabs value={mode} onValueChange={(v) => setMode(v as "raw" | "pretty")} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="raw" data-testid="code-display-mode-raw">
              {t("codeDisplay.raw")}
            </TabsTrigger>
            <TabsTrigger value="pretty" data-testid="code-display-mode-pretty">
              {t("codeDisplay.pretty")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="raw" className="mt-3">
            {shouldOptimizeOnlyMatches ? (
              renderOnlyMatchesOptimized()
            ) : content.length > codeDisplayConfig.highlightMaxChars &&
              codeDisplayConfig.largePlainEnabled ? (
              <CodeDisplayPlainTextarea
                value={
                  showOnlyMatches && onlyMatchesQuery ? (nonSseFilteredText ?? content) : content
                }
                maxHeight={contentMaxHeight}
                lineHeightPx={codeDisplayConfig.virtualLineHeightPx}
                className="border-0 bg-transparent"
              />
            ) : (
              <div className="overflow-auto" style={{ maxHeight: contentMaxHeight }}>
                <pre className="text-xs whitespace-pre-wrap break-words font-mono">
                  {showOnlyMatches && onlyMatchesQuery ? (nonSseFilteredText ?? content) : content}
                </pre>
              </div>
            )}
          </TabsContent>

          <TabsContent value="pretty" className="mt-3">
            {codeDisplayConfig.virtualHighlightEnabled &&
              codeDisplayConfig.workerEnabled &&
              isLargePrettyText &&
              !shouldOptimizeOnlyMatches &&
              (codeDisplayConfig.largePlainEnabled || forceLargePrettyPlain) && (
                <div className="mb-3 flex items-center gap-2">
                  <Button
                    type="button"
                    variant={largePrettyView === "plain" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setLargePrettyView("plain")}
                    data-testid="code-display-large-pretty-view-plain"
                    className="h-8"
                  >
                    {t("codeDisplay.viewPlain")}
                  </Button>
                  <Button
                    type="button"
                    variant={largePrettyView === "virtual" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => {
                      setForceLargePrettyPlain(false);
                      setLargePrettyView("virtual");
                    }}
                    data-testid="code-display-large-pretty-view-virtual"
                    className="h-8"
                  >
                    {t("codeDisplay.viewVirtual")}
                  </Button>
                  {forceLargePrettyPlain && (
                    <span className="text-xs text-muted-foreground">
                      {t("codeDisplay.virtualFallbackToPlain")}
                    </span>
                  )}
                </div>
              )}

            {shouldFormatJsonInWorker &&
              mode === "pretty" &&
              (jsonPrettyStatus === "invalid" ||
                jsonPrettyStatus === "tooLarge" ||
                jsonPrettyStatus === "canceled" ||
                jsonPrettyStatus === "error") && (
                <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-border/50 bg-background/40 p-3">
                  <div className="text-xs text-muted-foreground">
                    {jsonPrettyStatus === "canceled"
                      ? t("codeDisplay.prettyCanceled")
                      : jsonPrettyStatus === "invalid"
                        ? t("codeDisplay.prettyInvalidJson")
                        : jsonPrettyStatus === "tooLarge"
                          ? t("codeDisplay.prettyOutputTooLarge")
                          : jsonPrettyErrorCode === "WORKER_UNAVAILABLE"
                            ? t("codeDisplay.prettyWorkerUnavailable")
                            : t("codeDisplay.prettyFailed")}
                  </div>
                  {(jsonPrettyStatus === "canceled" || jsonPrettyStatus === "error") && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={retryJsonPretty}
                      data-testid="code-display-json-pretty-retry"
                    >
                      {t("codeDisplay.retry")}
                    </Button>
                  )}
                </div>
              )}

            {language === "sse" ? (
              <CodeDisplaySseEvents
                events={filteredSseEvents ?? []}
                maxHeight={contentMaxHeight}
                resolvedTheme={resolvedTheme}
                highlightMaxChars={codeDisplayConfig.highlightMaxChars}
                largePlainEnabled={codeDisplayConfig.largePlainEnabled}
                lineHeightPx={codeDisplayConfig.virtualLineHeightPx}
                labels={labels}
              />
            ) : shouldFormatJsonInWorker && jsonPrettyStatus === "loading" ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-md border border-border/50 bg-background/40 p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>
                      {t("codeDisplay.prettyWorking", {
                        percent:
                          jsonPrettyProgress && jsonPrettyProgress.total > 0
                            ? Math.floor(
                                (jsonPrettyProgress.processed / jsonPrettyProgress.total) * 100
                              )
                            : 0,
                      })}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={cancelJsonPretty}
                    data-testid="code-display-json-pretty-cancel"
                    className="h-8"
                  >
                    <X className="h-4 w-4 mr-2" />
                    {t("codeDisplay.cancel")}
                  </Button>
                </div>
                {codeDisplayConfig.largePlainEnabled ? (
                  <CodeDisplayPlainTextarea
                    value={content}
                    maxHeight={contentMaxHeight}
                    lineHeightPx={codeDisplayConfig.virtualLineHeightPx}
                    className="border-0 bg-transparent"
                  />
                ) : (
                  <div className="overflow-auto" style={{ maxHeight: contentMaxHeight }}>
                    <pre className="text-xs whitespace-pre-wrap break-words font-mono">
                      {content}
                    </pre>
                  </div>
                )}
              </div>
            ) : shouldOptimizeOnlyMatches ? (
              renderOnlyMatchesOptimized()
            ) : isLargePrettyText &&
              codeDisplayConfig.workerEnabled &&
              codeDisplayConfig.virtualHighlightEnabled &&
              !forceLargePrettyPlain &&
              largePrettyView === "virtual" ? (
              <CodeDisplayVirtualHighlighter
                text={
                  showOnlyMatches && onlyMatchesQuery
                    ? (nonSseFilteredText ?? resolvedPrettyText)
                    : resolvedPrettyText
                }
                language={language === "json" ? "json" : "text"}
                maxHeight={contentMaxHeight}
                resolvedTheme={resolvedTheme}
                lineHeightPx={codeDisplayConfig.virtualLineHeightPx}
                overscanLines={codeDisplayConfig.virtualOverscanLines}
                contextLines={codeDisplayConfig.virtualContextLines}
                maxLines={codeDisplayConfig.maxLineIndexLines}
                perfDebugEnabled={codeDisplayConfig.perfDebugEnabled}
                className="border-0"
                onRequestPlainView={() => {
                  setForceLargePrettyPlain(true);
                  setLargePrettyView("plain");
                }}
              />
            ) : isLargePrettyText &&
              (codeDisplayConfig.largePlainEnabled || forceLargePrettyPlain) ? (
              <CodeDisplayPlainTextarea
                value={
                  showOnlyMatches && onlyMatchesQuery
                    ? (nonSseFilteredText ?? resolvedPrettyText)
                    : resolvedPrettyText
                }
                maxHeight={contentMaxHeight}
                lineHeightPx={codeDisplayConfig.virtualLineHeightPx}
                className="border-0 bg-transparent"
              />
            ) : isLargePrettyText ? (
              <div className="overflow-auto" style={{ maxHeight: contentMaxHeight }}>
                <pre
                  className="text-xs whitespace-pre-wrap break-words font-mono"
                  style={{ lineHeight: `${codeDisplayConfig.virtualLineHeightPx}px` }}
                >
                  {showOnlyMatches && onlyMatchesQuery
                    ? (nonSseFilteredText ?? resolvedPrettyText)
                    : resolvedPrettyText}
                </pre>
              </div>
            ) : (
              <div className="overflow-auto" style={{ maxHeight: contentMaxHeight }}>
                <SyntaxHighlighter
                  language={language === "json" ? "json" : "text"}
                  style={highlighterStyle}
                  customStyle={{
                    margin: 0,
                    background: "transparent",
                    fontSize: "12px",
                  }}
                >
                  {showOnlyMatches && onlyMatchesQuery
                    ? (nonSseFilteredText ?? resolvedPrettyText)
                    : resolvedPrettyText}
                </SyntaxHighlighter>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {showOnlyMatches &&
          onlyMatchesQuery &&
          language !== "sse" &&
          !shouldOptimizeOnlyMatches &&
          (nonSseFilteredText ?? "") === "" && (
            <div className="mt-3 text-xs text-muted-foreground">{t("codeDisplay.noMatches")}</div>
          )}
      </div>
    </div>
  );
}
