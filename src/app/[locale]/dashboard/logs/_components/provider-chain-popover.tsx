"use client";

import {
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  InfoIcon,
  Link2,
  RefreshCw,
  XCircle,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatProbabilityCompact } from "@/lib/utils/provider-chain-formatter";
import type { ProviderChainItem } from "@/types/message";

interface ProviderChainPopoverProps {
  chain: ProviderChainItem[];
  finalProvider: string;
  /** Whether a cost badge is displayed, affects name max width */
  hasCostBadge?: boolean;
}

/**
 * Determine if this is an actual request record (excluding intermediate states)
 */
function isActualRequest(item: ProviderChainItem): boolean {
  if (item.reason === "concurrent_limit_failed") return true;
  if (item.reason === "retry_failed" || item.reason === "system_error") return true;
  if ((item.reason === "request_success" || item.reason === "retry_success") && item.statusCode) {
    return true;
  }
  return false;
}

/**
 * Get status icon and color for a provider chain item
 */
function getItemStatus(item: ProviderChainItem): {
  icon: React.ElementType;
  color: string;
  bgColor: string;
} {
  if ((item.reason === "request_success" || item.reason === "retry_success") && item.statusCode) {
    return {
      icon: CheckCircle,
      color: "text-emerald-600",
      bgColor: "bg-emerald-50 dark:bg-emerald-950/30",
    };
  }
  if (item.reason === "retry_failed" || item.reason === "system_error") {
    return {
      icon: XCircle,
      color: "text-rose-600",
      bgColor: "bg-rose-50 dark:bg-rose-950/30",
    };
  }
  if (item.reason === "concurrent_limit_failed") {
    return {
      icon: Zap,
      color: "text-amber-600",
      bgColor: "bg-amber-50 dark:bg-amber-950/30",
    };
  }
  if (item.reason === "client_error_non_retryable") {
    return {
      icon: AlertTriangle,
      color: "text-orange-600",
      bgColor: "bg-orange-50 dark:bg-orange-950/30",
    };
  }
  return {
    icon: RefreshCw,
    color: "text-slate-500",
    bgColor: "bg-slate-50 dark:bg-slate-800/50",
  };
}

export function ProviderChainPopover({
  chain,
  finalProvider,
  hasCostBadge = false,
}: ProviderChainPopoverProps) {
  const t = useTranslations("dashboard");
  const tChain = useTranslations("provider-chain");

  // Calculate actual request count (excluding intermediate states)
  const requestCount = chain.filter(isActualRequest).length;

  // Fallback for empty string
  const displayName = finalProvider || "-";

  // Determine max width based on whether cost badge is present
  const maxWidthClass = hasCostBadge ? "max-w-[140px]" : "max-w-[180px]";

  // Check if this is a session reuse
  const isSessionReuse =
    chain[0]?.reason === "session_reuse" || chain[0]?.selectionMethod === "session_reuse";

  // Get initial selection context for tooltip
  const initialSelection = chain.find((item) => item.reason === "initial_selection");
  const selectionContext = initialSelection?.decisionContext;

  // Single request: show name with icon and compact tooltip
  if (requestCount <= 1) {
    // Get session reuse context for detailed tooltip
    const sessionReuseItem = chain.find(
      (item) => item.reason === "session_reuse" || item.selectionMethod === "session_reuse"
    );
    const sessionReuseContext = sessionReuseItem?.decisionContext;

    return (
      <div className={`${maxWidthClass} min-w-0 w-full`}>
        <TooltipProvider>
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <span className="truncate flex items-center gap-1 cursor-help" dir="auto">
                {/* Session reuse indicator */}
                {isSessionReuse && <Link2 className="h-3 w-3 shrink-0 text-violet-500" />}
                {/* Initial selection: show compact priority badge before name */}
                {!isSessionReuse && selectionContext && (
                  <span className="shrink-0 text-[10px] text-emerald-600 dark:text-emerald-400 font-mono font-medium">
                    P{selectionContext.selectedPriority}
                  </span>
                )}
                <span className="truncate">{displayName}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" className="max-w-[320px]">
              <div className="space-y-2">
                {/* Provider name */}
                <div className="font-medium text-xs">{displayName}</div>

                {/* Session reuse detailed info */}
                {isSessionReuse && (
                  <div className="space-y-1.5 pt-1 border-t border-zinc-600 dark:border-zinc-300">
                    <div className="flex items-center gap-1.5 text-[10px] text-violet-400 dark:text-violet-600 font-medium">
                      <Link2 className="h-3 w-3" />
                      <span>{tChain("reasons.session_reuse")}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] pl-1">
                      {sessionReuseContext?.sessionAge !== undefined && (
                        <div>
                          <span className="text-zinc-400 dark:text-zinc-500">
                            {tChain("timeline.sessionAge") || "Age"}:
                          </span>{" "}
                          <span className="text-zinc-200 dark:text-zinc-700">
                            {sessionReuseContext.sessionAge}s
                          </span>
                        </div>
                      )}
                      {sessionReuseItem?.priority !== undefined && (
                        <div>
                          <span className="text-zinc-400 dark:text-zinc-500">
                            {tChain("details.priority")}:
                          </span>{" "}
                          <span className="text-zinc-200 dark:text-zinc-700">
                            P{sessionReuseItem.priority}
                          </span>
                        </div>
                      )}
                      {sessionReuseItem?.costMultiplier !== undefined && (
                        <div>
                          <span className="text-zinc-400 dark:text-zinc-500">
                            {tChain("details.costMultiplier")}:
                          </span>{" "}
                          <span className="text-zinc-200 dark:text-zinc-700">
                            x{sessionReuseItem.costMultiplier}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Initial selection detailed info */}
                {!isSessionReuse && selectionContext && (
                  <div className="space-y-1.5 pt-1 border-t border-zinc-600 dark:border-zinc-300">
                    <div className="text-[10px] text-zinc-300 dark:text-zinc-600 font-medium">
                      {tChain("timeline.initialSelection") || "Initial Selection"}
                    </div>
                    {/* Selection funnel */}
                    <div className="flex items-center gap-1 text-[10px] text-zinc-200 dark:text-zinc-700">
                      <span>{selectionContext.totalProviders}</span>
                      <span className="text-zinc-400 dark:text-zinc-500">total</span>
                      <ChevronRight className="h-2.5 w-2.5" />
                      <span>{selectionContext.enabledProviders}</span>
                      <span className="text-zinc-400 dark:text-zinc-500">enabled</span>
                      <ChevronRight className="h-2.5 w-2.5" />
                      <span>{selectionContext.afterHealthCheck}</span>
                      <span className="text-zinc-400 dark:text-zinc-500">healthy</span>
                    </div>
                    {/* Priority and candidates */}
                    <div className="text-[10px] space-y-0.5 pl-1">
                      <div className="flex items-center gap-1">
                        <span className="text-zinc-400 dark:text-zinc-500">
                          {tChain("details.priority")}:
                        </span>
                        <span className="text-zinc-200 dark:text-zinc-700 font-medium">
                          P{selectionContext.selectedPriority}
                        </span>
                        {selectionContext.candidatesAtPriority && (
                          <span className="text-zinc-400 dark:text-zinc-500">
                            ({selectionContext.candidatesAtPriority.length} candidates)
                          </span>
                        )}
                      </div>
                      {/* Show candidates with probability */}
                      {selectionContext.candidatesAtPriority &&
                        selectionContext.candidatesAtPriority.length > 1 && (
                          <div className="text-zinc-400 dark:text-zinc-500">
                            {selectionContext.candidatesAtPriority.map((c, i) => (
                              <span key={c.id}>
                                {i > 0 && ", "}
                                <span
                                  className={
                                    c.name === displayName
                                      ? "text-zinc-200 dark:text-zinc-700 font-medium"
                                      : ""
                                  }
                                >
                                  {c.name}
                                </span>
                                {(() => {
                                  const formatted = formatProbabilityCompact(c.probability);
                                  return formatted ? (
                                    <span className="text-zinc-500 dark:text-zinc-400">
                                      ({formatted})
                                    </span>
                                  ) : null;
                                })()}
                              </span>
                            ))}
                          </div>
                        )}
                    </div>
                    {/* Provider config */}
                    {initialSelection && (
                      <div className="grid grid-cols-3 gap-x-2 text-[10px] text-zinc-400 dark:text-zinc-500 pt-1">
                        {initialSelection.weight !== undefined && (
                          <div>
                            <span>{tChain("details.weight")}:</span>{" "}
                            <span className="text-zinc-200 dark:text-zinc-700">
                              {initialSelection.weight}
                            </span>
                          </div>
                        )}
                        {initialSelection.costMultiplier !== undefined && (
                          <div>
                            <span>{tChain("details.costMultiplier")}:</span>{" "}
                            <span className="text-zinc-200 dark:text-zinc-700">
                              x{initialSelection.costMultiplier}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  }

  // Multiple requests: show popover with visual chain
  const actualRequests = chain.filter(isActualRequest);

  // Get the successful provider's costMultiplier and groupTag
  const successfulProvider = [...chain]
    .reverse()
    .find((item) => item.reason === "request_success" || item.reason === "retry_success");
  const finalCostMultiplier = successfulProvider?.costMultiplier;
  const finalGroupTag = successfulProvider?.groupTag;
  const hasFinalCostBadge =
    finalCostMultiplier !== undefined &&
    finalCostMultiplier !== null &&
    Number.isFinite(finalCostMultiplier) &&
    finalCostMultiplier !== 1;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto p-0 font-normal hover:bg-transparent w-full min-w-0"
          aria-label={`${displayName} - ${requestCount}${t("logs.table.times")}`}
        >
          <span className="flex w-full items-center gap-1 min-w-0">
            {/* Request count badge */}
            <Badge variant="secondary" className="shrink-0">
              {requestCount}
              {t("logs.table.times")}
            </Badge>
            {/* Provider name */}
            <span className="truncate min-w-0" dir="auto">
              {displayName}
            </span>
            {/* Cost multiplier badge (if not 1) */}
            {hasFinalCostBadge && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] px-1 py-0 shrink-0",
                  finalCostMultiplier > 1
                    ? "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-800"
                    : "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-800"
                )}
              >
                x{finalCostMultiplier.toFixed(2)}
              </Badge>
            )}
            {/* Group tag badge (if present) */}
            {finalGroupTag && (
              <Badge
                variant="outline"
                className="text-[10px] px-1 py-0 shrink-0 bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900/30 dark:text-slate-400 dark:border-slate-700"
              >
                {finalGroupTag}
              </Badge>
            )}
            {/* Info icon */}
            <InfoIcon className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[360px] max-w-[calc(100vw-2rem)] p-0" align="start">
        <div className="p-3 border-b">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">{t("logs.providerChain.decisionChain")}</h4>
            <Badge variant="outline" className="text-[10px]">
              {requestCount} {t("logs.table.times")}
            </Badge>
          </div>
        </div>

        {/* Visual chain */}
        <div className="p-3 space-y-0 max-h-[300px] overflow-y-auto">
          {actualRequests.map((item, index) => {
            const status = getItemStatus(item);
            const Icon = status.icon;
            const isLast = index === actualRequests.length - 1;

            return (
              <div key={`${item.id}-${index}`} className="relative flex gap-2">
                {/* Timeline connector */}
                <div className="flex flex-col items-center">
                  <div
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                      status.bgColor
                    )}
                  >
                    <Icon className={cn("h-3 w-3", status.color)} />
                  </div>
                  {!isLast && <div className="w-0.5 flex-1 min-h-[8px] bg-border" />}
                </div>

                {/* Content */}
                <div className={cn("flex-1 pb-3", isLast && "pb-0")}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{item.name}</span>
                    {item.statusCode && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] px-1 py-0",
                          item.statusCode >= 200 && item.statusCode < 300
                            ? "border-emerald-500 text-emerald-600"
                            : "border-rose-500 text-rose-600"
                        )}
                      >
                        {item.statusCode}
                      </Badge>
                    )}
                    {item.reason && !item.statusCode && (
                      <span className="text-[10px] text-muted-foreground">
                        {tChain(`reasons.${item.reason}`)}
                      </span>
                    )}
                  </div>
                  {item.errorMessage && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
                      {item.errorMessage}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-2 border-t bg-muted/30">
          <p className="text-[10px] text-muted-foreground text-center">
            {t("logs.details.clickStatusCode")}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
