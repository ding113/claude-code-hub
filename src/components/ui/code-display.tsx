"use client";

import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  File as FileIcon,
  Search,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { parseSSEDataForDisplay } from "@/lib/utils/sse";

export type CodeDisplayLanguage = "json" | "sse" | "text";

const DEFAULT_MAX_CONTENT_BYTES = 1_000_000; // 1MB
const DEFAULT_MAX_LINES = 10_000;
const PRETTY_MODE_DEFAULT_MAX_CHARS = 100_000;

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

function splitLines(text: string): string[] {
  return text.length === 0 ? [""] : text.split("\n");
}

function countLinesUpTo(text: string, maxLines: number): number {
  if (text.length === 0) return 1;
  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      count += 1;
      if (count >= maxLines) return count;
    }
  }
  return count;
}

function getDefaultMode(language: CodeDisplayLanguage): "raw" | "pretty" {
  if (language === "text") return "raw";
  return "pretty";
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
  const resolvedMaxContentBytes = maxContentBytes ?? DEFAULT_MAX_CONTENT_BYTES;
  const resolvedMaxLines = maxLines ?? DEFAULT_MAX_LINES;
  const contentBytes = useMemo(() => new Blob([content]).size, [content]);
  const isOverMaxBytes = contentBytes > resolvedMaxContentBytes;

  const [mode, setMode] = useState<"raw" | "pretty">(() => {
    const defaultMode = getDefaultMode(language);
    if (defaultMode === "pretty" && content.length > PRETTY_MODE_DEFAULT_MAX_CHARS) {
      return "raw";
    }
    return defaultMode;
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [showOnlyMatches, setShowOnlyMatches] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");
  const [expandedSseRows, setExpandedSseRows] = useState<Set<number>>(() => new Set());
  const sseScrollRef = useRef<HTMLDivElement | null>(null);
  const [sseViewportHeight, setSseViewportHeight] = useState(0);
  const [sseScrollTop, setSseScrollTop] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const getTheme = () => (document.documentElement.classList.contains("dark") ? "dark" : "light");

    setResolvedTheme(getTheme());

    const observer = new MutationObserver(() => setResolvedTheme(getTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (mode !== "pretty") return;
    if (language === "text") return;
    if (content.length <= PRETTY_MODE_DEFAULT_MAX_CHARS) return;
    setMode("raw");
  }, [content, language, mode]);

  const lineCount = useMemo(() => {
    if (isOverMaxBytes) return 0;
    return countLinesUpTo(content, resolvedMaxLines + 1);
  }, [content, isOverMaxBytes, resolvedMaxLines]);
  const isLargeContent = content.length > 4000 || lineCount > 200;
  const isExpanded = expanded || !isLargeContent;
  const isHardLimited = isOverMaxBytes || lineCount > resolvedMaxLines;

  const formattedJson = useMemo(() => {
    if (language !== "json") return content;
    if (mode !== "pretty") return content;
    if (isHardLimited) return content;
    const parsed = safeJsonParse(content);
    if (!parsed.ok) return content;
    return stringifyPretty(parsed.value);
  }, [content, isHardLimited, language, mode]);

  const sseEvents = useMemo(() => {
    if (language !== "sse") return null;
    if (mode !== "pretty") return null;
    if (isHardLimited) return null;
    return parseSSEDataForDisplay(content);
  }, [content, isHardLimited, language, mode]);

  const filteredSseEvents = useMemo(() => {
    if (!sseEvents) return null;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sseEvents;

    return sseEvents.filter((evt) => {
      const eventText = evt.event.toLowerCase();
      const dataText = typeof evt.data === "string" ? evt.data : JSON.stringify(evt.data, null, 2);
      return eventText.includes(q) || dataText.toLowerCase().includes(q);
    });
  }, [searchQuery, sseEvents]);

  useEffect(() => {
    if (language !== "sse" || mode !== "pretty") return;
    setExpandedSseRows(new Set());
  }, [language, mode]);

  useEffect(() => {
    if (language !== "sse" || mode !== "pretty") return;
    const el = sseScrollRef.current;
    if (!el) return;

    const update = () => setSseViewportHeight(el.clientHeight);
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
  }, [language, mode]);

  const lineFilteredText = useMemo(() => {
    if (language === "sse") return null;
    if (isOverMaxBytes) return content;
    const q = searchQuery.trim();
    if (!q || !showOnlyMatches) return content;
    const lines = splitLines(content);
    const matches = lines.filter((line) => line.includes(q));
    return matches.length === 0 ? "" : matches.join("\n");
  }, [content, isOverMaxBytes, language, searchQuery, showOnlyMatches]);

  const highlighterStyle = resolvedTheme === "dark" ? oneDark : oneLight;
  const displayText = lineFilteredText ?? content;
  const contentMaxHeight = isExpanded ? expandedMaxHeight : maxHeight;

  const downloadFileName =
    fileName ??
    (language === "json" ? "content.json" : language === "sse" ? "content.sse" : "content.txt");

  const handleDownload = () => {
    const blob = new Blob([content], {
      type: language === "json" ? "application/json" : "text/plain",
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
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed", err);
    }
  };

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
          onChange={(e) => {
            setExpandedSseRows(new Set());
            setSearchQuery(e.target.value);
          }}
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
            <div className="overflow-auto" style={{ maxHeight: contentMaxHeight }}>
              <pre className="text-xs whitespace-pre-wrap break-words font-mono">{displayText}</pre>
            </div>
          </TabsContent>

          <TabsContent value="pretty" className="mt-3">
            {language === "json" ? (
              <div className="overflow-auto" style={{ maxHeight: contentMaxHeight }}>
                <SyntaxHighlighter
                  language="json"
                  style={highlighterStyle}
                  customStyle={{
                    margin: 0,
                    background: "transparent",
                    fontSize: "12px",
                  }}
                >
                  {formattedJson}
                </SyntaxHighlighter>
              </div>
            ) : language === "sse" ? (
              <div
                ref={sseScrollRef}
                className="overflow-auto"
                style={{ maxHeight: contentMaxHeight }}
                onScroll={(e) => {
                  const target = e.currentTarget;
                  setSseScrollTop(target.scrollTop);
                }}
              >
                {(() => {
                  if (!filteredSseEvents) return null;

                  if (filteredSseEvents.length === 0) {
                    return (
                      <div className="text-xs text-muted-foreground">
                        {t("codeDisplay.noMatches")}
                      </div>
                    );
                  }

                  const useVirtual =
                    filteredSseEvents.length > 200 &&
                    expandedSseRows.size === 0 &&
                    sseViewportHeight > 0;

                  const estimatedRowHeight = 44;
                  const overscan = 12;
                  const total = filteredSseEvents.length;

                  const startIndex = useVirtual
                    ? Math.max(0, Math.floor(sseScrollTop / estimatedRowHeight) - overscan)
                    : 0;
                  const endIndex = useVirtual
                    ? Math.min(
                        total,
                        Math.ceil((sseScrollTop + sseViewportHeight) / estimatedRowHeight) +
                          overscan
                      )
                    : total;

                  const topPad = useVirtual ? startIndex * estimatedRowHeight : 0;
                  const bottomPad = useVirtual ? (total - endIndex) * estimatedRowHeight : 0;

                  const rows = filteredSseEvents.slice(startIndex, endIndex);

                  return (
                    <div className="space-y-2">
                      {topPad > 0 && <div style={{ height: topPad }} />}
                      {rows.map((evt, localIdx) => {
                        const index = startIndex + localIdx;
                        const open = expandedSseRows.has(index);
                        const dataText =
                          typeof evt.data === "string" ? evt.data : stringifyPretty(evt.data);
                        const preview =
                          dataText.length > 120 ? `${dataText.slice(0, 120)}...` : dataText;

                        return (
                          <div
                            key={`${index}-${evt.event}`}
                            data-testid="code-display-sse-row"
                            className="rounded-md border bg-background/50"
                          >
                            <details open={open}>
                              <summary
                                className="cursor-pointer select-none px-3 py-2"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setExpandedSseRows((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(index)) {
                                      next.delete(index);
                                    } else {
                                      next.add(index);
                                    }
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
                              <div className="px-3 pb-3 pt-2 space-y-2">
                                <div className="space-y-1">
                                  <div className="text-xs text-muted-foreground">
                                    {t("codeDisplay.sseEvent")}
                                  </div>
                                  <div className="font-mono text-xs break-all">{evt.event}</div>
                                </div>
                                <div className="space-y-1">
                                  <div className="text-xs text-muted-foreground">
                                    {t("codeDisplay.sseData")}
                                  </div>
                                  <SyntaxHighlighter
                                    language="json"
                                    style={highlighterStyle}
                                    customStyle={{
                                      margin: 0,
                                      background: "transparent",
                                      fontSize: "12px",
                                    }}
                                  >
                                    {dataText}
                                  </SyntaxHighlighter>
                                </div>
                              </div>
                            </details>
                          </div>
                        );
                      })}
                      {bottomPad > 0 && <div style={{ height: bottomPad }} />}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="overflow-auto" style={{ maxHeight: contentMaxHeight }}>
                <SyntaxHighlighter
                  language="text"
                  style={highlighterStyle}
                  customStyle={{
                    margin: 0,
                    background: "transparent",
                    fontSize: "12px",
                  }}
                >
                  {displayText}
                </SyntaxHighlighter>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {searchQuery.trim() &&
          language !== "sse" &&
          showOnlyMatches &&
          (lineFilteredText ?? "") === "" && (
            <div className="mt-3 text-xs text-muted-foreground">{t("codeDisplay.noMatches")}</div>
          )}
      </div>
    </div>
  );
}
