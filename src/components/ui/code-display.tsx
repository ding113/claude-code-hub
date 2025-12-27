"use client";

import { ChevronDown, ChevronUp, File as FileIcon, Laptop, Moon, Search, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { parseSSEDataForDisplay } from "@/lib/utils/sse";

type ThemePreference = "auto" | "light" | "dark";

export type CodeDisplayLanguage = "json" | "sse" | "text";

const MAX_CONTENT_SIZE = 1_000_000; // 1MB
const MAX_LINES = 10_000;

export interface CodeDisplayProps {
  content: string;
  language: CodeDisplayLanguage;
  fileName?: string;
  maxHeight?: string;
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
}: CodeDisplayProps) {
  const t = useTranslations("dashboard.sessions");
  const isOverMaxBytes = content.length > MAX_CONTENT_SIZE;

  const [mode, setMode] = useState<"raw" | "pretty">(getDefaultMode(language));
  const [searchQuery, setSearchQuery] = useState("");
  const [showOnlyMatches, setShowOnlyMatches] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>("auto");
  const [page, setPage] = useState(1);
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    if (!window.matchMedia) return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemTheme(media.matches ? "dark" : "light");
    update();

    if (media.addEventListener) {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }

    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  const effectiveTheme: ThemePreference = themePreference;
  const resolvedEffectiveTheme = effectiveTheme === "auto" ? systemTheme : effectiveTheme;

  const lineCount = useMemo(() => {
    if (isOverMaxBytes) return 0;
    return countLinesUpTo(content, MAX_LINES + 1);
  }, [content, isOverMaxBytes]);
  const isLargeContent = content.length > 4000 || lineCount > 200;
  const isExpanded = expanded || !isLargeContent;
  const isHardLimited = isOverMaxBytes || lineCount > MAX_LINES;

  const formattedJson = useMemo(() => {
    if (language !== "json") return content;
    if (isOverMaxBytes) return content;
    const parsed = safeJsonParse(content);
    if (!parsed.ok) return content;
    return stringifyPretty(parsed.value);
  }, [content, isOverMaxBytes, language]);

  const sseEvents = useMemo(() => {
    if (language !== "sse") return null;
    if (isOverMaxBytes) return null;
    return parseSSEDataForDisplay(content);
  }, [content, isOverMaxBytes, language]);

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

  const lineFilteredText = useMemo(() => {
    if (language === "sse") return null;
    if (isOverMaxBytes) return content;
    const q = searchQuery.trim();
    if (!q || !showOnlyMatches) return content;
    const lines = splitLines(content);
    const matches = lines.filter((line) => line.includes(q));
    return matches.length === 0 ? "" : matches.join("\n");
  }, [content, isOverMaxBytes, language, searchQuery, showOnlyMatches]);

  type SseEvent = ReturnType<typeof parseSSEDataForDisplay>[number];
  const pagination = useMemo((): {
    pageSize: number;
    totalPages: number;
    page: number;
    items: SseEvent[];
  } => {
    if (!filteredSseEvents) {
      return { pageSize: 10, totalPages: 1, page: 1, items: [] };
    }
    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(filteredSseEvents.length / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    const end = start + pageSize;
    return {
      pageSize,
      totalPages,
      page: safePage,
      items: filteredSseEvents.slice(start, end),
    };
  }, [filteredSseEvents, page]);

  const highlighterStyle = resolvedEffectiveTheme === "dark" ? oneDark : oneLight;
  const displayText = lineFilteredText ?? content;

  if (isHardLimited) {
    const sizeBytes = content.length;
    const sizeMB = (sizeBytes / 1_000_000).toFixed(2);
    const maxSizeMB = (MAX_CONTENT_SIZE / 1_000_000).toFixed(2);

    return (
      <div data-testid="code-display" className="rounded-md border bg-muted/30">
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
              <p className="font-medium">Content too large</p>
            </div>
            <p className="mt-1 text-sm">
              Size: {sizeMB} MB ({sizeBytes.toLocaleString()} bytes)
            </p>
            <p className="text-sm">
              Maximum allowed: {maxSizeMB} MB or {MAX_LINES.toLocaleString()} lines
            </p>
            <p className="mt-2 text-xs opacity-70">
              Please download the file to view the full content.
            </p>
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
            setSearchQuery(e.target.value);
            setPage(1);
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

      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setThemePreference("auto")}
          data-testid="code-display-theme-auto"
          aria-label={t("codeDisplay.themeAuto")}
          className={cn("h-9 w-9", themePreference === "auto" && "bg-accent")}
        >
          <Laptop className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setThemePreference("light")}
          data-testid="code-display-theme-light"
          aria-label={t("codeDisplay.themeLight")}
          className={cn("h-9 w-9", themePreference === "light" && "bg-accent")}
        >
          <Sun className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setThemePreference("dark")}
          data-testid="code-display-theme-dark"
          aria-label={t("codeDisplay.themeDark")}
          className={cn("h-9 w-9", themePreference === "dark" && "bg-accent")}
        >
          <Moon className="h-4 w-4" />
        </Button>
      </div>

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
      data-theme={themePreference}
      className="rounded-md border bg-muted/30"
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

      <div
        className={cn("border-t p-3", !isExpanded && "overflow-hidden")}
        style={{ maxHeight: isExpanded ? undefined : maxHeight }}
      >
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
            <pre className="text-xs whitespace-pre-wrap break-words font-mono">{displayText}</pre>
          </TabsContent>

          <TabsContent value="pretty" className="mt-3">
            {language === "json" ? (
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
            ) : language === "sse" ? (
              <div className="space-y-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>{t("codeDisplay.sseEvent")}</TableHead>
                      <TableHead>{t("codeDisplay.sseData")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagination.items.map((evt, idx) => {
                      const rowIndex = (pagination.page - 1) * pagination.pageSize + idx + 1;
                      const dataText =
                        typeof evt.data === "string" ? evt.data : stringifyPretty(evt.data);

                      return (
                        <TableRow
                          key={`${rowIndex}-${evt.event}`}
                          data-testid="code-display-sse-row"
                        >
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {rowIndex}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{evt.event}</TableCell>
                          <TableCell className="whitespace-normal">
                            <details>
                              <summary className="cursor-pointer select-none text-xs text-muted-foreground">
                                {dataText.length > 120 ? `${dataText.slice(0, 120)}...` : dataText}
                              </summary>
                              <div className="mt-2">
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
                            </details>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">
                    {t("codeDisplay.pageInfo", {
                      page: pagination.page,
                      total: pagination.totalPages,
                    })}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="code-display-page-prev"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={pagination.page <= 1}
                    >
                      {t("codeDisplay.prevPage")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="code-display-page-next"
                      onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                      disabled={pagination.page >= pagination.totalPages}
                    >
                      {t("codeDisplay.nextPage")}
                    </Button>
                  </div>
                </div>

                {filteredSseEvents && filteredSseEvents.length === 0 && (
                  <div className="text-xs text-muted-foreground">{t("codeDisplay.noMatches")}</div>
                )}
              </div>
            ) : (
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
