"use client";

import { Activity } from "lucide-react";
import { ThemeSwitcher } from "@/components/ui/theme-switcher";
import { cn } from "@/lib/utils";
import type { DisplayState } from "../_lib/derive-display-state";

interface StatusHeroProps {
  siteTitle: string;
  heroPrimary: string;
  heroSecondary: string;
  generatedAtLabel: string;
  generatedAt: string | null;
  locale: string;
  timeZone: string;
  overallState: DisplayState;
  statusLabel: string;
}

function pillColor(state: DisplayState): { dot: string; ring: string; text: string } {
  switch (state) {
    case "failed":
      return { dot: "bg-rose-500", ring: "bg-rose-500", text: "text-rose-600 dark:text-rose-400" };
    case "degraded":
      return {
        dot: "bg-amber-500",
        ring: "bg-amber-500",
        text: "text-amber-600 dark:text-amber-400",
      };
    case "operational":
      return {
        dot: "bg-emerald-500",
        ring: "bg-emerald-500",
        text: "text-emerald-600 dark:text-emerald-400",
      };
    default:
      return {
        dot: "bg-muted-foreground",
        ring: "bg-muted-foreground",
        text: "text-muted-foreground",
      };
  }
}

export function StatusHero({
  siteTitle,
  heroPrimary,
  heroSecondary,
  generatedAtLabel,
  generatedAt,
  locale,
  timeZone,
  overallState,
  statusLabel,
}: StatusHeroProps) {
  const colors = pillColor(overallState);
  const formattedGeneratedAt = generatedAt
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "medium",
        timeZone,
      }).format(new Date(generatedAt))
    : "—";

  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/60 backdrop-blur-sm">
          <Activity className="size-5" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            {heroPrimary}
          </p>
          <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
            {siteTitle}
          </h1>
          <p className="text-sm text-muted-foreground">{heroSecondary}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div
          className={cn(
            "flex items-center gap-2 rounded-full border border-border/60 bg-background/50 px-3 py-1.5 text-sm backdrop-blur-sm"
          )}
        >
          <span className="relative flex size-2.5">
            <span
              className={cn(
                "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                colors.ring
              )}
            />
            <span className={cn("relative inline-flex size-2.5 rounded-full", colors.dot)} />
          </span>
          <span className={cn("font-medium", colors.text)}>{statusLabel}</span>
          <span className="hidden text-muted-foreground sm:inline">·</span>
          <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
            {generatedAtLabel} {formattedGeneratedAt}
          </span>
        </div>
        <ThemeSwitcher />
      </div>
    </header>
  );
}
