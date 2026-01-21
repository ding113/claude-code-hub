"use client";

import { Activity, AlertCircle, CheckCircle2, Circle, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { ActiveSessionInfo } from "@/types/session";
import { BentoCard } from "./bento-grid";

interface LiveSessionsPanelProps {
  sessions: (ActiveSessionInfo & { lastActivityAt?: number })[];
  isLoading?: boolean;
  maxItems?: number;
  className?: string;
}

type SessionStatus = "running" | "idle" | "error" | "done" | "init";

function getSessionStatus(session: ActiveSessionInfo & { lastActivityAt?: number }): SessionStatus {
  // Determine status based on session activity and startTime
  const now = Date.now();
  const lastActivity = session.lastActivityAt ?? session.startTime;
  const idleThreshold = 60 * 1000; // 1 minute

  if (session.status === "error" || (session as { status?: string }).status === "error") {
    return "error";
  }

  if (now - lastActivity < 5000) {
    return "running";
  }

  if (now - lastActivity < idleThreshold) {
    return "init";
  }

  return "idle";
}

const statusConfig: Record<
  SessionStatus,
  { icon: typeof Circle; color: string; pulse?: boolean; label: string }
> = {
  running: {
    icon: Circle,
    color: "text-emerald-500 dark:text-emerald-400",
    pulse: true,
    label: "RUNNING",
  },
  init: {
    icon: Circle,
    color: "text-amber-500 dark:text-amber-400",
    pulse: true,
    label: "INIT",
  },
  idle: {
    icon: Circle,
    color: "text-muted-foreground/50",
    pulse: false,
    label: "IDLE",
  },
  error: {
    icon: XCircle,
    color: "text-rose-500 dark:text-rose-400",
    pulse: true,
    label: "ERROR",
  },
  done: {
    icon: CheckCircle2,
    color: "text-muted-foreground/50",
    pulse: false,
    label: "DONE",
  },
};

function SessionItem({ session }: { session: ActiveSessionInfo }) {
  const router = useRouter();
  const status = getSessionStatus(session);
  const config = statusConfig[status];
  const StatusIcon = config.icon;

  const shortId = session.sessionId.slice(-6);
  const userName = session.userName || "unknown";

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
        {config.pulse && (
          <span
            className={cn(
              "absolute inset-0 rounded-full animate-ping opacity-75",
              status === "running" && "bg-emerald-500",
              status === "init" && "bg-amber-500",
              status === "error" && "bg-rose-500"
            )}
            style={{ animationDuration: "1.5s" }}
          />
        )}
        <StatusIcon className={cn("h-2.5 w-2.5 relative", config.color)} fill="currentColor" />
      </div>

      {/* Session ID */}
      <span className="text-xs font-mono text-muted-foreground">#{shortId}</span>

      {/* User Name */}
      <span
        className={cn(
          "text-xs font-medium truncate",
          status === "running" && "text-blue-500 dark:text-blue-400",
          status === "init" && "text-amber-600 dark:text-amber-300",
          status === "error" && "text-rose-500 dark:text-rose-400",
          (status === "idle" || status === "done") && "text-muted-foreground"
        )}
      >
        {userName}
      </span>

      {/* Dotted Line */}
      <span className="flex-1 border-b border-dashed border-border/50 dark:border-white/10 mx-1" />

      {/* Status Label */}
      <span
        className={cn(
          "text-xs font-mono font-bold tracking-wide",
          config.color,
          status === "idle" && "font-normal"
        )}
      >
        {config.label}
      </span>
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
    const calculatedItems = Math.max(1, Math.floor(availableHeight / SESSION_ITEM_HEIGHT));
    setDynamicMaxItems(calculatedItems);
  }, []);

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
              <span>Loading...</span>
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
