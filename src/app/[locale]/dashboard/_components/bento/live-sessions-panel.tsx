"use client";

import { Activity, AlertCircle, Circle, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  getSessionDisplayStatus,
  SESSION_DISPLAY_STATUS,
  type SessionStatusInfo,
} from "@/lib/session-status";
import { cn } from "@/lib/utils";
import type { ActiveSessionInfo } from "@/types/session";
import { BentoCard } from "./bento-grid";

interface LiveSessionsPanelProps {
  sessions: ActiveSessionInfo[];
  isLoading?: boolean;
  maxItems?: number;
  className?: string;
}

function SessionItem({ session }: { session: ActiveSessionInfo }) {
  const router = useRouter();
  const t = useTranslations("customs.activeSessions");
  const statusInfo = getSessionDisplayStatus({
    concurrentCount: session.concurrentCount,
    requestCount: session.requestCount,
    status: session.status,
  });

  const shortId = session.sessionId.slice(-6);
  const userName = session.userName || t("unknownUser");

  // Determine ping animation color based on status
  const getPingColor = (info: SessionStatusInfo) => {
    if (info.status === SESSION_DISPLAY_STATUS.IN_PROGRESS) {
      return info.label === "FAIL" ? "bg-rose-500" : "bg-emerald-500";
    }
    if (info.status === SESSION_DISPLAY_STATUS.INITIALIZING) {
      return "bg-amber-500";
    }
    return "";
  };

  // Determine user name color based on status
  const getUserNameColor = (info: SessionStatusInfo) => {
    if (info.status === SESSION_DISPLAY_STATUS.IN_PROGRESS) {
      return info.label === "FAIL"
        ? "text-rose-500 dark:text-rose-400"
        : "text-blue-500 dark:text-blue-400";
    }
    if (info.status === SESSION_DISPLAY_STATUS.INITIALIZING) {
      return "text-amber-600 dark:text-amber-300";
    }
    return "text-muted-foreground";
  };

  return (
    <button
      onClick={() => router.push(`/dashboard/sessions/${session.sessionId}/messages`)}
      className={cn(
        "flex items-center gap-3 w-full p-2 rounded-md",
        "hover:bg-muted/50 dark:hover:bg-white/5",
        "transition-colors cursor-pointer text-left",
        "group"
      )}
    >
      {/* Status Indicator */}
      <div className="relative flex-shrink-0">
        {statusInfo.pulse && (
          <span
            className={cn(
              "absolute inset-0 rounded-full animate-ping opacity-75",
              getPingColor(statusInfo)
            )}
            style={{ animationDuration: "1.5s" }}
          />
        )}
        {statusInfo.label === "FAIL" ? (
          <XCircle className={cn("h-2.5 w-2.5 relative", statusInfo.color)} fill="currentColor" />
        ) : (
          <Circle className={cn("h-2.5 w-2.5 relative", statusInfo.color)} fill="currentColor" />
        )}
      </div>

      {/* Session ID */}
      <span className="text-xs font-mono text-muted-foreground">#{shortId}</span>

      {/* User Name */}
      <span className={cn("text-xs font-medium truncate", getUserNameColor(statusInfo))}>
        {userName}
      </span>

      {/* Dotted Line */}
      <span className="flex-1 border-b border-dashed border-border/50 dark:border-white/10 mx-1" />

      {/* Status Label with Tooltip */}
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "text-xs font-mono font-bold tracking-wide cursor-help",
                statusInfo.color,
                statusInfo.status === SESSION_DISPLAY_STATUS.IDLE && "font-normal"
              )}
            >
              {statusInfo.label}
            </span>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-[200px]">
            <p className="text-xs">{t(statusInfo.tooltipKey)}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </button>
  );
}

const SESSION_ITEM_HEIGHT = 36; // Height of each session row in pixels
const HEADER_HEIGHT = 48; // Height of header
const FOOTER_HEIGHT = 36; // Height of footer

/**
 * Live Sessions Panel
 * Terminal-style display of active sessions with real-time status indicators
 */
export function LiveSessionsPanel({
  sessions,
  isLoading,
  maxItems: maxItemsProp,
  className,
}: LiveSessionsPanelProps) {
  const t = useTranslations("customs.activeSessions");
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dynamicMaxItems, setDynamicMaxItems] = useState(maxItemsProp ?? 8);

  const calculateMaxItems = useCallback(() => {
    if (!containerRef.current) return;
    const containerHeight = containerRef.current.clientHeight;
    const availableHeight = containerHeight - HEADER_HEIGHT - FOOTER_HEIGHT;
    let calculatedItems = Math.max(1, Math.floor(availableHeight / SESSION_ITEM_HEIGHT));
    if (maxItemsProp !== undefined) {
      calculatedItems = Math.min(calculatedItems, maxItemsProp);
    }
    setDynamicMaxItems(calculatedItems);
  }, [maxItemsProp]);

  useEffect(() => {
    calculateMaxItems();
    const resizeObserver = new ResizeObserver(calculateMaxItems);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    return () => resizeObserver.disconnect();
  }, [calculateMaxItems]);

  const displaySessions = sessions.slice(0, dynamicMaxItems);
  const hasMore = sessions.length > dynamicMaxItems;

  return (
    <BentoCard
      ref={containerRef}
      colSpan={1}
      rowSpan={2}
      className={cn(
        "flex flex-col overflow-hidden p-0",
        // Light mode: subtle gray, Dark mode: terminal-style dark
        "bg-slate-50 dark:bg-[#0a0a0c]",
        "border-slate-200 dark:border-white/[0.06]",
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
          <Activity className="h-3.5 w-3.5 text-slate-500 dark:text-muted-foreground" />
          <span className="text-xs font-mono font-medium text-slate-700 dark:text-foreground/80 uppercase tracking-wider">
            {t("title")}
          </span>
        </div>
        {/* Traffic Lights */}
        <div className="flex gap-1.5">
          <div className="h-2 w-2 rounded-full bg-rose-400/30 dark:bg-rose-500/20" />
          <div className="h-2 w-2 rounded-full bg-amber-400/30 dark:bg-amber-500/20" />
          <div className="h-2 w-2 rounded-full bg-emerald-400/30 dark:bg-emerald-500/20" />
        </div>
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto p-2 font-mono text-xs space-y-0.5">
        {isLoading && sessions.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span>{t("loading")}</span>
            </div>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <AlertCircle className="h-5 w-5 opacity-50" />
            <span className="text-xs">{t("empty")}</span>
          </div>
        ) : (
          displaySessions.map((session) => (
            <SessionItem key={session.sessionId} session={session} />
          ))
        )}
      </div>

      {/* Footer */}
      {(hasMore || sessions.length > 0) && (
        <button
          onClick={() => router.push("/dashboard/sessions")}
          className={cn(
            "flex items-center justify-center gap-1 p-2",
            "text-xs text-slate-600 dark:text-muted-foreground hover:text-slate-900 dark:hover:text-foreground",
            "border-t border-slate-200 dark:border-white/[0.06] bg-slate-100/50 dark:bg-white/[0.02]",
            "transition-colors cursor-pointer"
          )}
        >
          <span>{t("viewAll")}</span>
          <span className="text-primary font-medium">({sessions.length})</span>
        </button>
      )}
    </BentoCard>
  );
}
