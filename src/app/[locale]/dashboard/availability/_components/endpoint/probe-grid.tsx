"use client";

import { CheckCircle2, HelpCircle, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ProviderEndpoint } from "@/types/provider";

interface ProbeGridProps {
  endpoints: ProviderEndpoint[];
  selectedEndpointId?: number | null;
  onEndpointSelect?: (endpoint: ProviderEndpoint) => void;
  className?: string;
}

function getStatusConfig(endpoint: ProviderEndpoint) {
  if (endpoint.lastProbeOk === null) {
    return {
      icon: HelpCircle,
      color: "text-slate-400",
      bgColor: "bg-slate-400/10",
      borderColor: "border-slate-400/30",
      label: "unknown",
    };
  }
  if (endpoint.lastProbeOk) {
    return {
      icon: CheckCircle2,
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
      borderColor: "border-emerald-500/30",
      label: "healthy",
    };
  }
  return {
    icon: XCircle,
    color: "text-rose-500",
    bgColor: "bg-rose-500/10",
    borderColor: "border-rose-500/30",
    label: "unhealthy",
  };
}

function formatLatency(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(date: Date | string | null): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ProbeGrid({
  endpoints,
  selectedEndpointId,
  onEndpointSelect,
  className,
}: ProbeGridProps) {
  const t = useTranslations("dashboard.availability.probeGrid");

  if (endpoints.length === 0) {
    return (
      <div className={cn("text-center text-muted-foreground py-8", className)}>
        {t("noEndpoints")}
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className={cn("grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3", className)}>
        {endpoints.map((endpoint) => {
          const status = getStatusConfig(endpoint);
          const StatusIcon = status.icon;
          const isSelected = selectedEndpointId === endpoint.id;

          return (
            <Tooltip key={endpoint.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onEndpointSelect?.(endpoint)}
                  className={cn(
                    "relative p-3 rounded-xl text-left transition-all duration-200",
                    "border",
                    status.bgColor,
                    status.borderColor,
                    "hover:scale-[1.02] hover:shadow-md",
                    "active:scale-[0.98]",
                    isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <StatusIcon className={cn("h-4 w-4 shrink-0", status.color)} />
                        <span className="text-sm font-medium truncate">
                          {endpoint.label || new URL(endpoint.url).hostname}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-1">{endpoint.url}</p>
                    </div>
                    {endpoint.lastProbeLatencyMs !== null && (
                      <span
                        className={cn(
                          "text-xs font-mono px-1.5 py-0.5 rounded",
                          endpoint.lastProbeLatencyMs < 200
                            ? "bg-emerald-500/10 text-emerald-500"
                            : endpoint.lastProbeLatencyMs < 500
                              ? "bg-amber-500/10 text-amber-500"
                              : "bg-rose-500/10 text-rose-500"
                        )}
                      >
                        {formatLatency(endpoint.lastProbeLatencyMs)}
                      </span>
                    )}
                  </div>

                  {/* Last probe time */}
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/30">
                    <span className="text-xs text-muted-foreground">{t("lastProbe")}</span>
                    <span className="text-xs font-mono text-muted-foreground">
                      {formatTime(endpoint.lastProbedAt)}
                    </span>
                  </div>

                  {/* Status code badge */}
                  {endpoint.lastProbeStatusCode !== null && (
                    <div
                      className={cn(
                        "absolute -top-1 -right-1 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full",
                        endpoint.lastProbeStatusCode >= 200 && endpoint.lastProbeStatusCode < 300
                          ? "bg-emerald-500 text-white"
                          : endpoint.lastProbeStatusCode >= 400
                            ? "bg-rose-500 text-white"
                            : "bg-amber-500 text-white"
                      )}
                    >
                      {endpoint.lastProbeStatusCode}
                    </div>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <div className="text-xs space-y-1">
                  <p className="font-medium">{endpoint.label || endpoint.url}</p>
                  <p className="text-muted-foreground">{t(`status.${status.label}`)}</p>
                  {endpoint.lastProbeErrorMessage && (
                    <p className="text-rose-400">{endpoint.lastProbeErrorMessage}</p>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
