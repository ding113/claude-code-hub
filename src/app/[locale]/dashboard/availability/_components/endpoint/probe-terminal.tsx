"use client";

import { AlertCircle, CheckCircle2, Download, Trash2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProviderEndpointProbeLog } from "@/types/provider";

interface ProbeTerminalProps {
  logs: ProviderEndpointProbeLog[];
  maxLines?: number;
  autoScroll?: boolean;
  onLogClick?: (log: ProviderEndpointProbeLog) => void;
  className?: string;
}

function formatTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatLatency(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function getLogLevel(log: ProviderEndpointProbeLog): "success" | "error" | "warn" {
  if (log.ok) return "success";
  if (log.errorType === "timeout") return "warn";
  return "error";
}

const levelConfig = {
  success: {
    icon: CheckCircle2,
    label: "OK",
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/5",
    borderColor: "border-l-emerald-500",
  },
  error: {
    icon: XCircle,
    label: "FAIL",
    color: "text-rose-500",
    bgColor: "bg-rose-500/5",
    borderColor: "border-l-rose-500",
  },
  warn: {
    icon: AlertCircle,
    label: "WARN",
    color: "text-amber-500",
    bgColor: "bg-amber-500/5",
    borderColor: "border-l-amber-500",
  },
};

export function ProbeTerminal({
  logs,
  maxLines = 100,
  autoScroll = true,
  onLogClick,
  className,
}: ProbeTerminalProps) {
  const t = useTranslations("dashboard.availability.terminal");
  const containerRef = useRef<HTMLDivElement>(null);
  const [userScrolled, setUserScrolled] = useState(false);
  const [filter, setFilter] = useState("");

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && !userScrolled && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll, userScrolled]);

  // Detect user scroll
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setUserScrolled(!isAtBottom);
  };

  // Filter logs
  const filteredLogs = logs
    .filter((log) => {
      if (!filter) return true;
      const searchLower = filter.toLowerCase();
      return (
        log.errorMessage?.toLowerCase().includes(searchLower) ||
        log.errorType?.toLowerCase().includes(searchLower) ||
        log.statusCode?.toString().includes(searchLower)
      );
    })
    .slice(-maxLines);

  const handleDownload = () => {
    const content = filteredLogs
      .map((log) => {
        const time = formatTime(log.createdAt);
        const status = log.ok ? "OK" : "FAIL";
        const latency = formatLatency(log.latencyMs);
        const error = log.errorMessage || "";
        return `[${time}] ${status} ${log.statusCode || "-"} ${latency} ${error}`;
      })
      .join("\n");

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `probe-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl",
        "bg-slate-50 dark:bg-[#0a0a0c]",
        "border border-slate-200 dark:border-white/[0.06]",
        className
      )}
    >
      {/* Scanline Overlay - only visible in dark mode */}
      <div
        className="absolute inset-0 pointer-events-none z-10 opacity-0 dark:opacity-[0.03]"
        style={{
          background:
            "linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0) 50%, rgba(0,0,0,0.1) 50%, rgba(0,0,0,0.1))",
          backgroundSize: "100% 4px",
        }}
      />

      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-slate-200 dark:border-white/[0.06] bg-slate-100/50 dark:bg-white/[0.02]">
        <div className="flex items-center gap-2">
          {/* Traffic Lights */}
          <div className="flex gap-1.5 mr-2">
            <div className="h-2.5 w-2.5 rounded-full bg-rose-400/50 dark:bg-rose-500/30" />
            <div className="h-2.5 w-2.5 rounded-full bg-amber-400/50 dark:bg-amber-500/30" />
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-400/50 dark:bg-emerald-500/30" />
          </div>
          <span className="text-xs font-mono font-medium text-slate-700 dark:text-foreground/80 uppercase tracking-wider">
            {t("title")}
          </span>
          <div className="flex items-center gap-1.5 ml-2">
            <div className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
            <span className="text-xs text-rose-500 font-mono">{t("live")}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleDownload}
            title={t("download")}
          >
            <Download className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </div>
      </div>

      {/* Log Content */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-2 font-mono text-xs md:text-sm space-y-0.5 min-h-[200px] max-h-[400px]"
      >
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            {t("noLogs")}
          </div>
        ) : (
          filteredLogs.map((log) => {
            const level = getLogLevel(log);
            const config = levelConfig[level];
            const Icon = config.icon;

            return (
              <button
                key={log.id}
                onClick={() => onLogClick?.(log)}
                className={cn(
                  "flex items-center gap-2 w-full px-2 py-1.5 rounded text-left",
                  "hover:bg-muted/30 dark:hover:bg-white/[0.03]",
                  "transition-colors border-l-2",
                  config.borderColor,
                  onLogClick && "cursor-pointer"
                )}
              >
                {/* Timestamp */}
                <span className="text-muted-foreground opacity-60 w-20 shrink-0">
                  [{formatTime(log.createdAt)}]
                </span>

                {/* Status */}
                <span className={cn("w-12 shrink-0 font-bold", config.color)}>{config.label}</span>

                {/* Status Code */}
                <span
                  className={cn(
                    "w-10 shrink-0",
                    log.statusCode && log.statusCode >= 200 && log.statusCode < 300
                      ? "text-emerald-500"
                      : log.statusCode && log.statusCode >= 400
                        ? "text-rose-500"
                        : "text-muted-foreground"
                  )}
                >
                  {log.statusCode || "-"}
                </span>

                {/* Latency */}
                <span
                  className={cn(
                    "w-16 shrink-0 text-right",
                    log.latencyMs && log.latencyMs < 200
                      ? "text-emerald-500"
                      : log.latencyMs && log.latencyMs < 500
                        ? "text-amber-500"
                        : "text-rose-500"
                  )}
                >
                  {formatLatency(log.latencyMs)}
                </span>

                {/* Source badge */}
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] uppercase shrink-0",
                    log.source === "manual"
                      ? "bg-primary/10 text-primary"
                      : "bg-muted/50 text-muted-foreground"
                  )}
                >
                  {log.source === "manual" ? t("manual") : t("auto")}
                </span>

                {/* Error message */}
                {log.errorMessage && (
                  <span className="text-rose-400 truncate flex-1">{log.errorMessage}</span>
                )}
              </button>
            );
          })
        )}

        {/* Loading indicator */}
        {logs.length > 0 && (
          <div className="flex items-center gap-2 px-2 py-1 text-muted-foreground animate-pulse">
            <span className="opacity-50">[{formatTime(new Date())}]</span>
            <span>...</span>
          </div>
        )}
      </div>

      {/* Filter Input */}
      <div className="p-2 border-t border-slate-200 dark:border-white/[0.06] bg-slate-100/50 dark:bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <span className="text-primary font-mono">&gt;</span>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("filterPlaceholder")}
            className={cn(
              "flex-1 bg-transparent border-none text-sm font-mono",
              "text-foreground placeholder:text-muted-foreground/50",
              "focus:outline-none focus:ring-0"
            )}
          />
        </div>
      </div>
    </div>
  );
}
