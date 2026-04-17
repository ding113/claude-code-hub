"use client";

import { Check, ChevronDown, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import type React from "react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copyTextToClipboard } from "@/lib/utils/clipboard";
import { cn } from "@/lib/utils/cn";
import type { IpGeoCoordinates } from "@/types/ip-geo";

export type RiskLevel = "none" | "low" | "medium" | "high" | "critical";

export function isNonEmpty(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

export function hasAny<T>(obj: T | null | undefined, keys: (keyof T)[]): boolean {
  if (!obj) return false;
  return keys.some((k) => isNonEmpty(obj[k]));
}

/**
 * True when the API actually located the IP. For CGN / bogon / tailscale
 * IPs upstream returns `0,0` with `accuracy_radius_km = null`, which is a
 * "we don't know" signal rather than a real pair of coordinates — hide it.
 */
export function hasMeaningfulCoordinates(coords: IpGeoCoordinates): boolean {
  if (coords.accuracy_radius_km === null) return false;
  if (coords.latitude === 0 && coords.longitude === 0) return false;
  return true;
}

const RISK_CLASSES: Record<RiskLevel, { tint: string; border: string; dot: string; bar: string }> =
  {
    none: {
      tint: "bg-slate-500/5 dark:bg-slate-500/10",
      border: "border-slate-500/20",
      dot: "bg-slate-500",
      bar: "bg-slate-500",
    },
    low: {
      tint: "bg-emerald-500/5 dark:bg-emerald-500/10",
      border: "border-emerald-500/30",
      dot: "bg-emerald-500",
      bar: "bg-emerald-500",
    },
    medium: {
      tint: "bg-amber-500/5 dark:bg-amber-500/10",
      border: "border-amber-500/30",
      dot: "bg-amber-500",
      bar: "bg-amber-500",
    },
    high: {
      tint: "bg-orange-500/10 dark:bg-orange-500/15",
      border: "border-orange-500/40",
      dot: "bg-orange-500",
      bar: "bg-orange-500",
    },
    critical: {
      tint: "bg-red-500/10 dark:bg-red-500/15",
      border: "border-red-500/40",
      dot: "bg-red-500",
      bar: "bg-red-500",
    },
  };

export function riskClasses(level: RiskLevel) {
  return RISK_CLASSES[level] ?? RISK_CLASSES.none;
}

export function FieldRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value === "") return null;

  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 py-1 sm:grid-cols-[140px_1fr]">
      <span className="text-xs text-muted-foreground sm:text-sm">{label}</span>
      <span
        className={cn("min-w-0 break-all text-sm font-medium", mono && "font-mono text-[13px]")}
      >
        {value}
      </span>
    </div>
  );
}

export function CopyButton({
  text,
  label,
  size = "xs",
}: {
  text: string;
  label?: string;
  size?: "xs" | "sm";
}) {
  const t = useTranslations("ipDetails");
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopied(true);
      toast.success(t("actions.copyGeneric"));
      window.setTimeout(() => setCopied(false), 1500);
    } else {
      toast.error(t("actions.copyFailed"));
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleCopy}
          aria-label={label ?? t("actions.copy")}
          className={cn(
            size === "xs" ? "size-5 p-0" : "size-6 p-0",
            "shrink-0 text-muted-foreground hover:text-foreground"
          )}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label ?? t("actions.copy")}</TooltipContent>
    </Tooltip>
  );
}

export function InlineCopy({
  text,
  children,
  className,
}: {
  text: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      <span className="min-w-0 truncate">{children}</span>
      <CopyButton text={text} />
    </span>
  );
}

export function SubCard({
  title,
  icon,
  children,
  className,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border bg-muted/30 px-3 py-2.5 dark:bg-muted/20", className)}>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{title}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}

export function Section({
  title,
  icon,
  defaultOpen = true,
  count,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="group/section">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-md px-1 py-2 text-left hover:bg-muted/50"
        >
          <div className="flex items-center gap-2">
            {icon}
            <h3 className="text-sm font-semibold">{title}</h3>
            {count !== undefined && count > 0 && (
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                {count}
              </Badge>
            )}
          </div>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=closed]/section:-rotate-90" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1 pb-1">
        <div className="space-y-2 pl-1">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function RiskDot({ level, className }: { level: RiskLevel; className?: string }) {
  const { dot } = riskClasses(level);
  return <span className={cn("inline-block size-2 rounded-full", dot, className)} />;
}

export function ScoreMeter({
  score,
  level,
  showTicks = false,
  className,
}: {
  score: number;
  level: RiskLevel;
  showTicks?: boolean;
  className?: string;
}) {
  const { bar } = riskClasses(level);
  const clamped = Math.max(0, Math.min(1, score));
  return (
    <div className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn("h-full rounded-full transition-all", bar)}
        style={{ width: `${clamped * 100}%` }}
      />
      {showTicks && (
        <>
          <span className="absolute inset-y-0 left-1/4 w-px bg-background/70" />
          <span className="absolute inset-y-0 left-1/2 w-px bg-background/70" />
          <span className="absolute inset-y-0 left-3/4 w-px bg-background/70" />
        </>
      )}
    </div>
  );
}

export const NETWORK_TYPE_STYLES: Record<string, string> = {
  residential: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30",
  business: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  hosting: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30",
  mobile: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  education: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
  government: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
  military: "bg-stone-500/15 text-stone-700 dark:text-stone-300 border-stone-500/30",
  satellite: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30",
  unknown: "bg-muted text-muted-foreground border-border",
};

export const BLOCKLIST_CATEGORY_STYLES: Record<string, string> = {
  spam: "bg-yellow-500/15 text-yellow-800 dark:text-yellow-300 border-yellow-500/30",
  malware: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  phishing: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
  scanner: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  exploit: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  fraud: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  abuse: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30",
  other: "bg-muted text-muted-foreground border-border",
};

export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        "inline-flex min-w-0 items-center gap-1 text-primary hover:underline",
        className
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
    </a>
  );
}

export function formatBigNumber(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}

export function formatLocalTime(iso: string, tzId: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: tzId,
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
